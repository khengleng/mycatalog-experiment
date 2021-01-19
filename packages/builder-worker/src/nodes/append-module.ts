import { BuilderNode, Value, NodeOutput } from "./common";
import { makeNonCyclic, ModuleResolution } from "./resolution";
import {
  declarationsMap,
  ModuleDescription,
  ensureImportSpecifier,
  ExportAllMarker,
  ExportAllExportDescription,
} from "../describe-file";
import {
  isNamespaceMarker,
  NamespaceMarker,
  RegionPointer,
  DeclarationCodeRegion,
  CodeRegion,
  GeneralCodeRegion,
  ReferenceCodeRegion,
  documentPointer,
  ImportCodeRegion,
  LocalDeclarationDescription,
  DeclarationDescription,
  DocumentCodeRegion,
} from "../code-region";
import { RegionEditor, assignCodeRegionPositions } from "../region-editor";
import { BundleAssignment } from "./bundle";
import { maybeRelativeURL } from "../path";
import { HeadState, ModuleRewriter } from "../module-rewriter";
import {
  DependencyResolver,
  resolutionForPkgDepDeclaration,
  ResolvedDeclarationDependency,
  UnresolvedResult,
} from "../dependency-resolution";
import { depAsURL, Dependencies } from "./entrypoint";
import { setDoubleNestedMapping, stringifyReplacer } from "../utils";
import { flatMap } from "lodash";
import { pkgInfoFromCatalogJsURL } from "../resolver";
import { log, debug } from "../logger";

export class AppendModuleNode implements BuilderNode {
  cacheKey: string;
  constructor(
    private state: HeadState,
    private module: ModuleResolution,
    private bundle: URL,
    private editor: RegionEditor,
    private bundleAssignments: BundleAssignment[],
    private dependencies: Dependencies,
    private depResolver: DependencyResolver,
    private rewriters: ModuleRewriter[] = []
  ) {
    let start = Date.now();
    debug(
      `  creating append node for ${this.bundle.href}:${this.module.url.href}`
    );
    this.cacheKey = `append-module-node:${this.bundle.href}:${
      this.module.url.href
    }:${this.state.hash()}`;
    debug(`  completed creating append node in ${Date.now() - start}ms`);
  }

  async deps() {}

  async run(): Promise<NodeOutput<{ code: string; desc: ModuleDescription }>> {
    let rewriter = new ModuleRewriter(
      this.bundle,
      this.module,
      this.state,
      this.bundleAssignments,
      this.editor,
      this.dependencies,
      this.depResolver
    );
    // the entries in the head state are reversed from what we initialized it
    // with so as to increase the likelihood of bindings to retain their names
    // the closer they are to the entrypoints. As such, we unshift the rewriters
    // into the list of rewriters so they go back into the order that they
    // should be emitted when serializing the bundle.
    let rewriters = [rewriter, ...this.rewriters];
    let { module, editor } = this.state.next() ?? {};
    if (module && editor) {
      let node = new AppendModuleNode(
        this.state,
        module,
        this.bundle,
        editor,
        this.bundleAssignments,
        this.dependencies,
        this.depResolver,
        rewriters
      );

      if (typeof process?.stdout?.write === "function") {
        process.stdout.write(
          `  creating append builder node for module ${this.state.visited.length} for bundle ${this.bundle.href}\r`
        );
        if (this.state.visited.length === this.state.editorCount) {
          console.log();
        }
      }
      return { node };
    } else {
      return {
        node: new FinishAppendModulesNode(
          this.state,
          this.bundle,
          this.bundleAssignments,
          this.dependencies,
          rewriters,
          this.depResolver
        ),
      };
    }
  }
}

type DeclarationRegionMap = Map<
  string,
  {
    pointer: RegionPointer;
    references: Set<RegionPointer>;
    original?: LocalDeclarationDescription["original"];
  }
>;

type ReferenceMappings = Map<
  RegionPointer,
  { declaration: DeclarationDescription; module: ModuleResolution }
>;

export class FinishAppendModulesNode implements BuilderNode {
  cacheKey: string;
  constructor(
    private state: HeadState,
    private bundle: URL,
    private bundleAssignments: BundleAssignment[],
    private dependencies: Dependencies,
    private rewriters: ModuleRewriter[],
    private depResolver: DependencyResolver
  ) {
    this.cacheKey = `finish-append-module-node:${
      this.bundle.href
    }:${this.state.hash()}`;
  }

  async deps() {}

  async run(): Promise<Value<{ code: string; desc: ModuleDescription }>> {
    let bundleDeclarations: DeclarationRegionMap = new Map();
    let referenceMappings: ReferenceMappings = new Map();
    let code: string[] = [];
    let regions: CodeRegion[] = [
      // document region for the bundle itself
      {
        position: 0,
        type: "document",
        start: 0,
        end: 0,
        firstChild: 1,
        nextSibling: undefined,
        dependsOn: new Set(),
      },
    ];

    let start = Date.now();
    let importAssignments = assignedImports(
      this.bundle,
      this.bundleAssignments,
      this.state,
      this.depResolver
    );
    let exportAssignments = assignedExports(
      this.bundle,
      this.bundleAssignments,
      this.state,
      this.depResolver
    );
    let prevSibling = buildImports(
      code,
      regions,
      importAssignments,
      bundleDeclarations,
      this.bundle
    );
    prevSibling = buildManufacturedCode(
      code,
      regions,
      prevSibling,
      this.state,
      this.bundleAssignments,
      bundleDeclarations,
      this.depResolver,
      this.bundle
    );
    prevSibling = buildBundleBody(
      code,
      regions,
      prevSibling,
      this.rewriters,
      bundleDeclarations,
      referenceMappings,
      this.bundle,
      this.state,
      this.dependencies,
      this.depResolver
    );
    setReferences(
      regions,
      referenceMappings,
      bundleDeclarations,
      this.state,
      this.depResolver,
      this.bundle
    );
    let { exportRegions, exportSpecifierRegions } = buildExports(
      code,
      regions,
      prevSibling,
      exportAssignments,
      importAssignments,
      bundleDeclarations,
      this.bundle
    );

    if (regions.length === 1) {
      regions[documentPointer].firstChild = undefined;
    }

    assignCodeRegionPositions(regions);

    let desc: ModuleDescription = {
      regions,
      declarations: declarationsMap(regions),
      exports: new Map(),
      imports: [],
    };
    setImportDescription(desc, importAssignments, regions, this.bundle);
    setExportDescription(
      desc,
      exportAssignments,
      exportSpecifierRegions,
      exportRegions,
      this.bundle
    );

    log(
      `  completed serializing bundle ${this.bundle.href} in ${
        Date.now() - start
      }ms`
    );

    return { value: { code: code.join("\n"), desc } };
  }
}

