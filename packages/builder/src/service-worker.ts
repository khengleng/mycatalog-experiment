import {
  FileDaemonClient,
  defaultOrigin,
  defaultWebsocketURL,
} from "./file-daemon-client";
import { FileSystem } from "./filesystem";
import { handleFileRequest } from "./file-request-handler";
import { Handler } from "./request-handler";
import { Builder } from "./builder";

const worker = (self as unknown) as ServiceWorkerGlobalScope;
const fs = new FileSystem();
const ourBackendEndpoint = "__alive__";
const webroot: string = "/";

let originURL: URL;
let websocketURL: URL;
let isDisabled = false;
let finishedBuild: Promise<void>;
let client: FileDaemonClient | undefined;

console.log(`service worker evaluated`);

worker.addEventListener("install", () => {
  console.log(`installing`);
  originURL = new URL(defaultOrigin);
  websocketURL = new URL(defaultWebsocketURL);

  // force moving on to activation even if another service worker had control
  worker.skipWaiting();
});

worker.addEventListener("activate", () => {
  console.log(
    `service worker activated using builder origin: ${originURL}, websocket URL: ${websocketURL}`
  );

  // takes over when there is *no* existing service worker
  worker.clients.claim();

  client = new FileDaemonClient(originURL, websocketURL, fs, webroot);

  // TODO watch for file changes and build when fs changes
  let builder = Builder.forProjects(fs, [originURL]);
  finishedBuild = (async () => {
    await client.ready;
    await builder.build();
    console.log(`completed build, file system:`);
    await fs.displayListing();
  })();

  (async () => {
    await checkForOurBackend();
  })();
});

worker.addEventListener("fetch", (event: FetchEvent) => {
  let url = new URL(event.request.url);

  if (isDisabled || url.pathname === `/${ourBackendEndpoint}`) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    (async () => {
      if (client) {
        // wait for at least the first build so that there is an index.html
        // to render for the app.
        await finishedBuild;
      }

      // This is probably a bit overbuilt--it's meant as a sort of middleware for our
      // service worker--but there is only one handler right now...
      let stack: Handler[] = [handleFileRequest];
      let response: Response | undefined;
      let context = { fs, webroot, originURL };
      for (let handler of stack) {
        response = await handler(event.request, context);
        if (response) {
          return response;
        }
      }

      return new Response("Not Found", { status: 404 });
    })()
  );
});

// Check to make sure that our backend is _really_ ours. Otherwise unregister
// this service worker so it doesnt get in the way of non catalogjs web apps.
async function checkForOurBackend() {
  while (true) {
    let status;
    try {
      status = (await fetch(`${worker.origin}/${ourBackendEndpoint}`)).status;
    } catch (err) {
      console.log(
        `Encountered error performing aliveness check (server is probably not running):`,
        err
      );
    }
    if (status === 404) {
      console.error(
        "some other server is running instead of the file daemon, unregistering this service worker."
      );
      isDisabled = true;
      await worker.registration.unregister();
      break;
    } else {
      await new Promise((res) => setTimeout(() => res(), 10 * 1000));
    }
  }
}
