import walkSync from "walk-sync";
import {
  createReadStream,
  ensureDirSync,
  createWriteStream,
  removeSync,
} from "fs-extra";
import { Readable } from "stream";
import { Tar } from "tarstream";
import { DIRTYPE, REGTYPE } from "tarstream/constants";
import { NodeReadableToDOM, DOMToNodeReadable } from "./stream-shims";
import { DirectoryEntry } from "tarstream/types";
import { unixTime } from "./utils";
import { join, resolve, dirname } from "path";
import * as webStreams from "web-streams-polyfill/ponyfill/es2018";
import send from "koa-send";
import route, { KoaRoute } from "koa-better-route";
import compose from "koa-compose";
import proxy from "koa-proxies";
import flatMap from "lodash/flatMap";
import { ProjectMapping } from "./daemon";

// polyfill
global = Object.assign(global, webStreams);

const builderServer = "http://localhost:8080";
const uiServer = "http://localhost:4300/catalogjs/ui/";

export function serveFiles(mapping: ProjectMapping) {
  return compose([
    ...flatMap([...mapping.nameToPath.entries()], ([localName, dir]) => {
      return [
        route.get(
          `/catalogjs/files/${localName}/(.*)`,
          (ctxt: KoaRoute.Context) => {
            return send(ctxt, ctxt.routeParams[0], { root: dir });
          }
        ),
        route.post(`/catalogjs/files/${localName}/(.*)`, updateFiles(dir)),
        route.delete(`/catalogjs/files/${localName}/(.*)`, removeFiles(dir)),
      ];
    }),
    route.get(`/catalogjs/files`, (ctxt: KoaRoute.Context) => {
      ctxt.res.setHeader("content-type", "application/x-tar");
      ctxt.body = streamFileSystem(mapping);
    }),
    proxy("/catalogjs/builder", {
      target: builderServer,
      rewrite(path: string) {
        return path.slice("/catalogjs/builder".length);
      },
    }),
    proxy("/main.js", {
      target: builderServer,
    }),
    proxy("/service-worker.js", {
      target: builderServer,
    }),

    // UI is being served from /catalogjs/ui/ from ember-cli, this proxy handles
    // the asset references from the ember apps's index.html. We serve the ember
    // app in ember-cli in a root path that matches how the UI is mounted in the
    // filesystem abstration so that the asset references in index.html line up
    // with path that they can be found in the filesytem abstraction. otherwise
    // index.html will have references to UI assets that don't exist in the file
    // system (e.g.: http://localhost:4200/assets/vendor.js vs
    // http://localhost:4200/catalogjs/ui/assets/vendor.js)
    proxy("/catalogjs/ui", {
      target: uiServer,
      rewrite(path: string) {
        return path.slice("/catalogjs/ui".length);
      },
    }),
    // this proxy handles the request for the UI's /index.html and any other
    // fall-through conditions
    proxy("/", {
      target: uiServer,
    }),
  ]);
}

function streamFileSystem(mapping: ProjectMapping): Readable {
  let tar = new Tar();
  for (let [localName, dir] of mapping.nameToPath) {
    for (let entry of walkSync.entries(dir)) {
      let { fullPath, size, mtime, mode, relativePath } = entry;

      relativePath = `${localName}/${relativePath}`;
      let file = {
        mode,
        size,
        modifyTime: unixTime(mtime),
        type: entry.isDirectory() ? DIRTYPE : REGTYPE,
        name: entry.isDirectory() ? relativePath.slice(0, -1) : relativePath,
      };
      if (entry.isDirectory()) {
        tar.addFile(file as DirectoryEntry);
      } else {
        tar.addFile({
          ...file,
          stream: () => new NodeReadableToDOM(createReadStream(fullPath)),
        });
      }
    }
  }
  return new DOMToNodeReadable(tar.finish());
}

function updateFiles(dir: string) {
  if (!dir.endsWith("/")) {
    // this ensures our startsWith test will do a true path prefix match, which
    // is a security condition.
    dir += "/";
  }
  return async function (ctxt: KoaRoute.Context) {
    let localPath = ctxt.routeParams[0];
    let fullPath = resolve(join(dir, localPath));
    if (!fullPath.startsWith(dir)) {
      ctxt.response.status = 403;
      ctxt.response.body = "Forbidden";
      return;
    }
    ensureDirSync(dirname(fullPath));
    let stream = createWriteStream(fullPath);
    ctxt.req.pipe(stream);
    await new Promise((resolve, reject) => {
      stream.on("close", resolve);
      stream.on("error", reject);
    });
    ctxt.response.status = 200;
  };
}

function removeFiles(dir: string) {
  if (!dir.endsWith("/")) {
    // this ensures our startsWith test will do a true path prefix match, which
    // is a security condition.
    dir += "/";
  }
  return async function (ctxt: KoaRoute.Context) {
    let localPath = ctxt.routeParams[0];
    let fullPath = resolve(join(dir, localPath));
    if (!fullPath.startsWith(dir)) {
      ctxt.response.status = 403;
      ctxt.response.body = "Forbidden";
      return;
    }
    removeSync(fullPath);
    ctxt.response.status = 200;
  };
}