// This manufactures declarations for "export *" that we converted into an
// "import *" because the "export *" was included in a module that is not an
// entrypoint for the bundle--and hence does not effect the bundle's API.
function buildManufacturedCode(
  code: string[],
  regions: CodeRegion[],
  prevSibling: RegionPointer | undefined,
  state: HeadState,
  assignments: BundleAssignment[],
  bundleDeclarations: DeclarationRegionMap,
  depResolver: DependencyResolver,
  bundle: URL
): RegionPointer | undefined {
  let ownAssignments = assignments.filter(
    (a) => a.bundleURL.href === bundle.href
  );
  let declarations: Map<string, Map<string, string>> = new Map(); // namespaceBindingName => <exportedName => assignedName>
  for (let { module } of state.visited) {
    for (let exportDesc of [...module.desc.exports.values()].filter(
      (exportDesc) =>
        exportDesc.type === "export-all" &&
        !ownAssignments.find(
          (a) =>
            a.module.url.href ===
            module.resolvedImports[exportDesc.importIndex].url.href
        )
    ) as ExportAllExportDescription[]) {
      let importedModule = makeNonCyclic(
        module.resolvedImports[exportDesc.importIndex]
      );
      // find all the bindings that import this module that are missing declarations--these are the declarations that we need to manufacture.
      let mappings = state.assignedImportedNames.get(importedModule.url.href);
      if (!mappings) {
        continue;
      }
      let namespaceBinding = mappings.get(NamespaceMarker);
      if (!namespaceBinding) {
        throw new Error(
          `missing manufactured namespace binding for the namespace import that corresponds to the export * of ${importedModule.url.href} in module ${module.url.href} within bundle ${bundle.href}`
        );
      }
      for (let [outsideName, assignedName] of mappings) {
        if (isNamespaceMarker(outsideName)) {
          continue;
        }
        let source = depResolver.resolveDeclaration(
          outsideName,
          importedModule,
          module,
          ownAssignments
        );
        if (
          source.type === "unresolved" &&
          !ownAssignments.find(
            (a) =>
              a.module.url.href ===
              (source as UnresolvedResult).importedFromModule.url.href
          )
        ) {
          setDoubleNestedMapping(
            namespaceBinding,
            outsideName,
            assignedName,
            declarations
          );
        }
      }
    }
  }

  for (let [namespaceBinding, mappings] of [...declarations]) {
    let { pointer: importPointer } =
      bundleDeclarations.get(namespaceBinding) ?? {};
    if (importPointer == null) {
      throw new Error(
        `cannot find region for manufactured namespace import '${namespaceBinding}' within bundle ${bundle.href}`
      );
    }
    let declaration: string[] = [`const {`];
    let props: string[] = [];
    for (let [outsideName, assignedName] of mappings) {
      props.push(
        outsideName === assignedName
          ? assignedName
          : `${outsideName}: ${assignedName}`
      );
    }
    declaration.push(props.join(", "), `} = ${namespaceBinding};`);
    code.push(declaration.join(" "));

    if (prevSibling != null) {
      regions[prevSibling].nextSibling = regions.length;
    } else {
      regions[documentPointer].firstChild = regions.length;
    }
    let declarationPointer = regions.length;
    let namespaceBindingReferencePointer = declarationPointer + 1;
    prevSibling = declarationPointer;
    let { references: namespaceReferences } = bundleDeclarations.get(
      namespaceBinding
    )!;
    namespaceReferences.add(namespaceBindingReferencePointer);
    let declarationRegion = {
      type: "general",
      start: 1, // newline
      end: 1, // trailing semicolon
      firstChild: namespaceBindingReferencePointer + 1,
      nextSibling: undefined,
      shorthand: false,
      position: 0,
      dependsOn: new Set([namespaceBindingReferencePointer]),
      preserveGaps: false,
    } as GeneralCodeRegion;
    let namespaceBindingReferenceRegion = {
      type: "reference",
      start: 5 /* " } = " */,
      end: namespaceBinding.length,
      firstChild: undefined,
      nextSibling: undefined,
      position: 0,
      shorthand: false,
      dependsOn: new Set([importPointer]),
    } as ReferenceCodeRegion;
    regions.push(
      declarationRegion,
      namespaceBindingReferenceRegion,
      ...flatMap(
        [...mappings.entries()],
        ([outsideName, assignedName], index) => {
          let declaratorPointer =
            namespaceBindingReferencePointer + 1 + index * 2;
          let referencePointer = declaratorPointer + 1;
          // it's side-effecty, i know, but it's super convenient since we're
          // right there...
          bundleDeclarations.set(assignedName, {
            pointer: declaratorPointer,
            references: new Set([referencePointer]),
          });
          return [
            {
              type: "declaration",
              start: index === 0 ? 8 /* const { " */ : 2 /* ", " */,
              end: 0,
              firstChild: referencePointer,
              nextSibling:
                index === mappings.size - 1
                  ? namespaceBindingReferencePointer
                  : referencePointer + 1,
              position: 0,
              dependsOn: new Set([declarationPointer, referencePointer]),
              preserveGaps: false,
              declaration: {
                type: "local",
                declaredName: assignedName,
                declaratorOfRegion: declarationPointer,
                references: [
                  referencePointer,
                  // this will be populated as we build the body for the bundle
                ],
              },
            } as DeclarationCodeRegion,
            {
              type: "reference",
              start:
                outsideName === assignedName
                  ? 0
                  : outsideName.length + 2 /* "outsideName: " */,
              end: assignedName.length,
              firstChild: undefined,
              nextSibling: undefined,
              shorthand: outsideName === assignedName ? "object" : false,
              position: 0,
              dependsOn: new Set([declaratorPointer]),
            } as ReferenceCodeRegion,
          ];
        }
      )
    );
  }
  return prevSibling;
}

