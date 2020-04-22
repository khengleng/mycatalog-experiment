import {
  join,
  splitPath,
  baseName,
  dirName,
  urlToPath,
  pathToURL,
} from "./path";
import columnify from "columnify";
import moment from "moment";

const textEncoder = new TextEncoder();
const utf8 = new TextDecoder("utf8");

export class FileSystem {
  private root = new Directory();
  private listeners: EventListener[] = [];

  addEventListener(fn: EventListener) {
    this.listeners.push(fn);
  }

  removeEventListener(fn: EventListener) {
    this.listeners = [...this.listeners.filter((l) => l !== fn)];
  }

  removeAllEventListeners() {
    this.listeners = [];
  }

  async move(sourceURL: URL, destURL: URL): Promise<void> {
    let sourcePath = urlToPath(sourceURL);
    let destPath = urlToPath(destURL);
    let source = await this.openFileOrDir(sourcePath);
    let destParentDirName = dirName(destPath);
    let destParent = destParentDirName
      ? await this.openDir(destParentDirName, true)
      : this.root;
    let name = baseName(destPath);
    destParent.files.set(name, source);
    await this.dispatchEvent(destURL, "create");
    await this.remove(sourceURL);
  }

  async copy(sourceURL: URL, destURL: URL): Promise<void> {
    if (sourceURL.toString() === destURL.toString()) {
      return; // nothing to do
    }
    let sourcePath = urlToPath(sourceURL);
    let destPath = urlToPath(destURL);
    let source = await this.openFileOrDir(sourcePath);
    let destParentDirName = dirName(destPath);
    let destParent = destParentDirName
      ? await this.openDir(destParentDirName, true)
      : this.root;

    let name = baseName(destPath);
    let destItem = source instanceof File ? source.clone() : new Directory();
    destParent.files.set(name, destItem);
    await this.dispatchEvent(destURL, "create");
    if (source instanceof Directory) {
      for (let childName of [...source.files.keys()]) {
        await this.copy(
          pathToURL(join(sourcePath, childName)),
          pathToURL(destPath ? join(destPath, childName) : name)
        );
      }
    }
  }

  async remove(url: URL): Promise<void> {
    await this._remove(urlToPath(url));
  }

  async removeAll(): Promise<void> {
    await this._remove("/");
  }

  private async _remove(path: string): Promise<void> {
    let name = baseName(path);
    let dir = dirName(path);
    if (!dir) {
      // should we have a special event for clearing the entire file system?
      // this only happens in tests...
      this.root.files.delete(name);
    } else {
      let sourceDir: Directory;
      try {
        sourceDir = await this.openDir(dir);
      } catch (err) {
        if (err.code !== "NOT_FOUND") {
          throw err;
        }
        return; // just ignore files that dont exist
      }
      sourceDir.files.delete(name);
      await this.dispatchEvent(path, "remove");
    }
  }

  async list(url: URL, recurse = false): Promise<ListingEntry[]> {
    return await this._list(urlToPath(url), recurse);
  }

  async listAllOrigins(recurse = false): Promise<ListingEntry[]> {
    return await this._list("/", recurse);
  }

  private async _list(
    path: string,
    recurse = false,
    startingPath?: string
  ): Promise<ListingEntry[]> {
    if (!startingPath) {
      startingPath = path;
    }
    let directory = await this.openDir(path);
    let results: ListingEntry[] = [];
    if (startingPath === path && path !== "/") {
      results.push({
        url: pathToURL(path),
        stat: directory.stat,
      });
    }
    for (let name of [...directory.files.keys()].sort()) {
      let item = directory.files.get(name)!;
      results.push({
        url: pathToURL(join(path, name)),
        stat: item.stat,
      });
      if (item instanceof Directory && recurse) {
        results.push(
          ...(await this._list(join(path, name), true, startingPath))
        );
      }
    }
    return results;
  }

  async open(
    url: URL,
    createMode?: Options["createMode"]
  ): Promise<FileDescriptor> {
    let path = urlToPath(url);
    return (await this._open(splitPath(path), { createMode })).getDescriptor(
      //TODO .bind(this) so we dont create nwe closures
      async () => await this.dispatchEvent(url, "write")
    );
  }

