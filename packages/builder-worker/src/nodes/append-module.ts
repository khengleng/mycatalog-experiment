import { BuilderNode, Value, NodeOutput } from "./common";
import { ModuleResolution } from "./resolution";
import {
  declarationsMap,
  ModuleDescription,
  ensureImportSpecifier,
  ExportAllMarker,
} from "../describe-file";
import {
  isNamespaceMarker,
  assignCodeRegionPositions,
  NamespaceMarker,
  RegionEditor,
  RegionPointer,
  DeclarationCodeRegion,
  CodeRegion,
  GeneralCodeRegion,
  ReferenceCodeRegion,
  documentPointer,
} from "../code-region";
import { BundleAssignment } from "./bundle";
import { maybeRelativeURL } from "../path";
import {
  HeadState,
  ModuleRewriter,
  resolveDeclaration,
} from "../module-rewriter";
import { depAsURL, Dependencies } from "./entrypoint";
import { stringifyReplacer } from "../utils";
import { DependencyResolver } from "./combine-modules";

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
    this.cacheKey = `append-module-node:${this.bundle.href}:${
      this.module.url.href
    }:${this.state.hash()}`;
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
      return {
        node: new AppendModuleNode(
          this.state,
          module,
          this.bundle,
          editor,
          this.bundleAssignments,
          this.dependencies,
          this.depResolver,
          rewriters
        ),
      };
    } else {
      return {
        node: new FinishAppendModulesNode(
          this.state,
          this.bundle,
          this.bundleAssignments,
          this.dependencies,
          rewriters
        ),
      };
    }
  }
}

type DeclarationRegionMap = Map<
  string,
  { pointer: RegionPointer; references: Set<RegionPointer> }
>;

export class FinishAppendModulesNode implements BuilderNode {
  cacheKey: string;
  constructor(
    private state: HeadState,
    private bundle: URL,
    private bundleAssignments: BundleAssignment[],
    private dependencies: Dependencies,
    private rewriters: ModuleRewriter[]
  ) {
    this.cacheKey = `finish-append-module-node:${
      this.bundle.href
    }:${this.state.hash()}`;
  }

  async deps() {}

  async run(): Promise<Value<{ code: string; desc: ModuleDescription }>> {
    let bundleDeclarations: DeclarationRegionMap = new Map();
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
        dependsOn: new Set(), // TODO need to add all module side effects, and all the module scoped declaration side effects
        shorthand: false,
      },
    ];

    let importAssignments = assignedImports(
      this.bundle,
      this.bundleAssignments,
      this.state
    );
    let exportAssignments = assignedExports(
      this.bundle,
      this.bundleAssignments,
      this.state
    );
    let prevSibling = buildImports(
      code,
      regions,
      importAssignments,
      bundleDeclarations,
      this.bundle
    );
    prevSibling = buildBundleBody(
      code,
      regions,
      prevSibling,
      this.rewriters,
      bundleDeclarations,
      this.bundle,
      this.state,
      this.dependencies
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

    assignCodeRegionPositions(regions);

    // TODO need to add module side effect dependencies to all the declarations
    // TODO review the describe-file region finalization code to make sure we
    // perform all the same kind of stuff...

    let desc: ModuleDescription = {
      regions,
      declarations: declarationsMap(regions),
      exports: new Map(),
      imports: [],
    };
    setExportDescription(
      desc,
      exportAssignments,
      exportSpecifierRegions,
      exportRegions
    );

    return { value: { code: code.join("\n"), desc } };
  }
}