function buildImports(
  code: string[],
  regions: CodeRegion[],
  importAssignments: Map<
    string,
    Map<string | NamespaceMarker | SideEffectMarker, string | null>
  >,
  bundleDeclarations: DeclarationRegionMap,
  bundle: URL
): RegionPointer | undefined {
  // this returns the pointer of the region who would need a nextSibling
  // assignment if we want to add more regions to the document. This would be
  // undefined if there where actually no imports
  let importDeclarations: string[] = [];
  let lastImportDeclarationPointer: RegionPointer | undefined;
  for (let [importIndex, [importSourceHref, mapping]] of [
    ...importAssignments.entries(),
  ].entries()) {
    let importDeclaration: string[] = [];
    let lastSpecifierPointer: RegionPointer | undefined;
    let firstSpecifierPointer: RegionPointer | undefined;
    for (let [declarationIndex, [importedAs, localName]] of [
      ...mapping.entries(),
    ].entries()) {
      if (isSideEffectMarker(importedAs)) {
        let currentImportDeclarationPointer = regions.length;
        let importCode = `import "${maybeRelativeURL(
          new URL(importSourceHref),
          bundle
        )}";`;
        importDeclarations.push(importCode);
        regions.push({
          type: "import",
          importIndex,
          exportType: undefined,
          start: importIndex === 0 ? 0 : 1, // newline
          end: importCode.length,
          firstChild: undefined,
          nextSibling: undefined,
          position: 0,
          dependsOn: new Set(),
          preserveGaps: false,
        } as ImportCodeRegion);
        // this import is a bundle side effect
        regions[documentPointer].dependsOn.add(currentImportDeclarationPointer);
        if (lastImportDeclarationPointer != null) {
          regions[
            lastImportDeclarationPointer
          ].nextSibling = currentImportDeclarationPointer;
        } else {
          regions[documentPointer].firstChild = currentImportDeclarationPointer;
        }
        lastImportDeclarationPointer = currentImportDeclarationPointer;
      } else if (isNamespaceMarker(importedAs)) {
        if (localName == null) {
          throw new Error(
            `bug: missing local name for import '${importedAs}' from ${importSourceHref} in bundle ${bundle.href}. should never get here. only side effect imports can have a null local name.`
          );
        }
        if (importDeclaration.length > 0) {
          flushImportDeclarationCode(
            importDeclaration,
            importDeclarations,
            importSourceHref,
            bundle
          );
          if (firstSpecifierPointer == null) {
            throw new Error(
              `bug: missing first import specifier region pointer for '${importDeclaration}' in bundle ${bundle.href}`
            );
          }
          flushImportDeclarationRegion(
            regions,
            importIndex,
            importSourceHref,
            firstSpecifierPointer,
            lastImportDeclarationPointer,
            bundle
          );
          firstSpecifierPointer = undefined;
        }
        let importSource = maybeRelativeURL(new URL(importSourceHref), bundle);
        importDeclarations.push(
          `import * as ${localName} from "${importSource}";`
        );
        let currentImportDeclarationPointer = regions.length;
        let specifierPointer = currentImportDeclarationPointer + 1;
        let referencePointer = specifierPointer + 1;
        let importDeclarationRegion: ImportCodeRegion = {
          type: "import",
          importIndex,
          isDynamic: false,
          start: importIndex === 0 ? 0 : 1, // newline
          end: importSource.length + 9, // " from 'importSource';"
          firstChild: specifierPointer,
          nextSibling: undefined,
          position: 0,
          dependsOn: new Set(),
          exportType: undefined,
          preserveGaps: false,
          specifierForDynamicImport: undefined,
        };

        let specifierRegion: DeclarationCodeRegion = {
          type: "declaration",
          start: 7 /* "import " */,
          end: 0, // declaration ends at the same place as enclosing reference
          firstChild: referencePointer,
          nextSibling: undefined,
          position: 0,
          dependsOn: new Set([referencePointer]),
          preserveGaps: false,
          declaration: {
            type: "import",
            declaredName: localName,
            references: [referencePointer],
            importedName: NamespaceMarker,
            importIndex,
          },
        };
        regions.push(importDeclarationRegion, specifierRegion, {
          type: "reference",
          start: 5 /* "* as " */,
          end: localName.length,
          firstChild: undefined,
          nextSibling: undefined,
          shorthand: false,
          position: 0,
          dependsOn: new Set([specifierPointer]),
        } as ReferenceCodeRegion);

        bundleDeclarations.set(localName, {
          pointer: specifierPointer,
          references: new Set([...specifierRegion.declaration.references]),
        });
        if (lastImportDeclarationPointer != null) {
          regions[
            lastImportDeclarationPointer
          ].nextSibling = currentImportDeclarationPointer;
        } else {
          regions[documentPointer].firstChild = currentImportDeclarationPointer;
        }
        lastImportDeclarationPointer = currentImportDeclarationPointer;
      } else {
        if (localName == null) {
          throw new Error(
            `bug: missing local name for import '${importedAs}' from ${importSourceHref} in bundle ${bundle.href}. should never get here. only side effect imports can have a null local name.`
          );
        }
        let specifierPointer = regions.length;
        if (firstSpecifierPointer == null) {
          firstSpecifierPointer = specifierPointer;
        }
        let referencePointer = specifierPointer + 1;
        importDeclaration.push(
          importedAs === localName
            ? importedAs
            : `${importedAs} as ${localName}`
        );

        let specifierRegion: DeclarationCodeRegion = {
          type: "declaration",
          start: declarationIndex === 0 ? 9 /* "import { " */ : 2 /* ", " */,
          end: 0, // declaration ends at the same place as enclosing reference
          firstChild: referencePointer,
          nextSibling: undefined,
          position: 0,
          dependsOn: new Set([referencePointer]),
          preserveGaps: false,
          declaration: {
            type: "import",
            declaredName: localName,
            references: [referencePointer],
            importedName: importedAs,
            importIndex,
          },
        };
        regions.push(specifierRegion, {
          type: "reference",
          start:
            importedAs === localName
              ? 0
              : importedAs.length + 4 /* "importedAs as " */,
          end: localName.length,
          firstChild: undefined,
          nextSibling: undefined,
          shorthand: importedAs === localName ? "import" : false,
          position: 0,
          dependsOn: new Set([specifierPointer]),
        } as ReferenceCodeRegion);
        bundleDeclarations.set(localName, {
          pointer: specifierPointer,
          references: new Set([...specifierRegion.declaration.references]),
        });
        if (lastSpecifierPointer != null) {
          regions[lastSpecifierPointer].nextSibling = specifierPointer;
        }
        lastSpecifierPointer = specifierPointer;
      }
    }
    if (importDeclaration.length > 0) {
      flushImportDeclarationCode(
        importDeclaration,
        importDeclarations,
        importSourceHref,
        bundle
      );
      if (firstSpecifierPointer == null) {
        throw new Error(
          `bug: missing first import specifier region pointer for '${importDeclaration}' in bundle ${bundle.href}`
        );
      }
      let currentImportDeclarationPointer = regions.length;
      flushImportDeclarationRegion(
        regions,
        importIndex,
        importSourceHref,
        firstSpecifierPointer,
        lastImportDeclarationPointer,
        bundle
      );
      lastImportDeclarationPointer = currentImportDeclarationPointer;
    }
  }
  if (importDeclarations.length > 0) {
    code.push(importDeclarations.join("\n"));
  }
  return lastImportDeclarationPointer;
}

