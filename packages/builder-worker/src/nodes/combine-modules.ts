import { BuilderNode, NextNode } from "./common";
import { makeNonCyclic, ModuleResolution, Resolution } from "./resolution";
import { getExportDesc, getExports, ModuleDescription } from "../describe-file";
import {
  DeclarationCodeRegion,
  documentPointer,
  isNamespaceMarker,
  RegionEditor,
  RegionPointer,
} from "../code-region";
import { BundleAssignment, BundleAssignmentsNode } from "./bundle";
import {
  HeadState,
  resolveDeclaration,
  UnresolvedResult,
} from "../module-rewriter";
import { AppendModuleNode, FinishAppendModulesNode } from "./append-module";
import { Dependencies } from "./entrypoint";
import { pkgInfoFromCatalogJsURL, Resolver } from "../resolver";
import {
  ResolvePkgDeps,
  DependencyResolver,
  resolutionForPkgDepDeclaration,
} from "../dependency-resolution";
//@ts-ignore
import { intersect } from "semver-intersect";

export class CombineModulesNode implements BuilderNode {
  cacheKey: CombineModulesNode;
  constructor(
    private bundle: URL,
    private dependencies: Dependencies,
    private resolver: Resolver,
    private bundleAssignmentsNode: BundleAssignmentsNode
  ) {
    this.cacheKey = this;
  }

  async deps() {
    return {
      info: new PrepareCombineModulesNode(
        this.bundle,
        this.dependencies,
        this.bundleAssignmentsNode,
        this.resolver
      ),
    };
  }

  async run({
    info: { assignments, resolutionsInDepOrder, pkgResolutions },
  }: {
    info: {
      assignments: BundleAssignment[];
      resolutionsInDepOrder: ModuleResolution[];
      pkgResolutions: { [pkgName: string]: string };
    };
  }): Promise<NextNode<{ code: string; desc: ModuleDescription }>> {
    let ownAssignments = assignments.filter(
      (a) => a.bundleURL.href === this.bundle.href
    );

    let depResolver = new DependencyResolver(
      this.dependencies,
      pkgResolutions,
      assignments,
      this.bundle
    );

    let exposed = exposedRegions(this.bundle, assignments, depResolver);

    let editors: { module: ModuleResolution; editor: RegionEditor }[] = [];
    let visitedRegions: Map<string, Set<RegionPointer>> = new Map();

    // the exposed regions inherit their order from BundleAssignments which is
    // organized consumers first.
    for (let { pointer, module: resolution } of exposed) {
      let module = makeNonCyclic(resolution);
      let editor: RegionEditor | undefined;
      // use an existing editor if there is one
      ({ editor } =
        editors.find((e) => e.module.url.href === module.url.href) ?? {});
      if (!editor) {
        // otherwise create a new editor and insert it before its consumers
        editor = new RegionEditor(module.source, module.desc);
        let editorAbsoluteIndex = resolutionsInDepOrder.findIndex(
          (m) => m.url.href === module.url.href
        );
        let index = editors.length;
        while (index > 0) {
          if (
            resolutionsInDepOrder.findIndex(
              (m) => m.url.href === editors[index - 1].module.url.href
            ) < editorAbsoluteIndex
          ) {
            break;
          }
          index--;
        }
        editors.splice(index, 0, {
          module,
          editor,
        });
      }
      discoverIncludedRegions(
        this.bundle,
        module,
        pointer,
        editor,
        editors,
        ownAssignments,
        depResolver,
        visitedRegions
      );
    }
    // filter out editors that have only retained solely their document regions,
    // these are no-ops
    editors = editors.filter(
      (e) =>
        !e.editor
          .includedRegions()
          .every((p) => e.editor.regions[p].type === "document")
    );

    let headState = new HeadState(editors);
    let { module, editor } = headState.next() ?? {};
    if (!module || !editor) {
      // this is an empty module, like just "export{};"
      return {
        node: new FinishAppendModulesNode(
          headState,
          this.bundle,
          assignments,
          this.dependencies,
          [],
          depResolver
        ),
      };
    }
    return {
      node: new AppendModuleNode(
        headState,
        module,
        this.bundle,
        editor,
        assignments,
        this.dependencies,
        depResolver
      ),
    };
  }
}