function buildImports(
  code: string[],
  regions: CodeRegion[],
  importAssignments: Map<string, Map<string | NamespaceMarker, string> | null>,
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
    if (!mapping) {
      let currentImportDeclarationPointer = regions.length;
      let importCode = `import "${maybeRelativeURL(
        new URL(importSourceHref),
        bundle
      )}";`;
      importDeclarations.push(importCode);
      regions.push({
        type: "general",
        start: importIndex === 0 ? 0 : 1, // newline
        end: importCode.length,
        firstChild: undefined,
        nextSibling: undefined,
        position: 0,
        dependsOn: new Set(),
        shorthand: false,
        preserveGaps: false,
      } as GeneralCodeRegion);
      // this import is a bundle side effect
      regions[documentPointer].dependsOn.add(currentImportDeclarationPointer);
      if (lastImportDeclarationPointer != null) {
        regions[
          lastImportDeclarationPointer
        ].nextSibling = currentImportDeclarationPointer;
      }
      lastImportDeclarationPointer = currentImportDeclarationPointer;
      continue;
    }

    let importDeclaration: string[] = [];
    let lastSpecifierPointer: RegionPointer | undefined;
    let firstSpecifierPointer: RegionPointer | undefined;
    for (let [importedAs, localName] of mapping.entries()) {
      if (isNamespaceMarker(importedAs)) {
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
            lastImportDeclarationPointer
          );
          firstSpecifierPointer = undefined;
        }
        importDeclarations.push(
          `import * as ${localName} from "${maybeRelativeURL(
            new URL(importSourceHref),
            bundle
          )}";`
        );
        let currentImportDeclarationPointer = regions.length;
        let specifierPointer = currentImportDeclarationPointer + 1;
        let referencePointer = specifierPointer + 1;
        let importDeclarationRegion: GeneralCodeRegion = {
          type: "general",
          start: importIndex === 0 ? 0 : 1, // newline
          end: importSourceHref.length + 11, // " } from 'importSourceHref';"
          firstChild: specifierPointer,
          nextSibling: undefined,
          position: 0,
          dependsOn: new Set(),
          shorthand: false,
          preserveGaps: false,
        };

        let specifierRegion: DeclarationCodeRegion = {
          type: "declaration",
          start: 7 /* "import " */,
          end: 0, // declaration ends at the same place as enclosing reference
          firstChild: referencePointer,
          nextSibling: undefined,
          shorthand: false,
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
        }
      } else {
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
          start:
            lastSpecifierPointer == null ? 9 /* "import { " */ : 2 /* ", " */,
          end: 0, // declaration ends at the same place as enclosing reference
          firstChild: referencePointer,
          nextSibling: undefined,
          shorthand: false,
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
        lastImportDeclarationPointer
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
  importAssignments: Map<string, Map<string | NamespaceMarker, string> | null>,
  bundleDeclarations: DeclarationRegionMap,
  bundle: URL
): {
  exportRegions: Map<string, RegionPointer>;
  exportSpecifierRegions: Map<string, RegionPointer>;
} {
  let { exports, reexports, exportAlls } = exportAssignments!;
  let exportDeclarations: string[] = [];
  if (exports.size > 0) {
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
  }

  code.push(exportDeclarations.join(" "));
  let exportRegions: Map<string, RegionPointer> = new Map();
  let exportSpecifierRegions: Map<string, RegionPointer> = new Map();
  if (exports.size > 0) {
    if (prevSibling != null) {
      regions[prevSibling].nextSibling = regions.length;
    } else {
      regions[documentPointer].firstChild = regions.length;
    }
    exportRegions.set(bundle.href, regions.length);
    // ExportNamedDeclaration region
    regions.push({
      type: "general",
      position: 0,
      firstChild: regions.length + 1,
      nextSibling: undefined,
      start: 1, // newline
      end: 3, // " };"
      dependsOn: new Set(),
      shorthand: false,
      preserveGaps: false,
    });
    let lastExport: [string, string] | undefined;
    let lastSpecifier: RegionPointer | undefined;
    for (let [outsideName, insideName] of exports.entries()) {
      let declaration = bundleDeclarations.get(insideName);
      if (!declaration) {
        throw new Error(
          `bug: cannot find declaration region when building export for '${insideName}' in bundle ${bundle.href}`
        );
      }
      let currentSpecifier: RegionPointer = regions.length;
      exportSpecifierRegions.set(outsideName, currentSpecifier);
      if (lastSpecifier != null) {
        regions[lastSpecifier].nextSibling = currentSpecifier;
      }

      let referencePointer = currentSpecifier + 1;
      // ExportSpecifier region
      regions.push({
        type: "general",
        position: 0,
        firstChild: referencePointer,
        nextSibling: undefined,
        start: lastExport == null ? 9 /* "export { " */ : 2 /* ", " */,
        end:
          insideName === outsideName
            ? 0
            : 4 + outsideName.length /* " as outsideName" */,
        dependsOn: new Set([referencePointer]),
        shorthand: false,
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
      lastExport = [outsideName, insideName];
    }
  }

  // TODO handle reexports
  // TODO handle export-alls

  if (
    importAssignments.size === 0 &&
    exportAssignments.exports.size === 0 &&
    exportAssignments.reexports.size === 0 &&
    exportAssignments.exportAlls.size === 0
  ) {
    let emptyExport = "export {};";
    code.push(emptyExport);
    regions[0].end += emptyExport.length + 1; // add one char for the newline
  }
  return { exportRegions, exportSpecifierRegions };
}

function buildBundleBody(
  code: string[],
  regions: CodeRegion[],
  prevSibling: RegionPointer | undefined,
  rewriters: ModuleRewriter[],
  bundleDeclarations: DeclarationRegionMap,
  bundle: URL,
  state: HeadState,
  dependencies: Dependencies
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
    code.push(moduleCode);

    // denote the module side effect regions with consumption info
    let dep = Object.values(dependencies).find((dep) =>
      module.url.href.includes(depAsURL(dep).href)
    );
    if (dep) {
      for (let pointer of moduleRegions[documentPointer].dependsOn) {
        let region = moduleRegions[pointer];
        if (region.type === "general") {
          region.original = {
            bundleHref: module.url.href,
            range: dep.range,
          };
        }
      }
    }

    adjustCodeRegionByOffset(moduleRegions, offset);

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

    discoverReferenceRegions(
      moduleRegions,
      offset,
      bundleDeclarations,
      module,
      state,
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
  }

  for (let { pointer, references } of bundleDeclarations.values()) {
    let region = regions[pointer];
    if (region.type !== "declaration") {
      throw new Error(`bug: 'should never get here'`);
    }
    region.declaration.references = [...references];
  }

  return prevModuleStartPointer;
}

function discoverReferenceRegions(
  regions: CodeRegion[],
  offset: number,
  bundleDeclarations: DeclarationRegionMap,
  module: ModuleResolution,
  state: HeadState,
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
    let importRegion: CodeRegion;
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
      importRegion = module.desc.regions[-1 * declarationPointer];
    } else {
      importRegion = regions[declarationPointer - offset];
    }
    if (
      !importRegion ||
      importRegion.type !== "declaration" ||
      importRegion.declaration.type !== "import"
    ) {
      continue;
    }

    let assignedName = state.nameAssignments
      .get(module.url.href)
      ?.get(importRegion.declaration.declaredName);
    if (!assignedName) {
      throw new Error(
        `bug: could not find assigned name for import '${
          importRegion.declaration.importedName
        }' from ${
          module.resolvedImports[importRegion.declaration.importIndex].url.href
        } in ${module.url.href} from bundle ${bundle.href}`
      );
    }
    let declaration = bundleDeclarations.get(assignedName);
    if (!declaration) {
      throw new Error(
        `bug: could not find declaration region for the assigned name '${assignedName}' in bundle ${bundle.href}`
      );
    }
    declaration.references.add(pointer + offset);
    if (declarationPointer < 0) {
      region.dependsOn = new Set([declaration.pointer]);
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
    for (let [
      index,
      assignedName,
    ] of rewriter.namespacesAssignments.entries()) {
      let declarationPointer: RegionPointer =
        offset +
        namespacesRegions.reduce((sum, regions) => (sum += regions.length), 0);
      let declarationRegion: GeneralCodeRegion | undefined;
      let regions: CodeRegion[] = [];
      let nameMap = state.assignedNamespaces.get(assignedName);
      if (nameMap && nameMap?.size > 0) {
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
          start: index > 0 ? 1 : 0, // the first newline is accounted for by the parent region, otherwise add a newline
          end: 1, // trailing semicolon
          firstChild: declaratorPointer,
          nextSibling: undefined,
          shorthand: false,
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
          shorthand: false,
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
            declaredName: assignedName,
            references: [
              referencePointer,
              // this will be populated as we build the body for the bundle
            ],
          },
        };
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
                  ? 5 /* " = { " */
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
  importDeclaration.unshift(`import {`);
  importDeclaration.push(
    `} from "${maybeRelativeURL(new URL(importSourceHref), bundle)}";`
  );
  importDeclarations.push(importDeclaration.join(" "));
  importDeclaration = [];
}

function flushImportDeclarationRegion(
  regions: CodeRegion[],
  importIndex: number,
  importSourceHref: string,
  firstSpecifierPointer: RegionPointer,
  lastImportDeclarationPointer: RegionPointer | undefined
) {
  let currentImportDeclarationPointer = regions.length;
  regions.push({
    type: "general",
    start: importIndex === 0 ? 0 : 1, // newline
    end: importSourceHref.length + 11, // " } from 'importSourceHref';"
    firstChild: firstSpecifierPointer,
    nextSibling: undefined,
    position: 0,
    dependsOn: new Set(),
    shorthand: false,
    preserveGaps: false,
  } as GeneralCodeRegion);
  if (lastImportDeclarationPointer != null) {
    regions[
      lastImportDeclarationPointer
    ].nextSibling = currentImportDeclarationPointer;
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
  exportRegions: Map<string, RegionPointer>
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
          bundleHref,
          exportRegion,
          true
        ),
        name: insideName,
        exportRegion: exportSpecifierRegions.get(outsideName)!,
      });
    }
  }
  for (let bundleHref of exportAlls) {
    let exportRegion = exportRegions.get(bundleHref)!;
    let marker: ExportAllMarker = { exportAllFrom: bundleHref };
    exportDesc.set(marker, {
      type: "export-all",
      importIndex: ensureImportSpecifier(desc, bundleHref, exportRegion, true),
      exportRegion,
    });
  }
  desc.exports = exportDesc;
}