function buildExports(
  code: string[],
  regions: CodeRegion[],
  prevSibling: RegionPointer | undefined,
  exportAssignments: {
    exports: Map<string, string>; // outside name -> inside name
    reexports: Map<string, Map<string, string>>; // bundle href -> [outside name => inside name]
    exportAlls: Set<string>; // bundle hrefs
  },
  importAssignments: Map<
    string,
    Map<string | NamespaceMarker | SideEffectMarker, string | null>
  >,
  bundleDeclarations: DeclarationRegionMap,
  bundle: URL
): {
  exportRegions: Map<string, RegionPointer>;
  exportSpecifierRegions: Map<string, RegionPointer>;
} {
  let { exports, reexports, exportAlls } = exportAssignments!;
  let exportRegions: Map<string, RegionPointer> = new Map();
  let exportSpecifierRegions: Map<string, RegionPointer> = new Map();

  if (exports.size > 0) {
    let exportDeclarations: string[] = [];
    exportDeclarations.push("export {");
    exportDeclarations.push(
      [...exports]
        .map(([outsideName, insideName]) =>
          outsideName === insideName
            ? outsideName
            : `${insideName} as ${outsideName}`
        )
        .join(", ")
    );
    exportDeclarations.push("};");
    code.push(exportDeclarations.join(" "));

    if (prevSibling != null) {
      regions[prevSibling].nextSibling = regions.length;
    } else {
      regions[documentPointer].firstChild = regions.length;
    }
    exportRegions.set(bundle.href, regions.length);
    prevSibling = buildExportNamedDeclaration(
      exports,
      regions,
      exportSpecifierRegions,
      bundleDeclarations,
      bundle
    );
  }

  if (reexports.size > 0) {
    for (let [reexportIndex, [bundleHref, mapping]] of [
      ...reexports.entries(),
    ].entries()) {
      let source = maybeRelativeURL(new URL(bundleHref), bundle);
      let exportDeclarations: string[] = [];
      exportDeclarations.push("export {");
      exportDeclarations.push(
        [...mapping]
          .map(([outsideName, insideName]) =>
            outsideName === insideName
              ? outsideName
              : `${insideName} as ${outsideName}`
          )
          .join(", ")
      );
      exportDeclarations.push(`} from "${source}";`);
      let reexportDeclaration = exportDeclarations.join(" ");
      code.push(reexportDeclaration);

      if (prevSibling != null) {
        regions[prevSibling].nextSibling = regions.length;
      } else {
        regions[documentPointer].firstChild = regions.length;
      }
      exportRegions.set(bundleHref, regions.length);
      prevSibling = regions.length;
      let importIndex = [...importAssignments.keys()].findIndex(
        (importedBundleHref) => bundleHref === importedBundleHref
      );
      if (importIndex === -1) {
        importIndex = importAssignments.size + reexportIndex;
      }
      regions.push({
        type: "import",
        position: 0,
        firstChild: undefined,
        nextSibling: undefined,
        start: 1, // newline
        end: reexportDeclaration.length,
        dependsOn: new Set(),
        preserveGaps: false,
        isDynamic: false,
        exportType: "reexport",
        specifierForDynamicImport: undefined,
        importIndex,
      });
    }
  }

  if (exportAlls.size > 0) {
    for (let [exportAllIndex, bundleHref] of [...exportAlls].entries()) {
      let source = maybeRelativeURL(new URL(bundleHref), bundle);
      let exportAllDeclaration = `export * from "${source}";`;
      code.push(exportAllDeclaration);

      if (prevSibling != null) {
        regions[prevSibling].nextSibling = regions.length;
      } else {
        regions[documentPointer].firstChild = regions.length;
      }
      exportRegions.set(bundleHref, regions.length);
      prevSibling = regions.length;
      let importIndex = [...importAssignments.keys()].findIndex(
        (importedBundleHref) => bundleHref === importedBundleHref
      );
      if (importIndex === -1) {
        importIndex = importAssignments.size + exportAllIndex;
      }
      regions.push({
        type: "import",
        position: 0,
        firstChild: undefined,
        nextSibling: undefined,
        start: 1, // newline
        end: exportAllDeclaration.length,
        dependsOn: new Set(),
        preserveGaps: false,
        isDynamic: false,
        exportType: "export-all",
        specifierForDynamicImport: undefined,
        importIndex,
      });
    }
  }

  if (
    importAssignments.size === 0 &&
    exports.size === 0 &&
    reexports.size === 0 &&
    exportAlls.size === 0
  ) {
    let emptyExport = "export {};";
    code.push(emptyExport);
    regions[0].end += emptyExport.length + 1; // add one char for the newline
  }
  return { exportRegions, exportSpecifierRegions };
}

function buildExportNamedDeclaration(
  exportMappings: Map<string, string>, // outsideName -> insideName
  regions: CodeRegion[],
  specifierRegions: Map<string, RegionPointer>,
  bundleDeclarations: DeclarationRegionMap,
  bundle: URL
): RegionPointer | undefined {
  regions.push({
    type: "general",
    position: 0,
    firstChild: regions.length + 1,
    nextSibling: undefined,
    start: 1, // newline
    end: 3, // " };"
    dependsOn: new Set(),
    preserveGaps: false,
  });
  let lastSpecifier: RegionPointer | undefined;
  for (let [specifierIndex, [outsideName, insideName]] of [
    ...exportMappings.entries(),
  ].entries()) {
    let currentSpecifier: RegionPointer = regions.length;
    specifierRegions.set(outsideName, currentSpecifier);
    if (lastSpecifier != null) {
      regions[lastSpecifier].nextSibling = currentSpecifier;
    }
    let declaration = bundleDeclarations.get(insideName);
    if (!declaration) {
      throw new Error(
        `bug: cannot find declaration region when building export for '${insideName}' in bundle ${bundle.href}`
      );
    }

    let referencePointer = currentSpecifier + 1;
    // ExportSpecifier region
    regions.push({
      type: "general",
      position: 0,
      firstChild: referencePointer,
      nextSibling: undefined,
      start: specifierIndex === 0 ? 9 /* "export { " */ : 2 /* ", " */,
      end:
        insideName === outsideName
          ? 0
          : 4 + outsideName.length /* " as outsideName" */,
      dependsOn: new Set([referencePointer]),
      preserveGaps: false,
    });

    // Reference region
    regions.push({
      type: "reference",
      position: 0,
      firstChild: undefined,
      nextSibling: undefined,
      start: 0,
      end: insideName.length,
      dependsOn: new Set([declaration.pointer]),
      shorthand: insideName === outsideName ? "export" : false,
    });

    let declarationRegion = regions[
      declaration.pointer
    ] as DeclarationCodeRegion;
    declarationRegion.declaration.references.push(referencePointer);
    lastSpecifier = currentSpecifier;
  }
  return lastSpecifier;
}

