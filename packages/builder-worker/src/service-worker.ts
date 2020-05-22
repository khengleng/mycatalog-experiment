import {
  FileDaemonClient,
  defaultWebsocketURL,
  Event as FileDaemonClientEvent,
} from "./file-daemon-client";
import { FileSystem } from "./filesystem";
import { Logger, LogMessage } from "./logger";
import { handleFileRequest } from "./request-handlers/file-request-handler";
import { handleClientRegister } from "./request-handlers/client-register-handler";
import { handleLogLevelRequest } from "./request-handlers/log-level-handler";
import { handleBuilderRestartRequest } from "./request-handlers/builder-restart-handler";
import { ClientEventHandler } from "./client-event-handler";
import { Handler } from "./request-handlers/request-handler";
import { HttpFileSystemDriver } from "./filesystem-drivers/http-driver";
import { ReloadEvent } from "./client-reload";
import { BuildManager } from "./BuildManager";

const worker = (self as unknown) as ServiceWorkerGlobalScope;
const { log } = Logger;
const fs = new FileSystem();
const ourBackendEndpoint = "__alive__";
const uiOrigin = "http://localhost:4300";

let websocketURL: URL;
let isDisabled = false;
let client: FileDaemonClient | undefined;
let fileDaemonEventHandler: ClientEventHandler<FileDaemonClientEvent>;
let logEventHandler: ClientEventHandler<LogMessage[]>;
let reloadEventHandler: ClientEventHandler<ReloadEvent>;

let originURL = new URL(worker.origin);
let inputURL = new URL("https://local-disk/");
let projects: [URL, URL][] = [[inputURL, originURL]];
let buildManager: BuildManager;

console.log(`service worker evaluated`);

worker.addEventListener("install", () => {
  logEventHandler = new ClientEventHandler("log-messages");
  Logger.addListener(logEventHandler.handleEvent.bind(logEventHandler));

  log(`installing`);
  websocketURL = new URL(defaultWebsocketURL);

  // force moving on to activation even if another service worker had control
  worker.skipWaiting();
});

worker.addEventListener("activate", () => {
  log(
    `service worker activated for origin: ${worker.origin}, websocket URL: ${websocketURL}`
  );

  // takes over when there is *no* existing service worker
  worker.clients.claim();

  activate();
});

async function activate() {
  reloadEventHandler = new ClientEventHandler("reload");
  fileDaemonEventHandler = new ClientEventHandler("file-daemon-client-event");
  client = new FileDaemonClient(originURL, websocketURL, fs, inputURL);
  client.addEventListener(
    fileDaemonEventHandler.handleEvent.bind(fileDaemonEventHandler)
  );
  let uiDriver = new HttpFileSystemDriver(new URL(`${uiOrigin}/catalogjs-ui/`));
  let mounting = fs.mount(new URL(`/catalogjs-ui`, originURL), uiDriver);
  buildManager = new BuildManager(fs, projects, reloadEventHandler);
  await Promise.all([client.ready, mounting]);
  await buildManager.rebuilder.start();
  await buildManager.rebuilder.isIdle();
  await fs.displayListing();
}

worker.addEventListener("fetch", (event: FetchEvent) => {
  let url = new URL(event.request.url);

  if (isDisabled || url.pathname === `/${ourBackendEndpoint}`) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    (async () => {
      if (client) {
        await buildManager.rebuilder.isIdle();

        let stack: Handler[] = [
          handleClientRegister,
          handleBuilderRestartRequest,
          handleLogLevelRequest,
          handleFileRequest,
        ];
        let response: Response | undefined;
        let context = {
          fs,
          event,
          fileDaemonClient: client,
          fileDaemonEventHandler,
          logEventHandler,
          reloadEventHandler,
          buildManager,
        };
        for (let handler of stack) {
          response = await handler(event.request, context);
          if (response) {
            return response;
          }
        }
      }

      return new Response("Not Found", { status: 404 });
    })()
  );
});

(async () => {
  checkForOurBackend();
})();

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