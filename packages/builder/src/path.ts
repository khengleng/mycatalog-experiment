export function urlToPath(url: URL): string {
  return join(url.origin.replace(/\//g, "|"), url.pathname);
}

export function pathToURL(path: string): URL {
  if (path.slice(0, 1) === "/") {
    path = path.slice(1);
  }
  let [origin, ...pathParts] = splitPath(path);
  if (pathParts.length === 0) {
    pathParts = ["/"];
  }
  return new URL(join(...pathParts), origin.replace(/\|/g, "/"));
}

export function baseName(path: string): string {
  return splitPath(path).pop()!;
}

export function dirName(path: string): string | undefined {
  // the root dir '/' has no parent dir
  if (path === "/" || !path.includes("/")) return;

  let dirName = path.slice(0, -1 * baseName(path).length - 1);
  if (path.charAt(0) === "/") {
    return dirName || "/";
  }
  return dirName;
}

export function splitPath(path: string): string[] {
  if (path === "/") {
    return ["/"];
  }
  let segments = path.split("/");
  if (segments[0] === "") {
    segments[0] = "/";
  }
  return segments;
}

export function join(...pathParts: string[]): string {
  pathParts = pathParts.filter(Boolean);
  if (pathParts.length === 0) {
    throw new Error("Missing path parts");
  }
  if (pathParts.length === 1 && pathParts[0] === "/") {
    return "/";
  }

  for (let part of pathParts) {
    if (part.slice(0, 1) === "/") {
      part = part.slice(1);
    }
  }
  pathParts = pathParts.map((part) =>
    part.slice(0, 1) === "/" ? part.slice(1) : part
  );

  return `/${pathParts.filter(Boolean).join("/")}`;
}

export function isURL(possibleURL: string): boolean {
  try {
    new URL(possibleURL);
    return true;
  } catch (e) {
    if (e.message.includes("Invalid URL")) {
      return false;
    }
    throw e;
  }
}