function buildBundleBody(
  code: string[],
  regions: CodeRegion[],
  prevSibling: RegionPointer | undefined,
  rewriters: ModuleRewriter[],
  bundleDeclarations: DeclarationRegionMap,
  referenceMappings: ReferenceMappings,
  bundle: URL,
  state: HeadState,
  dependencies: Dependencies,
  depResolver: DependencyResolver
): RegionPointer | undefined {
  // this returns the pointer of the region who would need a nextSibling
  // assignment if we want to add more regions to the document. This would be
  // undefined if there where actually no rewriters

  let prevModuleStartPointer = prevSibling;
  for (let rewriter of rewriters) {
    let { module } = rewriter;
    let namespaceDeclarationPointer = regions.length;
    let namespacesRegions = buildNamespaces(
      code,
      regions.length,
      rewriter,
      bundleDeclarations,
      state,
      bundle
    );

    // backfill references in the declarations consumed by namespace objects
    let referencePointer = regions.length - 1;
    for (let [i, namespaceRegions] of namespacesRegions.entries()) {
      for (let region of namespaceRegions) {
        referencePointer++;
        if (region.type !== "reference") {
          continue;
        }
        let declarationPointer = [...region.dependsOn][0]; // references only have a single dependency to their declaration region
        let declaration = [...bundleDeclarations.values()].find(
          (d) => d.pointer === declarationPointer
        );
        if (!declaration) {
          throw new Error(
            `Cannot find declaration region '${declarationPointer}' that is referenced by namespace object '${rewriter.namespacesAssignments[i]}' in module ${module.url.href} from bundle ${bundle.href}`
          );
        }
        declaration.references.add(referencePointer);
      }
      regions.push(...namespaceRegions);
    }

    let offset = regions.length;
    let { code: moduleCode, regions: moduleRegions } = rewriter.serialize();

    // if the serialized output is empty but we have a namespace object, we need
    // to make a document region that would have otherwise been returned
    if (moduleRegions.length === 0) {
      if (namespacesRegions.length > 0) {
        moduleRegions = [
          {
            position: 0,
            type: "document",
            start: 0,
            end: 0,
            firstChild: undefined,
            nextSibling: undefined,
            dependsOn: new Set(),
            shorthand: false,
          } as DocumentCodeRegion,
        ];
      } else {
        continue;
      }
    } else {
      adjustCodeRegionByOffset(moduleRegions, offset);
      code.push(moduleCode);
    }

    // denote the module side effect regions with consumption info
    let dep = Object.values(dependencies).find((dep) =>
      module.url.href.includes(depAsURL(dep).href)
    );
    if (dep) {
      for (let pointer of moduleRegions[documentPointer].dependsOn) {
        let region = moduleRegions[pointer - offset];
        if (region.type === "general" && region.original) {
          let { pkgURL } = pkgInfoFromCatalogJsURL(
            new URL(region.original.bundleHref)
          )!;
          let resolution = depResolver.resolutionByConsumptionRegion(
            module,
            pointer - offset,
            pkgURL
          );
          if (resolution) {
            region.original.range = resolution.range;
          }
        } else if (region.type === "general" && !region.original) {
          region.original = {
            bundleHref: module.url.href,
            range: dep.range,
          };
        }
      }
    }

    // hoist the module document's side effect dependOn to the bundle's document region
    regions[documentPointer].dependsOn = new Set([
      ...regions[documentPointer].dependsOn,
      ...moduleRegions[documentPointer].dependsOn,
    ]);

    moduleRegions[documentPointer].dependsOn = new Set();

    if (namespacesRegions.length > 0) {
      // stitch the namespace declaration into the first child of the module's
      // document region
      let newSiblingPointer = moduleRegions[documentPointer].firstChild;
      namespacesRegions[
        namespacesRegions.length - 1
      ][0].nextSibling = newSiblingPointer;
      moduleRegions[documentPointer].firstChild = namespaceDeclarationPointer;
      if (newSiblingPointer != null) {
        let newSibling = moduleRegions[newSiblingPointer - offset];
        // make sure we account for newline between namespace declaration and its sibling
        newSibling.start++;
      }
    }

    setReferenceMappings(
      moduleRegions,
      offset,
      bundleDeclarations,
      referenceMappings,
      module,
      bundle
    );

    // wire up the individual module's code regions to each other
    if (prevModuleStartPointer != null) {
      regions[prevModuleStartPointer].nextSibling = offset;
    } else {
      regions[documentPointer].firstChild = offset;
    }
    prevModuleStartPointer = offset;

    // add 1 char to the start to accommodate added newline between each code chunk
    if (rewriter !== rewriters[0] || prevSibling != null) {
      moduleRegions[documentPointer].start++;
    }

    regions.push(...moduleRegions);

    // update the declaration "original" property with the resolved dependency
    // info. (consumption ranges may have been narrowed because of collapsed
    // declaration regions)
    let pkgHrefs = new Set(
      (moduleRegions.filter(
        (r) =>
          r.type === "declaration" &&
          r.declaration.type === "local" &&
          r.declaration.original
      ) as DeclarationCodeRegion[])
        .map(
          (r) =>
            r.declaration.type === "local" &&
            pkgInfoFromCatalogJsURL(new URL(r.declaration.original!.bundleHref))
              ?.pkgURL.href
        )
        .filter(Boolean) as string[]
    );
    // we're spinning though all the declarations we have resolutions for in
    // this pkg that are consumed by this module, not all of them may be used here.
    for (let pkgHref of pkgHrefs) {
      let resolutions = depResolver
        .resolutionsByConsumingModule(new URL(pkgHref), module)
        .filter(
          (r) => r.type === "declaration"
        ) as ResolvedDeclarationDependency[];
      if (resolutions.length === 0) {
        // for newly added bindings from other bundles we won't have a
        // resolution yet--just skip over these as the range being set will be
        // the original consumed range.
        continue;
      }
      let pointers = moduleRegions
        .filter(
          (r) =>
            r.type === "declaration" &&
            r.declaration.type === "local" &&
            r.declaration.original?.bundleHref.startsWith(pkgHref)
        )
        .map((r1) => regions.findIndex((r2) => r1 === r2));
      for (let pointer of pointers) {
        let region = regions[pointer];
        if (
          region.type !== "declaration" ||
          region.declaration.type !== "local" ||
          !region.declaration.original
        ) {
          throw new Error(
            `should never be here, we expected a local declaration region with an original property when creating region ${pointer} in the bundle ${
              bundle.href
            }, but it was ${JSON.stringify(region, stringifyReplacer)}`
          );
        }
        region.declaration.original.range = resolutions[0].range;
      }
    }
  }

  return prevModuleStartPointer;
}

function setReferenceMappings(
  regions: CodeRegion[],
  offset: number,
  bundleDeclarations: DeclarationRegionMap,
  referenceMappings: ReferenceMappings,
  module: ModuleResolution,
  bundle: URL
) {
  for (let region of regions.filter(
    (r) => r.type === "declaration"
  ) as DeclarationCodeRegion[]) {
    let { declaration } = region;
    if (declaration.type === "local") {
      bundleDeclarations.set(declaration.declaredName, {
        pointer: regions.findIndex((r) => r === region) + offset,
        references: new Set(declaration.references),
      });
    }
  }

  for (let [pointer, region] of regions.entries()) {
    if (region.type !== "reference") {
      continue;
    }
    let declarationRegion: CodeRegion;
    // TODO let's get rid of this negative pointer stuff be passing in all the
    // regions that we can constructed so far when we serialize a rewriter,
    // that way we won't have to handle it here

    // a negative pointer is our indication that the declaration region for
    // the reference has been stripped out (e.g. it was an internal import
    // that was collapsed), and that we can find the stripped out declaration
    // region in the original set of module regions when we remove the sign
    // from the negative pointer. the goal is to figure out the assigned name
    // for declaration so we can marry up this reference to the declaration
    // that lives outside of this module.
    let declarationPointer = [...region.dependsOn][0]; // a reference region should always depend on just it's declaration region
    if (declarationPointer == null) {
      throw new Error(
        `bug: encountered a reference region that does not depend on it's declaration region: pointer=${pointer}, region=${JSON.stringify(
          region,
          stringifyReplacer
        )}, module=${module.url.href}, while making bundle ${bundle.href}`
      );
    }
    if (declarationPointer < 0) {
      declarationRegion = module.desc.regions[-1 * declarationPointer];
    } else {
      declarationRegion = regions[declarationPointer - offset];
    }
    if (declarationRegion?.type !== "declaration") {
      continue;
    }
    referenceMappings.set(pointer + offset, {
      declaration: declarationRegion.declaration,
      module,
    });
  }
}