class PrepareCombineModulesNode implements BuilderNode {
  cacheKey: PrepareCombineModulesNode;
  constructor(
    private bundle: URL,
    private dependencies: Dependencies,
    private bundleAssignmentsNode: BundleAssignmentsNode,
    private resolver: Resolver
  ) {
    this.cacheKey = this;
  }

  async deps() {
    return {
      bundleAssignments: this.bundleAssignmentsNode,
    };
  }

  async run({
    bundleAssignments: { assignments, resolutionsInDepOrder },
  }: {
    bundleAssignments: {
      assignments: BundleAssignment[];
      resolutionsInDepOrder: ModuleResolution[];
    };
  }): Promise<
    NextNode<{
      assignments: BundleAssignment[];
      resolutionsInDepOrder: ModuleResolution[];
      pkgResolutions: { [pkgName: string]: string };
    }>
  > {
    return {
      node: new ResolvePkgDeps(
        this.bundle,
        this.dependencies,
        assignments,
        resolutionsInDepOrder,
        this.resolver
      ),
    };
  }
}

function discoverIncludedRegions(
  bundle: URL,
  module: Resolution,
  pointer: RegionPointer,
  editor: RegionEditor,
  editors: { module: ModuleResolution; editor: RegionEditor }[],
  ownAssignments: BundleAssignment[],
  depResolver: DependencyResolver,
  visitedRegions: Map<string, Set<RegionPointer>>
) {
  if (visitedRegions.get(module.url.href)?.has(pointer)) {
    return;
  }
  let visited = visitedRegions.get(module.url.href);
  if (!visited) {
    visited = new Set();
    visitedRegions.set(module.url.href, visited);
  }
  visited.add(pointer);

  let region = module.desc.regions[pointer];
  // collapse module side effects
  if (region.original) {
    let pkgURL = pkgInfoFromCatalogJsURL(new URL(region.original.bundleHref))
      ?.pkgURL;
    if (!pkgURL) {
      throw new Error(
        `Cannot determine pkgURL that corresponds to the bundle URL: ${region.original.bundleHref}`
      );
    }
    let resolutions = depResolver.resolutionsForPkg(pkgURL?.href);
    if (
      !resolutions.find((r) => r.bundleHref === region.original!.bundleHref)
    ) {
      return; // this region has been collapsed
    }
  }

  if (region.type === "declaration" && region.declaration.type === "import") {
    let localDesc = region.declaration;
    let importedModule = makeNonCyclic(module).resolvedImports[
      localDesc.importIndex
    ];
    let importedName = localDesc.importedName;
    ({ module, region, pointer, editor } = resolveDependency(
      importedModule.url.href,
      depResolver,
      makeNonCyclic(module),
      pointer,
      region,
      editor,
      editors
    ));
    if (region.declaration.type === "local") {
      discoverIncludedRegions(
        bundle,
        module,
        pointer,
        editor,
        editors,
        ownAssignments,
        depResolver,
        visitedRegions
      );
    } else {
      let source = resolveDeclaration(
        importedName,
        importedModule,
        module,
        ownAssignments
      );
      if (source.type === "resolved") {
        if (source.module.url.href !== module.url.href) {
          editor = addNewEditor(source.module, editor, editors);
          module = source.module;
          region = editor.regions[source.pointer];
        }
        discoverIncludedRegions(
          bundle,
          source.module,
          source.pointer,
          editor,
          editors,
          ownAssignments,
          depResolver,
          visitedRegions
        );
      } else {
        let consumingModule = makeNonCyclic(source.consumingModule);
        let { importedPointer } = source;
        if (importedPointer == null) {
          throw new Error(
            `bug: could not determine code region pointer for import of ${JSON.stringify(
              source.importedAs
            )} from ${source.importedFromModule.url.href} in module ${
              consumingModule.url.href
            }`
          );
        }
        if (source.consumingModule.url.href !== module.url.href) {
          editor = addNewEditor(source.consumingModule, editor, editors);
        }
        if (
          ownAssignments.find(
            (a) =>
              a.module.url.href ===
              (source as UnresolvedResult).importedFromModule.url.href
          ) &&
          isNamespaceMarker(source.importedAs)
        ) {
          // we mark the namespace import region as something we want to keep as a
          // signal to the Append nodes to manufacture a namespace object for this
          // consumed import--ultimately, though, we will not include this region.
          if (source.importedPointer == null) {
            throw new Error(
              `unable to determine the region for a namespace import '${region.declaration.declaredName}' of ${source.importedFromModule.url.href} from the consuming module ${source.consumingModule.url.href} in bundle ${bundle.href}`
            );
          }
          editor.keepRegion(source.importedPointer);

          let newEditor = addNewEditor(
            source.importedFromModule,
            editor,
            editors
          );
          discoverIncludedRegionsForNamespace(
            bundle,
            source.importedFromModule,
            newEditor,
            editors,
            ownAssignments,
            depResolver,
            visitedRegions
          );
          return; // don't include the dependsOn in this signal
        } else {
          // we mark the external bundle import region as something we want to keep
          // as a signal to the Append nodes that this import is consumed and to
          // include this region in the resulting bundle.
          editor.keepRegion(importedPointer);
          return; // don't include the dependsOn in this signal
        }
      }
    }
  } else if (
    region.type === "declaration" &&
    region.declaration.type === "local" &&
    region.declaration.original
  ) {
    let bundleHref = region.declaration.original.bundleHref;
    let isRegionObviated: boolean;
    ({ module, region, pointer, editor, isRegionObviated } = resolveDependency(
      bundleHref,
      depResolver,
      makeNonCyclic(module),
      pointer,
      region,
      editor,
      editors
    ));
    if (!isRegionObviated) {
      // the region we entered this function with is the region that we actually
      // want to keep.
      editor.keepRegion(pointer);
    }
    discoverIncludedRegions(
      bundle,
      module,
      pointer,
      editor,
      editors,
      ownAssignments,
      depResolver,
      visitedRegions
    );
  } else if (region.type === "import" && !region.isDynamic) {
    // we mark the external bundle import region as something we want to keep
    // as a signal to the Append nodes that this import is consumed and to
    // include this region in the resulting bundle.
    editor.keepRegion(pointer);
    let importedModule = makeNonCyclic(module).resolvedImports[
      region.importIndex
    ];
    if (
      ownAssignments.find((a) => a.module.url.href === importedModule.url.href)
    ) {
      let newEditor = addNewEditor(importedModule, editor, editors);
      discoverIncludedRegions(
        bundle,
        importedModule,
        documentPointer,
        newEditor,
        editors,
        ownAssignments,
        depResolver,
        visitedRegions
      );
    }
    return; // don't include the dependsOn in this signal
  } else {
    editor.keepRegion(pointer);
  }
  for (let depPointer of region.dependsOn) {
    discoverIncludedRegions(
      bundle,
      module,
      depPointer,
      editor,
      editors,
      ownAssignments,
      depResolver,
      visitedRegions
    );
  }
}

