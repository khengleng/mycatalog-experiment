import {
  BuilderNode,
  AllNode,
  Value,
  NodeOutput,
  ConstantNode,
  NextNode,
} from "../../../builder-worker/src/nodes/common";
import {
  FileListingNode,
  WriteFileNode,
  FileNode,
} from "../../../builder-worker/src/nodes/file";
import { ListingEntry } from "../../../builder-worker/src/filesystem";
import {
  FileDescription,
  describeFile,
  isModuleDescription,
  CJSDescription,
} from "../../../builder-worker/src/describe-file";
import { JSParseNode } from "../../../builder-worker/src/nodes/js";
import { File } from "@babel/types";
import { RegionEditor } from "../../../builder-worker/src/code-region";
import { PackageSrcNode } from "./package";

export class MakePkgESCompliantNode implements BuilderNode {
  cacheKey: string;
  constructor(private pkgURL: URL, private pkgSrcNode: PackageSrcNode) {
    this.cacheKey = `make-pkg-es-compliant:${pkgURL.href}`;
  }

  deps() {
    return {
      listing: new PreparePkgForEsCompliance(this.pkgURL, this.pkgSrcNode),
    };
  }

  async run({
    listing,
  }: {
    listing: ListingEntry[];
  }): Promise<NodeOutput<(void | void[])[]>> {
    // get all files (and optionally filter thru recipes config) trying to crawl
    // deps from the file description to find files to introspect, because we're
    // not ready to start resolving yet (and we don't want to be forced into
    // node resolution for the CJS files).
    let files = listing
      .filter(
        // TODO need to include .ts too...
        (entry) => entry.stat.type === "file" && entry.url.href.match(/\.js$/)
      )
      .map((entry) => entry.url);
    return {
      node: new AllNode(
        files.map((file) => new IntrospectSrcNode(file, this.pkgURL))
      ),
    };
  }
}

class PreparePkgForEsCompliance implements BuilderNode {
  cacheKey: string;
  constructor(private pkgURL: URL, private pkgSrcNode: PackageSrcNode) {
    this.cacheKey = `prepare-pkg-es-compliance:${pkgURL.href}`;
  }

  deps() {
    return {
      src: this.pkgSrcNode,
    };
  }

  async run(): Promise<NextNode<ListingEntry[]>> {
    return {
      node: new FileListingNode(new URL("__stage2/", this.pkgURL), true),
    };
  }
}

class IntrospectSrcNode implements BuilderNode {
  cacheKey: string;
  constructor(private url: URL, private pkgURL: URL) {
    this.cacheKey = `introspect-src:${url.href}`;
  }

  deps() {
    return {
      desc: new AnalyzeFileNode(this.url),
    };
  }

  async run({
    desc,
  }: {
    desc: FileDescription;
  }): Promise<NodeOutput<void | void[]>> {
    let url = new URL(
      this.url.href.slice(`${this.pkgURL.href}__stage2/`.length),
      `${this.pkgURL}src/`
    );
    if (isModuleDescription(desc)) {
      return { node: new WriteFileNode(new FileNode(this.url), url) };
    } else {
      return { node: new ESInteropNode(this.url, url, desc) };
    }
  }
}

class ESInteropNode implements BuilderNode {
  cacheKey: string;
  constructor(
    private inputURL: URL,
    private outputURL: URL,
    private desc: CJSDescription
  ) {
    this.cacheKey = `es-interop:${outputURL.href}`;
  }

  deps() {
    return {
      src: new FileNode(this.inputURL),
    };
  }

  async run({ src }: { src: string }): Promise<NodeOutput<void[]>> {
    return {
      node: new AllNode([
        new RewriteCJSNode(this.outputURL, this.desc, src),
        new ESModuleShimNode(this.outputURL),
      ]),
    };
  }
}

function remapRequires(
  origSrc: string,
  desc: CJSDescription,
  depBindingName: string
): string {
  let editor = new RegionEditor(origSrc, desc, () => {
    throw new Error(`Cannot obtain unused binding name for CJS file`);
  });
  for (let [index, require] of desc.requires.entries()) {
    editor.replace(require.requireRegion, `${depBindingName}[${index}]()`);
  }
  return editor.serialize();
}

function depFactoryName(specifier: string): string {
  return `${specifier.replace(/\W/g, "_")}Factory`.replace(/^_+/, "");
}

class RewriteCJSNode implements BuilderNode {
  cacheKey: string;
  constructor(
    private outputURL: URL,
    private desc: CJSDescription,
    private src: string
  ) {
    this.cacheKey = `rewrite-cjs:${outputURL.href}`;
  }

  deps() {}

  async run(): Promise<NodeOutput<void>> {
    let imports = new Set<string>(
      this.desc.requires.map(({ specifier }) =>
        specifier == null
          ? `import { requireHasNonStringLiteralSpecifier } from "@catalogjs/loader";`
          : `import ${depFactoryName(specifier)} from "${specifier}$cjs$";`
      )
    );
    let deps: string[] = this.desc.requires.map(({ specifier }) =>
      specifier == null
        ? `requireHasNonStringLiteralSpecifier("${this.outputURL.href}")`
        : depFactoryName(specifier)
    );
    let depBindingName = "dependencies";
    let count = 0;
    while (this.desc.names.has(depBindingName)) {
      depBindingName = `dependencies${count++}`;
    }
    let newSrc = `${[...imports].join("\n")}
let module;
function implementation() {
  if (!module) {
    module = { exports: {} };
    Function(
      "module",
      "exports",
      "${depBindingName}",
      \`${remapRequires(this.src, this.desc, depBindingName)
        .replace(/`/g, "\\`")
        .replace(/\$/g, "\\$")}\`
    )(module, module.exports, [${deps.join(", ")}]);
  }
  return module.exports;
}
export default implementation;`;
    return {
      node: new WriteFileNode(
        new ConstantNode(newSrc),
        new URL(this.outputURL.href.replace(/\.js$/, ".cjs.js"))
      ),
    };
  }
}

class ESModuleShimNode implements BuilderNode {
  cacheKey: string;
  constructor(private outputURL: URL) {
    this.cacheKey = `es-shim:${outputURL.href}`;
  }

  deps() {}

  async run(): Promise<NodeOutput<void>> {
    let basename = this.outputURL.pathname.split("/").pop();
    let src = `import implementation from "./${basename}$cjs$";
export default implementation();`;
    return {
      node: new WriteFileNode(new ConstantNode(src), this.outputURL),
    };
  }
}

class AnalyzeFileNode implements BuilderNode {
  cacheKey: string;
  constructor(private url: URL) {
    this.cacheKey = `analyze-file:${url.href}`;
  }

  deps() {
    return {
      parsed: new JSParseNode(new FileNode(this.url)),
    };
  }

  async run({ parsed }: { parsed: File }): Promise<Value<FileDescription>> {
    return { value: describeFile(parsed, { filename: this.url.href }) };
  }
}