function setReferences(
  regions: CodeRegion[],
  referenceMappings: ReferenceMappings,
  bundleDeclarations: DeclarationRegionMap,
  state: HeadState,
  depResolver: DependencyResolver,
  bundle: URL
) {
  for (let [pointer, { module, declaration }] of referenceMappings) {
    let region = regions[pointer];
    if (region.type !== "reference") {
      throw new Error(
        `bug: should never be here--only reference regions exist within the referenceMapping. bad region is ${pointer} in bundle ${
          bundle.href
        }: ${JSON.stringify(region, stringifyReplacer)}`
      );
    }
    let declarationPointer = [...region.dependsOn][0]; // a reference region should always depend on just it's declaration region
    let resolution = resolutionForPkgDepDeclaration(
      module,
      declaration.declaredName,
      depResolver
    );
    let assignedName: string | undefined;
    if (resolution?.importedSource) {
      assignedName = state.assignedImportedNames
        .get(resolution.source)
        ?.get(resolution.name);
    } else if (declaration.type === "import" || declarationPointer < 0) {
      assignedName = state.nameAssignments
        .get(module.url.href)
        ?.get(declaration.declaredName);
    } else {
      continue;
    }

    if (!assignedName) {
      throw new Error(
        `bug: could not find assigned name for import '${declaration.declaredName}' in ${module.url.href} from bundle ${bundle.href}`
      );
    }
    let bundleDeclaration = bundleDeclarations.get(assignedName);
    if (!bundleDeclaration) {
      throw new Error(
        `bug: could not find declaration region for the assigned name '${assignedName}' in bundle ${bundle.href}`
      );
    }
    bundleDeclaration.references.add(pointer);
    if (declarationPointer < 0) {
      region.dependsOn = new Set([bundleDeclaration.pointer]);
    }
  }

  for (let { pointer, references, original } of bundleDeclarations.values()) {
    let region = regions[pointer];
    if (region.type !== "declaration") {
      throw new Error(`bug: 'should never get here'`);
    }
    region.declaration.references = [
      ...new Set([...region.declaration.references, ...references]),
    ];
    if (original && region.declaration.type === "local") {
      region.declaration.original = { ...original };
    }
  }
}

function buildNamespaces(
  code: string[],
  offset: number,
  rewriter: ModuleRewriter,
  bundleDeclarations: DeclarationRegionMap,
  state: HeadState,
  bundle: URL
): CodeRegion[][] {
  let namespacesRegions: CodeRegion[][] = [];
  if (rewriter.namespacesAssignments.length > 0) {
    let previousDeclarationRegion: GeneralCodeRegion | undefined;
    let count = 0;
    for (let assignedName of rewriter.namespacesAssignments) {
      let declarationPointer: RegionPointer =
        offset +
        namespacesRegions.reduce((sum, regions) => (sum += regions.length), 0);
      let declarationRegion: GeneralCodeRegion | undefined;
      let regions: CodeRegion[] = [];
      let { nameMap, importedModule, resolution } =
        state.assignedNamespaces.get(assignedName) ?? {};
      if (nameMap && nameMap?.size > 0 && importedModule) {
        let declarationCode: string[] = [`const ${assignedName} = {`];
        declarationCode.push(
          [...nameMap]
            .map(([outsideName, insideName]) =>
              outsideName === insideName
                ? outsideName
                : `${outsideName}: ${insideName}`
            )
            .join(", ")
        );
        declarationCode.push(`};`);
        code.push(declarationCode.join(" "));
        let declaratorPointer = declarationPointer + 1;
        let referencePointer = declaratorPointer + 1;
        declarationRegion = {
          type: "general",
          start: count++ > 0 ? 1 : 0, // the first newline is accounted for by the parent region, otherwise add a newline
          end: 1, // trailing semicolon
          firstChild: declaratorPointer,
          nextSibling: undefined,
          position: 0,
          dependsOn: new Set(),
          preserveGaps: false,
        };
        let declaratorRegion: DeclarationCodeRegion = {
          type: "declaration",
          start: 6, // "const ",
          end: 2, // " }"
          firstChild: referencePointer,
          nextSibling: undefined,
          position: 0,
          dependsOn: new Set([
            declarationPointer,
            referencePointer,
            ...[...nameMap.keys()].map(
              (_, index) => referencePointer + 1 + index
            ),
          ]),
          preserveGaps: false,
          declaration: {
            type: "local",
            source: importedModule.url.href,
            declaredName: assignedName,
            declaratorOfRegion: declarationPointer,
            references: [
              referencePointer,
              // this will be populated as we build the body for the bundle
            ],
          },
        };
        if (resolution && declaratorRegion.declaration.type === "local") {
          declaratorRegion.declaration.original = {
            bundleHref: resolution.bundleHref,
            range: resolution.range,
            importedAs: NamespaceMarker,
          };
        }
        let referenceRegion: ReferenceCodeRegion = {
          type: "reference",
          start: 0, // the reference starts at the same location as its declarator
          end: assignedName.length,
          firstChild: undefined,
          nextSibling: referencePointer + 1,
          shorthand: false,
          position: 0,
          dependsOn: new Set([declaratorPointer]),
        };
        regions.push(
          declarationRegion,
          declaratorRegion,
          referenceRegion,
          ...[...nameMap].map(([outsideName, insideName], index) => {
            let declaration = bundleDeclarations.get(insideName);
            if (!declaration) {
              throw new Error(
                `bug: can't find declaration for item '${insideName}' in namespace object '${assignedName}' in bundle ${bundle.href}`
              );
            }
            return {
              type: "reference",
              start:
                index === 0
                  ? outsideName === insideName
                    ? 5 /* " = { " */
                    : outsideName.length + 7 /* " = { outsideName: " */
                  : outsideName === insideName
                  ? 2 /* ", "*/
                  : outsideName.length + 4 /* ", outsideName: " */,
              end: insideName.length,
              firstChild: undefined,
              nextSibling:
                index === nameMap!.size - 1
                  ? undefined
                  : referencePointer + index + 2,
              shorthand: outsideName === insideName ? "object" : false,
              position: 0,
              dependsOn: new Set([declaration.pointer]),
            } as ReferenceCodeRegion;
          })
        );
        bundleDeclarations.set(assignedName, {
          pointer: declaratorPointer,
          references: new Set(declaratorRegion.declaration.references),
        });
        // we remove the namespace entry from the state as a way to make sure
        // that we don't write out the namespace declaration again if another
        // module imports the same namespace
        state.assignedNamespaces.delete(assignedName);
        namespacesRegions.push(regions);

        if (previousDeclarationRegion) {
          previousDeclarationRegion.nextSibling = declarationPointer;
        }
        previousDeclarationRegion = declarationRegion;
      }
    }
  }
  return namespacesRegions;
}

function flushImportDeclarationCode(
  importDeclaration: string[],
  importDeclarations: string[],
  importSourceHref: string,
  bundle: URL
) {
  importDeclarations.push(
    `import { ${importDeclaration.join(", ")} } from "${maybeRelativeURL(
      new URL(importSourceHref),
      bundle
    )}";`
  );
  importDeclaration.splice(0, importDeclaration.length);
}

function flushImportDeclarationRegion(
  regions: CodeRegion[],
  importIndex: number,
  importSourceHref: string,
  firstSpecifierPointer: RegionPointer,
  lastImportDeclarationPointer: RegionPointer | undefined,
  bundle: URL
) {
  let currentImportDeclarationPointer = regions.length;
  let importSource = maybeRelativeURL(new URL(importSourceHref), bundle);
  regions.push({
    type: "import",
    importIndex,
    exportType: undefined,
    start: importIndex === 0 ? 0 : 1, // newline
    end: importSource.length + 11, // " } from 'importSource';"
    firstChild: firstSpecifierPointer,
    nextSibling: undefined,
    position: 0,
    isDynamic: false,
    dependsOn: new Set(),
    shorthand: false,
    preserveGaps: false,
    specifierForDynamicImport: undefined,
  } as ImportCodeRegion);
  if (lastImportDeclarationPointer != null) {
    regions[
      lastImportDeclarationPointer
    ].nextSibling = currentImportDeclarationPointer;
  } else {
    regions[documentPointer].firstChild = currentImportDeclarationPointer;
  }
}