function resolveDependency(
  bundleURL: string,
  depResolver: DependencyResolver,
  consumingModule: ModuleResolution,
  pointer: RegionPointer,
  region: DeclarationCodeRegion,
  editor: RegionEditor,
  editors: { module: ModuleResolution; editor: RegionEditor }[]
): {
  isRegionObviated: boolean;
  module: ModuleResolution;
  editor: RegionEditor;
  region: DeclarationCodeRegion;
  pointer: RegionPointer;
} {
  let module: ModuleResolution = consumingModule;
  let pkgURL = pkgInfoFromCatalogJsURL(new URL(bundleURL))?.pkgURL;
  let isRegionObviated = false;
  if (!pkgURL) {
    // not all modules are packages
    return {
      isRegionObviated,
      module,
      editor,
      pointer,
      region,
    };
  }
  let resolution = depResolver
    .resolutionsForPkg(pkgURL?.href)
    .find(
      (r) =>
        (r.consumedBy.url.href === consumingModule.url.href &&
          r.consumedByPointer === pointer) ||
        r.obviatedDependencies.find(
          (o) =>
            o.moduleHref === consumingModule.url.href && o.pointer === pointer
        )
    );

  if (!resolution) {
    // not all modules have dep resolutions
    return {
      isRegionObviated,
      module,
      editor,
      pointer,
      region,
    };
  }
  if (
    resolution.consumedBy.url.href !== consumingModule.url.href ||
    resolution.consumedByPointer !== pointer
  ) {
    // region we entered this function with is actually obviated by a
    // different region
    isRegionObviated = true;
    if (resolution.importedSource) {
      editor = addNewEditor(
        resolution.importedSource.declaredIn,
        editor,
        editors
      );
      module = resolution.importedSource.declaredIn;
      region = editor.regions[
        resolution.importedSource.pointer
      ] as DeclarationCodeRegion;
      pointer = resolution.importedSource.pointer;
    } else {
      editor = addNewEditor(resolution.consumedBy, editor, editors);
      module = resolution.consumedBy;
      region = editor.regions[
        resolution.consumedByPointer
      ] as DeclarationCodeRegion;
      pointer = resolution.consumedByPointer;
    }
  }
  return {
    isRegionObviated,
    module,
    editor,
    pointer,
    region,
  };
}