  private async openDir(path: string, create = false): Promise<Directory> {
    let directory = await this._open(splitPath(path), {
      createMode: create ? "directory" : undefined,
    });
    if (directory instanceof File) {
      throw new FileSystemError(
        "IS_NOT_A_DIRECTORY",
        `'${pathToURL(
          path
        )}' is not a directory (it's a file and we were expecting it to be a directory)`
      );
    }
    return directory;
  }

  private async openFileOrDir(path: string): Promise<File | Directory> {
    return await this._open(splitPath(path));
  }

  private async _open(
    pathSegments: string[],
    opts: Options = {},
    parent?: Directory,
    initialPath?: string
  ): Promise<File | Directory> {
    if (!initialPath) {
      initialPath = join(...pathSegments);
    }
    let name = pathSegments.shift()!;

    parent = parent || this.root;
    let resource: File | Directory;
    if (!parent.files.has(name)) {
      if (pathSegments.length > 0 && opts.createMode) {
        resource = new Directory();
        // dont fire events for the interior dirs--it's really a pain keeping
        // track of the interior dir path, and honestly the leaf node create
        // events are probably more important
        parent.files.set(name, resource);
        return await this._open(pathSegments, opts, resource, initialPath);
      } else if (opts.createMode === "file") {
        resource = new File();
        parent.files.set(name, resource);
        await this.dispatchEvent(initialPath, "create");
        return resource;
      } else if (opts.createMode === "directory") {
        resource = new Directory();
        parent.files.set(name, resource);
        await this.dispatchEvent(initialPath, "create");
        return resource;
      } else {
        throw new FileSystemError(
          "NOT_FOUND",
          `'${pathToURL(initialPath)}' does not exist`
        );
      }
    } else {
      resource = parent.files.get(name)!;

      // resource is a file
      if (
        resource instanceof File &&
        pathSegments.length === 0 &&
        opts.createMode !== "directory"
      ) {
        return resource;
      } else if (
        resource instanceof File &&
        pathSegments.length === 0 &&
        opts.createMode === "directory"
      ) {
        // we asked for a directory and got a file back
        throw new FileSystemError(
          "IS_NOT_A_DIRECTORY",
          `'${pathToURL(
            initialPath
          )}' is not a directory (it's a file and we were expecting it to be a directory)`
        );
      } else if (resource instanceof File) {
        // there is unconsumed path left over...
        throw new FileSystemError(
          "NOT_FOUND",
          `'${pathToURL(initialPath)}' does not exist`
        );
      }

      // resource is a directory
      if (pathSegments.length > 0) {
        return await this._open(pathSegments, opts, resource, initialPath);
      } else if (pathSegments.length === 0 && opts.createMode !== "file") {
        return resource;
      } else {
        // we asked for a file and got a directory back
        throw new FileSystemError(
          "IS_NOT_A_FILE",
          `'${pathToURL(
            initialPath
          )}' is not a file (it's a directory and we were expecting it to be a file)`
        );
      }
    }
  }

  async tempURL(): Promise<URL> {
    let tempURL: URL;
    let tempOrigin = "http://tmp";
    while (true) {
      tempURL = new URL(
        `${tempOrigin}${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)}`
      );

      try {
        await this.open(tempURL);
      } catch (err) {
        if (err instanceof FileSystemError && err.code === "NOT_FOUND") {
          return tempURL;
        }
        throw err;
      }
    }
  }

  private async dispatchEvent(url: URL, type: EventType): Promise<void>;
  private async dispatchEvent(path: string, type: EventType): Promise<void>;
  private async dispatchEvent(
    urlOrPath: URL | string,
    type: EventType
  ): Promise<void> {
    if (this.listeners.length === 0) {
      return;
    }
    let url: URL;
    if (typeof urlOrPath === "string") {
      url = pathToURL(urlOrPath);
    } else {
      url = urlOrPath;
    }

    let event: Event = { url, type: type };
    if (type !== "remove") {
      let file = await this.open(url);
      event.stat = file.stat;
    }
    for (let listener of this.listeners) {
      listener(event);
    }
  }

  async displayListing(): Promise<void> {
    let listing = (await this.listAllOrigins(true)).map(({ url, stat }) => ({
      type: stat.type,
      size: stat.type === "directory" ? "-" : stat.size,
      modified:
        stat.type === "directory"
          ? "-"
          : moment(stat.mtime! * 1000).format("MMM D YYYY HH:mm"),
      etag: stat.etag ?? "-",
      url,
    }));
    console.log(columnify(listing));
  }
}