function adjustCodeRegionByOffset(regions: CodeRegion[], offset: number) {
  for (let region of regions) {
    region.firstChild = offsetPointer(region.firstChild, offset);
    region.nextSibling = offsetPointer(region.nextSibling, offset);
    region.dependsOn = new Set(
      [...region.dependsOn].map((r) => offsetPointer(r, offset)!)
    );
    if (region.type === "declaration") {
      region.declaration.references = region.declaration.references.map(
        (r) => offsetPointer(r, offset)!
      );
      if (region.declaration.type === "local") {
        region.declaration.declaratorOfRegion = offsetPointer(
          region.declaration.declaratorOfRegion,
          offset
        );
      }
    }
  }
}

function offsetPointer(
  pointer: number | undefined,
  offset: number
): number | undefined {
  if (pointer == null) {
    return;
  }
  if (pointer < 0) {
    return pointer;
  }
  return pointer + offset;
}

function setImportDescription(
  desc: ModuleDescription,
  assignedImports: Map<
    string,
    Map<string | NamespaceMarker | SideEffectMarker, string | null>
  >,
  regions: CodeRegion[],
  bundle: URL
) {
  for (let [importIndex, [bundleHref]] of [...assignedImports].entries()) {
    let pointer = regions.findIndex(
      (r) => r.type === "import" && r.importIndex === importIndex
    );
    if (pointer === -1) {
      throw new Error(
        `cannot find import code region for the import of ${bundleHref} with an import index of ${importIndex} when building bundle ${bundle.href}`
      );
    }
    let newIndex = ensureImportSpecifier(
      desc,
      maybeRelativeURL(new URL(bundleHref), bundle),
      pointer,
      false
    );
    if (newIndex !== importIndex) {
      throw new Error(
        `import index mismatch, expecting ${bundleHref} to have an importIndex of ${importIndex}, but was ${newIndex} when building bundle ${bundleHref}`
      );
    }
  }
  let dynamicImports = regions
    .filter((r) => r.type === "import" && r.isDynamic)
    .sort(({ position: a }, { position: b }) => a - b) as ImportCodeRegion[];
  for (let region of dynamicImports) {
    if (region.type !== "import" || !region.isDynamic) {
      continue;
    }
    desc.imports.push({
      isDynamic: true,
      // dynamic import regions only depend on their specifier regions
      specifierRegion: [...region.dependsOn][0],
      specifier: region.specifierForDynamicImport!,
    });
  }
}

function setExportDescription(
  desc: ModuleDescription,
  {
    exports,
    reexports,
    exportAlls,
  }: {
    exports: Map<string, string>;
    reexports: Map<string, Map<string, string>>;
    exportAlls: Set<string>;
  },
  exportSpecifierRegions: Map<string, RegionPointer>,
  exportRegions: Map<string, RegionPointer>,
  bundle: URL
) {
  let exportDesc: ModuleDescription["exports"] = new Map();
  for (let [outsideName, insideName] of exports.entries()) {
    exportDesc.set(outsideName, {
      type: "local",
      name: insideName,
      exportRegion: exportSpecifierRegions.get(outsideName)!,
    });
  }
  for (let [bundleHref, mapping] of reexports.entries()) {
    let exportRegion = exportRegions.get(bundleHref)!;
    for (let [outsideName, insideName] of mapping.entries()) {
      exportDesc.set(outsideName, {
        type: "reexport",
        importIndex: ensureImportSpecifier(
          desc,
          maybeRelativeURL(new URL(bundleHref), bundle),
          exportRegion,
          true
        ),
        name: insideName,
        exportRegion: exportRegions.get(bundleHref)!,
      });
    }
  }
  for (let bundleHref of exportAlls) {
    let exportRegion = exportRegions.get(bundleHref)!;
    let source = maybeRelativeURL(new URL(bundleHref), bundle);
    let marker: ExportAllMarker = { exportAllFrom: source };
    exportDesc.set(marker, {
      type: "export-all",
      importIndex: ensureImportSpecifier(desc, source, exportRegion, true),
      exportRegion,
    });
  }
  desc.exports = exportDesc;
}

function assignedExports(
  bundle: URL,
  assignments: BundleAssignment[],
  state: HeadState,
  depResolver: DependencyResolver
): {
  exports: Map<string, string>; // outside name -> inside name
  reexports: Map<string, Map<string, string>>; // bundle href -> [outside name => inside name]
  exportAlls: Set<string>; // bundle hrefs
} {
  let exports: Map<string, string> = new Map();
  let reexports: Map<string, Map<string, string>> = new Map();
  let exportAlls: Set<string> = new Set();
  let ownAssignments = assignments.filter(
    (a) => a.bundleURL.href === bundle.href
  );
  for (let assignment of ownAssignments) {
    let { module } = assignment;
    let importedFrom = module;
    for (let [original, exposedAs] of assignment.exposedNames.entries()) {
      let exportDesc = module.desc.exports.get(original);
      if (exportDesc && exportDesc.type === "local") {
        let resolution = resolutionForPkgDepDeclaration(
          module,
          exportDesc.name,
          depResolver
        );
        if (resolution) {
          if (isNamespaceMarker(resolution.name)) {
            throw new Error("unimplemented");
          }
          if (!resolution.importedSource) {
            let assignedName = state.nameAssignments
              .get(resolution.consumedBy.url.href)
              ?.get(resolution.name);
            if (!assignedName) {
              throw new Error(
                `could not find assigned name for declaration '${resolution.name} in ${resolution.consumedBy.url.href} within bundle ${bundle.href}`
              );
            }
            exports.set(exposedAs, assignedName);
            continue;
          }
          original = resolution.name;
          module = resolution.consumedBy;
          importedFrom = resolution.importedSource.declaredIn;
        }
      }
      let source = depResolver.resolveDeclaration(
        original,
        importedFrom,
        module,
        ownAssignments
      );
      if (source.type === "resolved") {
        // this is an export from within our own bundle
        let assignedName = state.nameAssignments
          .get(source.module.url.href)
          ?.get(source.declaredName);
        if (!assignedName) {
          throw new Error(
            `could not find assigned name for declaration '${source.declaredName} in ${source.module.url.href} within bundle ${bundle.href}`
          );
        }
        exports.set(exposedAs, assignedName);
      } else {
        let assignment = assignments.find(
          (a) =>
            a.module.url.href ===
            (source as UnresolvedResult).importedFromModule.url.href
        )!;
        let assignedName = state.assignedImportedNames
          .get(
            source.resolution
              ? source.resolution.source
              : source.importedFromModule.url.href
          )
          ?.get(source.resolution ? source.resolution.name : source.importedAs);
        if (!assignedName) {
          if (source.importedPointer == null) {
            throw new Error(
              `cannot determine code region that imports (as a reexport or export-all) the module ${source.importedFromModule.url.href} in module ${source.consumingModule.url.href} within bundle ${bundle.href}`
            );
          }
          let region =
            source.consumingModule.desc.regions[source.importedPointer];
          if (region.type !== "import" || !region.exportType) {
            throw new Error(
              `expected code region ${source.importedPointer} in ${
                source.consumingModule.url.href
              } within bundle ${
                bundle.href
              } to be an import region with an export type of "reexport" or "export-all" but instead it is ${JSON.stringify(
                region,
                stringifyReplacer
              )}`
            );
          }
          if (region.exportType === "reexport") {
            setDoubleNestedMapping(
              assignment.bundleURL.href,
              exposedAs,
              source.importedAs,
              reexports
            );
          } else {
            exportAlls.add(assignment.bundleURL.href);
          }
        } else {
          // this is an "import" into the bundle's scope, and then an "export"
          // of that same binding
          exports.set(exposedAs, assignedName);
        }

        if (!ownAssignments.includes(assignment)) {
          if (source.importedPointer == null) {
            throw new Error(
              `bug: don't know which region to expose for '${original}' from module ${source.importedFromModule.url.href} consumed by module ${source.consumingModule.url.href} in bundle ${bundle.href}`
            );
          }
          // This is the region that we were using as a signal that this reexport
          // should be in the bundle, now let's actually remove it (because we are
          // going to refashion it).
          let editors = state.visited
            .filter(
              (v) =>
                v.module.url.href ===
                (source as UnresolvedResult).consumingModule.url.href
            )
            .map(({ editor }) => editor);
          for (let editor of editors) {
            editor.removeRegionAndItsChildren(source.importedPointer);
          }
        }
      }
    }
  }
  return { exports, reexports, exportAlls };
}