function assignedExports(
  bundle: URL,
  assignments: BundleAssignment[],
  state: HeadState
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
    for (let [original, exposedAs] of assignment.exposedNames.entries()) {
      let source = resolveDeclaration(original, module, module, ownAssignments);
      if (source.type === "resolved") {
        let assignedName = state.nameAssignments
          .get(source.module.url.href)
          ?.get(source.declaredName);
        if (!assignedName) {
          throw new Error(
            `could not find assigned name for declaration '${source.declaredName} in ${source.module.url.href}`
          );
        }
        exports.set(exposedAs, assignedName);
      } else {
        // TODO deal with NamespaceMarkers and external bundles
        throw new Error("unimplemented");
      }
    }
  }
  return { exports, reexports, exportAlls };
}

function assignedImports(
  bundle: URL,
  assignments: BundleAssignment[],
  state: HeadState
): Map<string, Map<string | NamespaceMarker, string> | null> {
  // bundleHref => <exposedName => local name> if the inner map is null then
  // this is a side effect only import
  let results: Map<
    string,
    Map<string | NamespaceMarker, string> | null
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
      if (region.type !== "declaration" && region.type !== "import") {
        continue;
      }

      // check to see if this is a side-effect only import from another bundle
      if (region.type === "import") {
        let importedModule = module.resolvedImports[region.importIndex];
        let assignment = assignments.find(
          (a) => a.module.url.href === importedModule.url.href
        )!;
        if (
          !ownAssignments.find(
            (a) => a.bundleURL.href === assignment.bundleURL.href
          )
        ) {
          results.set(assignment.bundleURL.href, null);
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
      let source = resolveDeclaration(
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
    }
  }

  return results;
}