class File {
  buffer?: Uint8Array;
  etag?: string;
  mtime: number;

  constructor() {
    this.mtime = Math.floor(Date.now() / 1000);
  }

  get stat(): Stat {
    return {
      etag: this.etag,
      mtime: this.mtime,
      size: this.buffer ? this.buffer.length : 0,
      type: "file",
    };
  }

  getDescriptor(dispatchEvent: WriteEventDispatcher): FileDescriptor {
    return new FileDescriptor(this, dispatchEvent);
  }

  clone(): File {
    let file = new File();
    file.etag = this.etag;
    if (this.buffer) {
      file.buffer = new Uint8Array(this.buffer);
    }
    return file;
  }
}

class Directory {
  etag?: string;
  readonly files: Files = new Map();

  get stat(): Stat {
    return { etag: this.etag, type: "directory" };
  }

  getDescriptor(): FileDescriptor {
    return new FileDescriptor(this);
  }
}

export class FileDescriptor {
  constructor(
    private resource: File | Directory,
    private readonly dispatchEvent?: WriteEventDispatcher
  ) {}

  setEtag(etag: string) {
    this.resource.etag = etag;
  }

  get stat(): Stat {
    return this.resource.stat;
  }

  async write(buffer: Uint8Array): Promise<void>;
  async write(stream: ReadableStream): Promise<void>;
  async write(text: string): Promise<void>;
  async write(
    streamOrBuffer: ReadableStream | Uint8Array | string
  ): Promise<void> {
    if (this.resource instanceof Directory) {
      throw new FileSystemError("IS_NOT_A_FILE");
    }
    if (streamOrBuffer instanceof Uint8Array) {
      this.resource.buffer = streamOrBuffer;
    } else if (typeof streamOrBuffer === "string") {
      this.resource.buffer = textEncoder.encode(streamOrBuffer);
    } else {
      this.resource.buffer = await readStream(streamOrBuffer);
    }
    this.resource.mtime = Math.floor(Date.now() / 1000);
    await this.dispatchEvent!(); // all descriptors created for files have this dispatcher
  }

  async read(): Promise<Uint8Array> {
    if (this.resource instanceof Directory) {
      throw new FileSystemError("IS_NOT_A_FILE");
    }
    return this.resource.buffer ? this.resource.buffer : new Uint8Array();
  }

  async readText(): Promise<string> {
    if (this.resource instanceof Directory) {
      throw new FileSystemError("IS_NOT_A_FILE");
    }
    return this.resource.buffer ? utf8.decode(this.resource.buffer) : "";
  }

  getReadbleStream(): ReadableStream {
    if (this.resource instanceof Directory) {
      throw new FileSystemError("IS_NOT_A_FILE");
    }
    let buffer = this.resource.buffer;
    return new ReadableStream({
      async start(controller: ReadableStreamDefaultController) {
        if (!buffer) {
          controller.close();
        } else {
          controller.enqueue(new Uint8Array(buffer));
          controller.close();
        }
      },
    });
  }
}

type ErrorCodes = "NOT_FOUND" | "IS_NOT_A_FILE" | "IS_NOT_A_DIRECTORY";
export class FileSystemError extends Error {
  constructor(public readonly code: ErrorCodes, message?: string) {
    super(message ?? code);
  }
}

async function readStream(stream: ReadableStream): Promise<Uint8Array> {
  let reader = stream.getReader();
  let buffers: Uint8Array[] = [];
  while (true) {
    let chunk = await reader.read();
    if (chunk.done) {
      break;
    } else {
      buffers.push(chunk.value);
    }
  }

  let size = buffers.reduce((a, b) => a + b.length, 0);
  let result = new Uint8Array(size);
  let offset = 0;
  for (let buffer of buffers) {
    result.set(buffer, offset);
    offset += buffer.length;
  }
  return result;
}

interface ListingEntry {
  url: URL;
  stat: Stat;
}
interface Stat {
  etag?: string;
  mtime?: number;
  size?: number;
  type: "directory" | "file";
}
type Files = Map<string, File | Directory>;

interface Options {
  createMode?: "file" | "directory";
}
export interface Event {
  url: URL;
  type: EventType;
  stat?: Stat;
}
export type EventListener = (event: Event) => void;
export type EventType = "create" | "write" | "remove";
type WriteEventDispatcher = () => Promise<void>;