const SideEffectMarker = { isSideEffect: true };
type SideEffectMarker = typeof SideEffectMarker;
function isSideEffectMarker(value: any): value is SideEffectMarker {
  return typeof value === "object" && "isSideEffect" in value;
}

function assignedImports(
  bundle: URL,
  assignments: BundleAssignment[],
  state: HeadState,
  depResolver: DependencyResolver
): Map<
  string,
  Map<string | NamespaceMarker | SideEffectMarker, string | null>
> {
  // bundleHref => <exposedName => local name>
  let results: Map<
    string,
    Map<string | NamespaceMarker | SideEffectMarker, string | null>
  > = new Map();
  let ownAssignments = assignments.filter(
    (a) => a.bundleURL.href === bundle.href
  );
  for (let { module, editor } of state.visited) {
    // sort the regions by position in file to get correct order
    let regionInfo = editor
      .includedRegions()
      .map((pointer) => ({ pointer, region: module.desc.regions[pointer] }))
      .sort((a, b) => a.region.position - b.region.position);
    for (let { pointer, region } of regionInfo) {
      if (
        region.type === "import" &&
        region.exportType === "export-all" &&
        ownAssignments[0].entrypointModuleURL.href !== module.url.href
      ) {
        // we manufacture "import *" for "export *" of external
        // bundles that are present in modules that are not entrypoints (meaning that
        // the "export *" is not part of the bundle's API)
        let importedModule = module.resolvedImports[region.importIndex];
        let assignment = assignments.find(
          (a) => a.module.url.href === importedModule.url.href
        )!;
        if (
          !ownAssignments.find(
            (a) => a.bundleURL.href === assignment.bundleURL.href
          )
        ) {
          let assignedName = state.assignedImportedNames
            .get(importedModule.url.href)
            ?.get(NamespaceMarker);
          if (!assignedName) {
            throw new Error(
              `cannot determine the assigned name for the manufactured namespace import that corresponds to the export * from ${importedModule.url.href} in module ${module.url.href} within bundle ${bundle.href}`
            );
          }
          setDoubleNestedMapping(
            assignment.bundleURL.href,
            NamespaceMarker,
            assignedName,
            results
          );
          // This is the region that we were using as a signal that this import
          // should be in the bundle, now let's actually remove it (because we are
          // going to refashion it).
          editor.removeRegionAndItsChildren(pointer);
        }
        continue;
      } else if (region.type !== "declaration" && region.type !== "import") {
        continue;
      }

      // check to see if this is a side-effect only import from another bundle
      if (region.type === "import") {
        if (region.isDynamic || region.exportType) {
          continue;
        }
        let importedModule = module.resolvedImports[region.importIndex];
        let assignment = assignments.find(
          (a) => a.module.url.href === importedModule.url.href
        )!;
        if (
          !ownAssignments.find(
            (a) => a.bundleURL.href === assignment.bundleURL.href
          )
        ) {
          let importsFromBundle = results.get(assignment.bundleURL.href);

          // no need to perform side effect import from bundle if we are already
          // doing a namespace or named import--the side effects will come along for
          // the ride.
          if (!importsFromBundle) {
            importsFromBundle = new Map();
            results.set(assignment.bundleURL.href, importsFromBundle);
            importsFromBundle.set(SideEffectMarker, null);
          }
        }
        // This is the region that we were using as a signal that this import
        // should be in the bundle, now let's actually remove it (because we are
        // going to refashion it).
        editor.removeRegionAndItsChildren(pointer);
        continue;
      }

      let { declaration: desc } = region;
      if (desc.type === "local") {
        continue;
      }

      let importedModule = module.resolvedImports[desc.importIndex];
      let source = depResolver.resolveDeclaration(
        desc.importedName,
        importedModule,
        module,
        ownAssignments
      );
      if (source.type === "resolved") {
        continue;
      }
      let { importedFromModule, importedAs } = source;
      if (
        ownAssignments.find(
          (a) => a.module.url.href === importedFromModule.url.href
        )
      ) {
        continue;
      }

      // This is the region that we were using as a signal that this import
      // should be in the bundle, now let's actually remove it (because we are
      // going to refashion it).
      editor.removeRegionAndItsChildren(pointer);

      let assignment = assignments.find(
        (a) => a.module.url.href === importedFromModule.url.href
      );
      if (!assignment) {
        // this binding is actually a local binding with an "original" property
        // that originally was imported into a module that this bundle already
        // includes
        continue;
      }
      let importsFromBundle = results.get(assignment.bundleURL.href);
      if (!importsFromBundle) {
        importsFromBundle = new Map();
        results.set(assignment.bundleURL.href, importsFromBundle);
      }
      let assignedName = state.assignedImportedNames
        .get(importedFromModule.url.href)
        ?.get(importedAs);
      if (!assignedName) {
        throw new Error(
          `could not find assigned name for import of ${JSON.stringify(
            importedAs
          )} from ${importedFromModule.url.href} in module ${
            source.consumingModule.url.href
          }`
        );
      }
      if (isNamespaceMarker(importedAs)) {
        importsFromBundle.set(NamespaceMarker, assignedName);
      } else {
        let exposedName = assignment.exposedNames.get(importedAs);
        if (!exposedName) {
          throw new Error(
            `tried to import ${importedAs} from ${importedFromModule.url.href} in ${source.consumingModule.url.href} but it is not exposed`
          );
        }
        importsFromBundle.set(exposedName, assignedName);
      }

      // no need to perform side effect import from bundle if we are already
      // doing a namespace or named import--the side effects will come along for
      // the ride.
      if (importsFromBundle.has(SideEffectMarker)) {
        importsFromBundle.delete(SideEffectMarker);
      }
    }
  }

  return results;
}