function discoverIncludedRegionsForNamespace(
  bundle: URL,
  module: Resolution,
  editor: RegionEditor,
  editors: { module: ModuleResolution; editor: RegionEditor }[],
  ownAssignments: BundleAssignment[],
  depResolver: DependencyResolver,
  visitedRegions: Map<string, Set<RegionPointer>>
) {
  let exports = getExports(module);
  for (let [exportName, { module: sourceModule }] of exports.entries()) {
    let source = resolveDeclaration(
      exportName,
      sourceModule,
      module,
      ownAssignments
    );
    if (source.type === "resolved") {
      let currentEditor = editor;
      if (source.module.url.href !== module.url.href) {
        currentEditor = addNewEditor(source.module, editor, editors);
      }
      discoverIncludedRegions(
        bundle,
        source.module,
        source.pointer,
        currentEditor,
        editors,
        ownAssignments,
        depResolver,
        visitedRegions
      );
    } else {
      // we mark the namespace import region as something we want to keep as a
      // signal to the Append nodes to manufacture a namespace object for this
      // import--ultimately, though, we will not include this region.
      let { importedPointer } = source;
      if (importedPointer == null) {
        throw new Error(
          `bug: could not determine code region pointer for import of ${JSON.stringify(
            source.importedAs
          )} from ${source.importedFromModule.url.href} in module ${
            source.consumingModule.url.href
          }`
        );
      }
      if (isNamespaceMarker(source.importedAs)) {
        if (source.consumingModule.url.href !== module.url.href) {
          editor = addNewEditor(source.consumingModule, editor, editors);
        }
        if (source.importedPointer == null) {
          throw new Error(
            `unable to determine the region for a namespace import of ${source.importedFromModule.url.href} from the consuming module ${source.consumingModule.url.href} in bundle ${bundle.href}`
          );
        }
        editor.keepRegion(source.importedPointer);
        let newEditor = addNewEditor(
          source.importedFromModule,
          editor,
          editors
        );
        discoverIncludedRegionsForNamespace(
          bundle,
          source.importedFromModule,
          newEditor,
          editors,
          ownAssignments,
          depResolver,
          visitedRegions
        );
      } else {
        // we mark the external bundle import region as something we want to keep
        // as a signal to the Append nodes that this import is consumed and to
        // include this region in the resulting bundle.
        editor.keepRegion(importedPointer);
      }
    }
  }
}

function addNewEditor(
  moduleForNewEditor: Resolution,
  insertBefore: RegionEditor,
  editors: { module: ModuleResolution; editor: RegionEditor }[]
): RegionEditor {
  let nonCyclicModule = makeNonCyclic(moduleForNewEditor);
  let newEditor = new RegionEditor(
    nonCyclicModule.source,
    moduleForNewEditor.desc
  );
  let editorIndex = editors.findIndex((e) => e.editor === insertBefore);
  // if the editor before the editor we are inserting before is already an
  // editor for the same module that we need an editor for, then just use that
  // one.
  if (
    editorIndex > 0 &&
    editors[editorIndex - 1].module.url.href === moduleForNewEditor.url.href
  ) {
    return editors[editorIndex - 1].editor;
  }
  editors.splice(
    editors.findIndex((e) => e.editor === insertBefore),
    0,
    {
      module: nonCyclicModule,
      editor: newEditor,
    }
  );
  return newEditor;
}

export interface ExposedRegionInfo {
  exposedAs: string | undefined;
  pointer: RegionPointer;
  module: Resolution;
}

function exposedRegions(
  bundle: URL,
  bundleAssignments: BundleAssignment[],
  depResolver: DependencyResolver
): ExposedRegionInfo[] {
  let results: ExposedRegionInfo[] = [];
  let ownAssignments = bundleAssignments.filter(
    (a) => a.bundleURL.href === bundle.href
  );
  for (let assignment of ownAssignments) {
    let { module: resolution }: { module: Resolution } = assignment;
    let module = makeNonCyclic(resolution);

    for (let [original, exposed] of assignment.exposedNames) {
      let { module: sourceModule, desc: exportDesc } =
        getExportDesc(module, original) ?? {};
      if (!sourceModule || !exportDesc) {
        throw new Error(
          `cannot determine the module that the export '${original}' originally comes from when evaluating the module ${module.url.href} in the bundle ${bundle.href}`
        );
      }
      let importedFrom = sourceModule;
      if (
        !ownAssignments.find(
          (a) => a.module.url.href === sourceModule!.url.href
        )
      ) {
        // In this scenario the export actually comes from an external bundle
        // via an export-all. we'll deal with this as part of determining the
        // assigned exports in a later step
        continue;
      }

      if (exportDesc.type === "local") {
        let resolution = resolutionForPkgDepDeclaration(
          sourceModule,
          exportDesc.name,
          depResolver
        );
        if (resolution) {
          if (isNamespaceMarker(resolution.importedAs)) {
            throw new Error("unimplemented");
          }
          if (!resolution.importedSource) {
            let exposedInfo = {
              module: resolution.consumedBy,
              exposedAs: exposed,
              pointer: resolution.consumedByPointer,
            };
            if (!hasExposedRegionInfo(exposedInfo, results)) {
              results.push(exposedInfo);
            }
            continue;
          }
          original = resolution.importedAs;
          module = resolution.consumedBy;
          importedFrom = resolution.importedSource.declaredIn;
        }
      }

      let source = resolveDeclaration(
        original,
        importedFrom,
        sourceModule,
        ownAssignments
      );
      if (source.type === "resolved") {
        let exposedInfo = {
          module: source.module,
          exposedAs: exposed,
          pointer: source.pointer,
        };
        if (!hasExposedRegionInfo(exposedInfo, results)) {
          results.push(exposedInfo);
        }
      } else {
        if (source.importedPointer == null) {
          throw new Error(
            `bug: don't know which region to expose for '${original}' from module ${source.importedFromModule.url.href} consumed by module ${source.consumingModule.url.href} in bundle ${bundle.href}`
          );
        }
        let exposedInfo = {
          module: source.consumingModule,
          pointer: source.importedPointer,
          exposedAs: exposed,
        };
        if (!hasExposedRegionInfo(exposedInfo, results)) {
          results.push(exposedInfo);
        }
      }
    }

    // add module side effects
    let moduleDependencies = module.desc.regions[documentPointer].dependsOn;
    if (moduleDependencies.size > 0) {
      for (let moduleDependency of moduleDependencies) {
        let exposedInfo = {
          module,
          pointer: moduleDependency,
          exposedAs: undefined,
        };
        if (!hasExposedRegionInfo(exposedInfo, results)) {
          results.push(exposedInfo);
        }
      }
    }
  }

  return results;
}

function hasExposedRegionInfo(
  info: ExposedRegionInfo,
  infos: ExposedRegionInfo[]
): boolean {
  return Boolean(
    infos.find(
      (i) =>
        i.module.url.href === info.module.url.href &&
        i.pointer === info.pointer &&
        i.exposedAs === info.exposedAs
    )
  );
}
