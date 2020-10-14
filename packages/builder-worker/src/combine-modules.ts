import { BundleAssignment } from "./nodes/bundle";
import {
  isCyclicModuleResolution,
  ModuleResolution,
  Resolution,
} from "./nodes/resolution";
import {
  NamespaceMarker,
  isNamespaceMarker,
  ImportedNameDescription,
} from "./describe-file";
import { maybeRelativeURL } from "./path";
import { RegionEditor } from "./code-region";
import { debug } from "./logger";

// This is an inverted State.assignedImportedNames, where the key is the
// assigned name in the bundle and the value is the original moduleHref and
// exported name for the assignment.
export type ImportAssignments = Map<
  string,
  { moduleHref: string; name: string | NamespaceMarker }
>;

export function combineModules(
  bundle: URL,
  assignments: BundleAssignment[]
): { code: string; importAssignments: ImportAssignments } {
  let start = Date.now();
  let state: State = {
    bundle,
    assignedLocalNames: new Map(),
    usedNames: new Map(),
    assignedImportedNames: new Map(),
    assignedNamesWithForeignOrigins: new Map(),
    assignmentLookup: new Map(),
    sideEffectOnlyImports: new Set(),
    consumedBundles: new Set(),
    bundleDependsOn: new Set(),
    sideEffectsDependOn: new Set(),
    seenModules: new Set(),
  };
  let ownAssignments = assignments.filter(
    (a) => a.bundleURL.href === bundle.href
  );
  let rewriters: Map<string, ModuleRewriter> = new Map();

  for (let assignment of ownAssignments) {
    gatherModuleRewriters(rewriters, assignment.module, state, assignments);
  }

  // iterate through the bundle's bindings and identify bindings that are not
  // consumed:
  //   - binding is not exported by bundle or part of an exported binding's
  //     dependency graph
  //   - binding is not consumed directly by the bundle's own module scope or
  //     part of a consumed binding's dependency graph
  //   - binding is not consumed directly by a side-effectful declaration or
  //     part of a consumed side effectful binding dependency graph
  let { exports, reexports } = assignedExports(
    bundle,
    ownAssignments,
    assignments,
    state
  );
  let removedBindings = new Set<string>();
  let consumptionCache = new Map<string, Map<string, boolean>>();
  let dependencyCache = new Map<string, Map<string, Set<string>>>();
  let treeShakingStart = Date.now();
  for (let bindingName of state.usedNames.keys()) {
    if (
      [
        ...new Set([
          ...exports.values(),
          ...state.bundleDependsOn,
          ...state.sideEffectsDependOn,
        ]),
      ].some(
        (retainedBinding) =>
          retainedBinding === bindingName ||
          isConsumedBy(
            retainedBinding,
            bindingName,
            bundle,
            state,
            assignments,
            consumptionCache,
            dependencyCache
          )
      )
    ) {
      continue;
    }

    removedBindings.add(bindingName);
    removeBinding(bindingName, rewriters, bundle, state, assignments);
  }
  let treeShakingTime = Date.now() - treeShakingStart;
  if (treeShakingTime > 100) {
    debug(
      `combineModules - completed tree shaking bindings in bundle ${bundle.href} in ${treeShakingTime}ms`
    );
  }

  let output = [];
  let writtenNamespaces: string[] = [];
  for (let rewriter of rewriters.values()) {
    let namespaces = makeLocalNamespaces(
      rewriter.module,
      bundle,
      assignments,
      state
    ).filter(
      ({ bindingName }) =>
        !removedBindings.has(bindingName) &&
        !writtenNamespaces.includes(bindingName)
    );
    output.push(namespaces.map(({ code }) => code).join("\n"));
    writtenNamespaces.push(...namespaces.map(({ bindingName }) => bindingName));

    let code = rewriter.serialize();
    output.push(code);
  }

  // at this point we removed all export statements because our modules can
  // directly consume each other's renamed bindings. Here we re-add exports for
  // the things that are specifically configured to be exposed outside the
  // bundle.
  if (exports.size > 0) {
    let exportDeclaration: string[] = [];
    exportDeclaration.push("export {");
    exportDeclaration.push(
      [...exports]
        .map(([outsideName, insideName]) =>
          outsideName === insideName
            ? outsideName
            : `${insideName} as ${outsideName}`
        )
        .join(", ")
    );
    exportDeclaration.push("};");
    output.push(exportDeclaration.join(" "));
  }

  // Add reexports of other bundles
  if (reexports.size > 0) {
    // cleanup the side effect only imports by removing reexported bundle URLs
    state.sideEffectOnlyImports = new Set(
      [...state.sideEffectOnlyImports].filter(
        (href) => ![...reexports.keys()].includes(href)
      )
    );

    let reexportDeclarations: string[] = [];
    for (let bundleHref of reexports.keys()) {
      let mapping = reexports.get(bundleHref);
      if (!mapping) {
        continue;
      }
      let reexportDeclaration: string[] = [];
      reexportDeclaration.push("export {");
      reexportDeclaration.push(
        [...mapping]
          .map(([exposedName, importedName]) =>
            exposedName === importedName
              ? exposedName
              : `${importedName} as ${exposedName}`
          )
          .join(", ")
      );
      reexportDeclaration.push("} from");
      reexportDeclaration.push(
        `"${maybeRelativeURL(new URL(bundleHref), bundle)}";`
      );
      reexportDeclarations.push(reexportDeclaration.join(" "));
    }
    output.unshift(reexportDeclarations.join("\n"));
  }

  // Add imports for this bundle in dep-first order
  let importDeclarations: string[] = [];
  let { namedImports, namespaceImports } = assignedImports(
    assignments,
    state,
    removedBindings
  );
  for (let bundleHref of state.consumedBundles) {
    let namedMapping = namedImports.get(bundleHref);
    let localNamespaceImport = namespaceImports.get(bundleHref);
    if (localNamespaceImport) {
      importDeclarations.push(
        `import * as ${localNamespaceImport} from "${maybeRelativeURL(
          new URL(bundleHref),
          bundle
        )}";`
      );
    }
    if (namedMapping && !localNamespaceImport) {
      let importDeclaration: string[] = [];
      importDeclaration.push("import {");
      importDeclaration.push(
        [...namedMapping]
          .map(([exportedName, localName]) =>
            exportedName === localName
              ? exportedName
              : `${exportedName} as ${localName}`
          )
          .join(", ")
      );
      importDeclaration.push("} from");
      importDeclaration.push(
        `"${maybeRelativeURL(new URL(bundleHref), bundle)}";`
      );
      importDeclarations.push(importDeclaration.join(" "));
    }
    // this is an optimization such that if there is a namespace mapping and a
    // named mapping from the same module, we can collapse the named mapping and
    // pluck the named mapping out of the namespace import's local binding
    if (namedMapping && localNamespaceImport) {
      let variableDeclaration: string[] = [];
      variableDeclaration.push("const {");
      variableDeclaration.push(
        [...namedMapping]
          .map(([exportedName, localName]) =>
            exportedName === localName
              ? exportedName
              : `${exportedName}: ${localName}`
          )
          .join(", ")
      );
      variableDeclaration.push(`} = ${localNamespaceImport};`);
      importDeclarations.push(variableDeclaration.join(" "));
    }
    if (
      !namedMapping &&
      !localNamespaceImport &&
      state.sideEffectOnlyImports.has(bundleHref)
    ) {
      importDeclarations.push(
        `import "${maybeRelativeURL(new URL(bundleHref), bundle)}";`
      );
    }
  }
  output.unshift(importDeclarations.join("\n"));

  // if there are no imports nor exports written to the bundle, then write
  // "export {};" to signal that this is an ES6 module.
  if (
    importDeclarations.length === 0 &&
    exports.size === 0 &&
    reexports.size === 0
  ) {
    output.push(`export {};`);
  }

  const importAssignments = invertAssignedImportedNames(
    state.assignedImportedNames
  );
  let combineTime = Date.now() - start;
  if (combineTime > 100) {
    debug(
      `combineModules - completed bundle ${bundle.href} in ${combineTime}ms`
    );
  } else {
    debug(
      `combineModules - completed bundle ${bundle.href} in ${combineTime}ms`
    );
  }
  return {
    code: output.join("\n").trim(),
    importAssignments,
  };
}

function invertAssignedImportedNames(
  assignedImportedNames: State["assignedImportedNames"]
): ImportAssignments {
  let importAssignments: ImportAssignments = new Map();
  for (let [moduleHref, mapping] of assignedImportedNames) {
    for (let [name, assignedName] of mapping) {
      importAssignments.set(assignedName, {
        moduleHref,
        name,
      });
    }
  }
  return importAssignments;
}

function removeBinding(
  assignedName: string,
  rewriters: Map<string, ModuleRewriter>,
  bundle: URL,
  state: State,
  assignments: BundleAssignment[]
): void {
  let name: string | undefined;
  let moduleHref: string | undefined;
  if (!state.usedNames.has(assignedName)) {
    // if we have not found the name it is because it comes from a module that
    // has been assigned to a different bundle. because it comes from a
    // different bundle, the name has never been assigned, so the name being
    // asked about is actually already the original name
    name = assignedName;
    let assignment = assignments.find(({ exposedNames }) =>
      exposedNames.has(assignedName)
    );
    moduleHref = assignment?.bundleURL.href;
  } else {
    ({ moduleHref, name } = state.usedNames.get(assignedName) || {});
  }
  if (!moduleHref || !name) {
    throw new Error(
      `bug: could not determine the original name and module of the bundle scoped binding (after assignment) of '${assignedName}`
    );
  }

  let { bundleURL } = assignments.find(
    ({ module: m }) => m.url.href === moduleHref
  )!;
  // no need to worry about removing bindings that come from other bundles, as
  // we wont even bother writing their import statements in the final steps of
  // the bundle creation since they would be unconsumed.
  if (bundle.href === bundleURL.href) {
    let rewriter = rewriters.get(moduleHref)!;
    rewriter.editor.removeDeclaration(name);
  }
}

interface State {
  bundle: URL;

  usedNames: Map<string, { moduleHref: string; name: string }>;

  // this is a set of bundle hrefs that are imported for side effects only
  sideEffectOnlyImports: Set<string>;

  // this is a set of bundles that are consumed by this bundle in dep-first
  // order of consumption. We use this structure to ensure that the order in
  // which we write the imports in the bundle is maintained correctly.
  consumedBundles: Set<string>;

  // outer map is the href of the exported module. the inner map goes from
  // exported name to our name. our name also must appear in usedNames. If the
  // inner map is undefined, then this is a side effect-only import.
  assignedImportedNames: Map<string, Map<string | NamespaceMarker, string>>;

  // This is synonymous with assignedImportedNames, but it's used specifically
  // to help us lookup local name assignments. outer map is the href of the
  // module. the inner map's key is the original name of the binding in the
  // module, and the value is it's assigned name in the resulting bundle.
  assignedLocalNames: Map<string, Map<string, string>>;

  // This look up allows us to find the description for an assigned binding
  assignmentLookup: Map<
    string,
    { module: ModuleResolution; name: string | NamespaceMarker }
  >;

  // This is synonymous with assignedImportedNames, but it's used specifically
  // to help us keep track of local name assignments that originated from
  // different bundles. outer map is the href of the module. the inner map's key
  // is the original name of the binding in the module, and the value is it's
  // assigned name in the resulting bundle.
  assignedNamesWithForeignOrigins: Map<
    string,
    Map<string | NamespaceMarker, string>
  >;

  // similar to bindingDependsOn, these are bindings that are needed by the
  // bundle's top-level module scope itself.
  bundleDependsOn: Set<string>;

  // similar to bindingDependsOn, these are bindings that are needed by the side
  // effectful declarations that are unable to be removed.
  sideEffectsDependOn: Set<string>;

  seenModules: Set<string>;
}
class ModuleRewriter {
  readonly editor: RegionEditor;

  constructor(
    readonly module: ModuleResolution,
    private sharedState: State,
    private assignments: BundleAssignment[]
  ) {
    this.editor = new RegionEditor(
      module.source,
      module.desc,
      this.unusedNameLike.bind(this)
    );
    let start = Date.now();
    this.rewriteScope();
    let time = Date.now() - start;
    if (time > 100) {
      debug(
        `combineModules - completed rewriting scope for module ${module.url.href} in ${time}ms`
      );
    }
  }

  serialize(): string {
    return this.editor.serialize();
  }

  rewriteScope(): void {
    let assignedDefaultName: string | undefined;
    for (let [name, nameDesc] of this.module.desc.names) {
      let isDupeBinding = false;
      let isDefaultExport = false;
      let assignedName: string | undefined;
      let workingModule: Resolution | undefined;
      let workingInsideName: string | NamespaceMarker | undefined;

      // figure out which names in module scope are imports vs things that
      // live inside this module
      if (
        nameDesc.type === "import" ||
        (nameDesc.type === "local" && nameDesc.original)
      ) {
        let remoteName: string | NamespaceMarker;
        let remoteModuleHref: string;
        let localName: string | NamespaceMarker | undefined;
        let localModuleHref: string | undefined;
        if (nameDesc.type === "local" && nameDesc.original) {
          // TODO eventually we'll use the consumer's semver range for this
          // binding's pkg to find these dupes
          remoteName = nameDesc.original.exportedName;
          remoteModuleHref = nameDesc.original.moduleHref;
          localName = name;
          localModuleHref = this.module.url.href;
          isDupeBinding = Boolean(
            this.sharedState.assignedImportedNames
              .get(remoteModuleHref)
              ?.get(remoteName)
          );
          if (!isDupeBinding) {
            let nameMapping = this.sharedState.assignedNamesWithForeignOrigins.get(
              remoteModuleHref
            );
            if (!nameMapping) {
              nameMapping = new Map();
              this.sharedState.assignedNamesWithForeignOrigins.set(
                remoteModuleHref,
                nameMapping
              );
            }
            nameMapping.set(remoteName, name);
            workingModule = this.module;
            workingInsideName = name;
          }
        } else if (nameDesc.type === "import") {
          let remoteModule: Resolution;
          ({ name: remoteName, module: remoteModule } = resolveReexport(
            nameDesc.name,
            this.module.resolvedImports[nameDesc.importIndex]
          ));
          workingModule = remoteModule;
          if (!isNamespaceMarker(remoteName)) {
            if (remoteModule !== this.module) {
              let exportDesc = remoteModule.desc.exports.get(remoteName)!;
              if (exportDesc.type === "local") {
                workingInsideName = exportDesc.name;
              }
            } else {
              workingInsideName = name;
            }
          } else {
            workingInsideName = NamespaceMarker;
          }
          remoteModuleHref = remoteModule.url.href;
        }
        assignedName = this.maybeAssignImportName(
          remoteModuleHref!,
          remoteName!,
          name,
          localModuleHref,
          localName
        );
      } else {
        let entry = [...this.module.desc.exports].find(
          ([_, desc]) => desc.type === "local" && desc.name === name
        );
        isDefaultExport = entry?.[0] === "default";
        if (entry) {
          // check to see if the binding we are currently considering is
          // actually the original source of previously assigned bindings that
          // derived from this binding via previous bundle builds (in other words:
          // previously assigned bindings have an "original" property that points
          // specifically to this module and binding)
          let maybeAssignedName = this.sharedState.assignedNamesWithForeignOrigins
            .get(this.module.url.href)
            ?.get(entry[0]);
          if (maybeAssignedName) {
            isDupeBinding = true;
            assignedName = maybeAssignedName;
          }
        }
        if (!assignedName) {
          if (isDefaultExport) {
            // check to see if we have already assigned this binding as a result
            // of processing it's consumer
            assignedDefaultName = this.sharedState.assignedImportedNames
              .get(this.module.url.href)
              ?.get("default");
            if (assignedDefaultName) {
              // the consumer of this module has already assigned this name
              assignedName = assignedDefaultName;
            } else {
              if (!assignedDefaultName && name !== "default") {
                // the export is a named default export.
                assignedDefaultName = this.unusedNameLike(name);
              } else if (!assignedDefaultName) {
                // the export is an unnamed default export.
                assignedDefaultName = this.unusedNameLike("_default");
              }
              assignedName = assignedDefaultName;
            }
            this.assignLocalName("default", assignedName);
            this.sharedState.assignmentLookup.set(assignedName, {
              module: this.module,
              name: "default",
            });
          } else if (entry?.[0]) {
            assignedName = this.maybeAssignImportName(
              this.module.url.href,
              entry[0],
              name
            );
          } else {
            assignedName = this.unusedNameLike(name);
          }

          this.assignLocalName(name, assignedName);
          workingModule = this.module;
          workingInsideName = name;
        }
      }
      this.claimAndRename(this.module.url.href, name, assignedName);

      if (isDupeBinding) {
        // remove this binding's declaration, since it has already been added to
        // the bundle the first time we encountered it. we also want to make
        // sure to remove the side effects as well, which would otherwise be
        // preserved, since that would result in duplicated side effects.
        this.editor.removeDeclaration(name, true);
      } else {
        if (workingModule && workingInsideName) {
          if (isCyclicModuleResolution(workingModule)) {
            workingModule = [...workingModule.cyclicGroup].find(
              (m) => m.url.href === workingModule!.url.href
            )!;
          }
          this.sharedState.assignmentLookup.set(assignedName, {
            module: workingModule,
            name: workingInsideName,
          });
        }
        if (
          workingModule &&
          !isCyclicModuleResolution(workingModule) &&
          [...workingModule.desc.names].find(([, d]) =>
            [...d.bindingsConsumedByDeclarationSideEffects].includes(name)
          )
        ) {
          this.sharedState.sideEffectsDependOn.add(assignedName);
        }

        if (nameDesc.usedByModule) {
          this.sharedState.bundleDependsOn.add(assignedName);
        }
      }
    }

    let myAssignment = this.assignments.find(
      (a) => a.module.url.href === this.module.url.href
    );
    if (!myAssignment) {
      throw new Error(
        `bug: could not module assignment ${this.module.url.href}`
      );
    }
    // rewrite dynamic imports to use bundle specifiers
    for (let [index, importDesc] of this.module.desc.imports.entries()) {
      if (!importDesc.isDynamic) {
        continue;
      }
      let dep = this.module.resolvedImports[index];
      let depAssignment = this.assignments.find(
        (a) => a.module.url.href === dep.url.href
      );
      if (!depAssignment) {
        throw new Error(
          `bug: could not find assignment for module ${dep.url.href} which is imported by ${this.module.url.href}`
        );
      }
      let bundleSpecifier = `"${maybeRelativeURL(
        depAssignment.bundleURL,
        myAssignment.bundleURL
      )}"`;
      this.editor.replace(importDesc.specifierRegion, bundleSpecifier);
    }

    // a reexport of a default export from the entrypoint results in a binding
    // that we have not encountered from the consuming side, so providing an
    // available default name to use in that scenario (as well as
    // assignedDefaultName which will give us a nice name based on how the
    // consumer named the default export).
    this.editor.removeImportsAndExports(
      assignedDefaultName ?? this.unusedNameLike("_default")
    );
  }

  private assignLocalName(name: string, assignedName: string) {
    let nameAssignments = this.sharedState.assignedLocalNames.get(
      this.module.url.href
    );
    if (!nameAssignments) {
      nameAssignments = new Map<string, string>();
      this.sharedState.assignedLocalNames.set(
        this.module.url.href,
        nameAssignments
      );
    }
    nameAssignments.set(name, assignedName);
  }

  private maybeAssignImportName(
    remoteModuleHref: string,
    remoteName: string | NamespaceMarker,
    suggestedName: string,
    localModuleHref?: string,
    localName?: string | NamespaceMarker
  ): string {
    let alreadyAssignedName =
      this.sharedState.assignedImportedNames
        .get(remoteModuleHref)
        ?.get(remoteName) ??
      // in the scenario where we have exposed in our bundle a reexport of a
      // binding that was originally imported into our module and then
      // subsequently built into a bundle--thus making the formerly imported
      // binding local to the resulting bundle (and bestowing an "original"
      // property in its description), we may encounter the binding via the
      // consumer of the bundle's export first. in this case we need to make sure
      // to check for the assignment that the consumer made.
      (localModuleHref && localName
        ? this.sharedState.assignedImportedNames
            .get(localModuleHref)
            ?.get(localName)
        : undefined);

    if (alreadyAssignedName) {
      return alreadyAssignedName;
    } else {
      let assignedName = this.unusedNameLike(suggestedName);
      this.assignImportName(remoteModuleHref, remoteName, assignedName);
      return assignedName;
    }
  }

  private assignImportName(
    moduleHref: string,
    exportedName: string | NamespaceMarker,
    assignedName: string
  ) {
    let mapping = this.sharedState.assignedImportedNames.get(moduleHref);
    if (!mapping) {
      mapping = new Map();
      this.sharedState.assignedImportedNames.set(moduleHref, mapping);
    }
    mapping.set(exportedName, assignedName);
  }

  private claimAndRename(
    moduleHref: string,
    origName: string,
    newName: string
  ) {
    this.sharedState.usedNames.set(newName, { moduleHref, name: origName });
    if (origName !== newName) {
      this.editor.rename(origName, newName);
    }
  }

  // it's understood that `name` can be in this module's own description's names
  // and that is not a collision because it's not conflicting with itself.
  private unusedNameLike(name: string) {
    let candidate = name;
    let counter = 0;
    while (
      (candidate !== name && this.module.desc.names.has(candidate)) ||
      this.sharedState.usedNames.has(candidate)
    ) {
      candidate = `${name}${counter++}`;
    }
    return candidate;
  }
}

function gatherModuleRewriters(
  rewriters: Map<string, ModuleRewriter>,
  module: ModuleResolution,
  state: State,
  assignments: BundleAssignment[]
) {
  if (state.seenModules.has(module.url.href)) {
    return;
  }
  state.seenModules.add(module.url.href);

  // we intentionally want to perform the module rewriting when we enter the
  // recursive function so that module bindings that are closest to the bundle
  // entrypoint have their names retained so that collisions are more likely the
  // farther away from the module entrypoint that you go.
  let rewriter = new ModuleRewriter(module, state, assignments);

  for (let resolution of module.resolvedImports) {
    if (resolution.type === "cyclic") {
      continue;
    }
    let assignment = assignments.find(
      (a) => a.module.url.href === resolution.url.href
    );
    if (!assignment) {
      throw new Error(`no bundle assignment for module ${resolution.url.href}`);
    }
    if (assignment.bundleURL.href === state.bundle.href) {
      gatherModuleRewriters(rewriters, resolution, state, assignments);
    } else {
      state.consumedBundles.add(assignment.bundleURL.href);

      // discover any static imports for side effect only. these will be imports that
      // are not dynamic and have no binding name associated with them.
      for (let [index, importDesc] of module.desc.imports.entries()) {
        if (
          !importDesc.isDynamic &&
          ![...module.desc.names.values()].find(
            (nameDesc) =>
              nameDesc.type === "import" && nameDesc.importIndex === index
          )
        ) {
          state.sideEffectOnlyImports.add(assignment.bundleURL.href);
        }
      }
    }
  }

  // we intentionally add modules to the map of rewriters when we exit the
  // recursion so that the order in which modules are added to the map will be
  // the dependencies first to ultimately entrypoints last. The preserves
  // the order of any side effects in the modules.
  rewriters.set(module.url.href, rewriter);
}

function getAssignedDependencies(
  originalName: string,
  module: ModuleResolution,
  state: State,
  assignments: BundleAssignment[],
  bundle: URL,
  cache: Map<string, Map<string, Set<string>>>
): Set<string> {
  let moduleCache = cache.get(module.url.href);
  if (!moduleCache) {
    moduleCache = new Map();
    cache.set(module.url.href, moduleCache);
  }
  let dependsOn = moduleCache.get(originalName);
  if (dependsOn) {
    return dependsOn;
  }

  let desc = module.desc.names.get(originalName);
  if (!desc) {
    throw new Error(
      `bug: the module ${module.url.href} does not have a binding named '${originalName}'`
    );
  }
  let currentModule: Resolution = module;

  // ignore circular dependencies (which is the result of recursion) so we
  // don't end up with cycles in our graph
  let originalDependsOn = [...desc.dependsOn].filter((d) => d !== originalName);

  if (desc.type === "import") {
    // the module that holds the binding dependency to set is actually a
    // different module. follow the export to get to the module where the
    // binding is declared locally
    let outsideName: string | NamespaceMarker | undefined;
    let importedModule = module.resolvedImports[desc.importIndex];
    if (importedModule.type === "cyclic") {
      currentModule = [...importedModule.cyclicGroup].find(
        (m) => m.url.href === importedModule.url.href
      )!;
    } else {
      currentModule = importedModule;
    }
    ({ module: currentModule, name: outsideName } = resolveReexport(
      desc.name,
      currentModule
    ));
    if (outsideName && isNamespaceMarker(outsideName)) {
      originalDependsOn = [
        ...originalDependsOn,
        ...([...currentModule.desc.exports.values()]
          .filter((e) => e.type === "local")
          .map((e) => e.name) as string[]), // the filter for type="local" strips out the namespace markers, but typescript can't see through this filter, hence the cast
      ];
    }
  }

  let bindingsBundleURL = assignments.find(
    ({ module: m }) => m.url.href === currentModule.url.href
  )!.bundleURL;
  if (bundle.href !== bindingsBundleURL.href) {
    // the binding we are dealing with originates from another bundle.
    // we don't want to track the consumption of bindings in a different bundle
    originalDependsOn = [];
  }

  dependsOn = new Set<string>();
  for (let originalDepName of originalDependsOn) {
    let depName: string;
    let desc = currentModule.desc.names.get(originalDepName);
    if (!desc) {
      // this would happen for a global, like "console.log()", just add it
      dependsOn.add(originalDepName);
      continue;
    }
    if (desc.type === "import") {
      if (currentModule.type === "cyclic") {
        throw new Error(
          `bug: don't know how to deal with a cyclic edge when resolving binding dependencies for '${originalName}' in module ${currentModule.url.href}`
        );
      }
      let depModule = currentModule.resolvedImports[desc.importIndex];
      let { name: remoteName, module: remoteModule } = resolveReexport(
        desc.name,
        depModule
      );
      depName = state.assignedImportedNames
        .get(remoteModule.url.href)!
        .get(remoteName)!;
    } else {
      let original = desc.original;
      if (original) {
        depName =
          state.assignedImportedNames
            .get(original.moduleHref)
            ?.get(original.exportedName) ??
          state.assignedNamesWithForeignOrigins
            .get(original.moduleHref)!
            .get(original.exportedName)!;
      } else {
        depName = state.assignedLocalNames
          .get(currentModule.url.href)!
          .get(originalDepName)!;
      }
    }
    if (depName) {
      dependsOn.add(depName);
    }
  }
  moduleCache.set(originalName, dependsOn);
  return dependsOn;
}

function isConsumedBy(
  consumingBinding: string,
  consumedBinding: string,
  bundle: URL,
  state: State,
  assignments: BundleAssignment[],
  consumptionCache: Map<string, Map<string, boolean>>,
  dependencyCache: Map<string, Map<string, Set<string>>>,
  visitedConsumers: string[] = []
): boolean {
  let consumesCache = consumptionCache.get(consumingBinding);
  if (!consumesCache) {
    consumesCache = new Map();
    consumptionCache.set(consumingBinding, consumesCache);
  }
  if (consumesCache.has(consumedBinding)) {
    return consumesCache.get(consumingBinding)!;
  }

  // Collapse cycles in binding consumption which are likely the result of recursion
  if (visitedConsumers.includes(consumingBinding)) {
    consumesCache.set(consumedBinding, true);
    return true;
  }
  visitedConsumers = [...visitedConsumers, consumingBinding];
  let sourceInfo = state.assignmentLookup.get(consumingBinding);
  if (!sourceInfo) {
    // the binding does not exist, I think this can happen for globals, like 'console'
    consumesCache.set(consumedBinding, false);
    return false;
  }
  let { module, name } = sourceInfo;
  let deps: Set<string> = new Set();
  if (isNamespaceMarker(name)) {
    // A namespace import inherently depends on all the exports of a module. In
    // this case we recurse into this function to check if the consumed is an
    // export of module or consumed by an export of module.
    let result = [...module.desc.exports].some(([exportName, exportDesc]) => {
      let { module: remoteModule, name: remoteName } = resolveReexport(
        exportName,
        module
      );
      let assignedName =
        (!isNamespaceMarker(exportDesc.name)
          ? state.assignedLocalNames
              .get(remoteModule.url.href)
              ?.get(exportDesc.name)
          : undefined) ??
        state.assignedImportedNames.get(remoteModule.url.href)?.get(remoteName);
      if (!assignedName) {
        throw new Error(
          `could not determine the assigned name for the export '${exportName}' of the module ${module.url.href}`
        );
      }
      return (
        assignedName === consumedBinding ||
        isConsumedBy(
          assignedName,
          consumedBinding,
          bundle,
          state,
          assignments,
          consumptionCache,
          dependencyCache
        )
      );
    });
    consumesCache.set(consumedBinding, result);
    return result;
  } else {
    deps = getAssignedDependencies(
      name,
      module,
      state,
      assignments,
      bundle,
      dependencyCache
    );
  }

  if (deps.has(consumedBinding)) {
    consumesCache.set(consumedBinding, true);
    return true;
  }

  let result = [...deps].some((dep) =>
    isConsumedBy(
      dep,
      consumedBinding,
      bundle,
      state,
      assignments,
      consumptionCache,
      dependencyCache,
      visitedConsumers
    )
  );
  consumesCache.set(consumedBinding, result);
  return result;
}

function assignedExports(
  bundleURL: URL,
  ownAssignments: BundleAssignment[],
  assignments: BundleAssignment[],
  state: State
): {
  exports: Map<string, string>; // outside name -> inside name
  reexports: Map<string, Map<string, string>>; // bundle href -> [outside name => inside name]
} {
  let exports: Map<string, string> = new Map();
  let reexports: Map<string, Map<string, string>> = new Map();
  for (let assignment of ownAssignments) {
    for (let [original, exposed] of assignment.exposedNames) {
      let { module }: { module: Resolution } = assignment;
      if (
        (!isNamespaceMarker(original) &&
          module.desc.exports.get(original)?.type === "reexport") ||
        (!isNamespaceMarker(original) &&
          module.desc.names.get(original)?.type === "import" &&
          [...module.desc.exports.values()].find((e) => e.name === original))
      ) {
        ({ name: original, module } = resolveReexport(original, module));
        let reexportAssignment = assignments.find(
          (a) => a.module.url.href === module.url.href
        );
        if (
          reexportAssignment?.bundleURL.href !== bundleURL.href &&
          !isNamespaceMarker(original)
        ) {
          let bundleReexports = reexports.get(
            reexportAssignment!.bundleURL.href
          );
          if (!bundleReexports) {
            bundleReexports = new Map();
            reexports.set(reexportAssignment!.bundleURL.href, bundleReexports);
          }
          bundleReexports.set(exposed, original);
          continue;
        }
      }
      let insideName: string | undefined;
      // In the scenarios below, we first check for bindings local to the module
      // in question, and then we'll expand our search to bindings that have
      // been reexported from the binding in question
      if (original === "default") {
        insideName =
          state.assignedLocalNames.get(module.url.href)?.get(original) ??
          state.assignedImportedNames.get(module.url.href)?.get(original);
      } else {
        let desc = !isNamespaceMarker(original)
          ? module.desc.names.get(original)
          : undefined;
        if (desc?.type === "local" && desc.original) {
          insideName = state.assignedNamesWithForeignOrigins
            .get(desc.original.moduleHref)
            ?.get(desc.original.exportedName);
        } else {
          let originalInternalName = !isNamespaceMarker(original)
            ? (module.desc.exports.get(original)!.name as string)
            : undefined;
          insideName =
            !isNamespaceMarker(original) && originalInternalName
              ? state.assignedLocalNames
                  .get(module.url.href)
                  ?.get(originalInternalName)
              : undefined;
        }
        insideName =
          insideName ??
          state.assignedImportedNames.get(module.url.href)?.get(original);
      }

      if (!insideName) {
        throw new Error(
          `bug: no internal mapping for '${exposed}' when making bundle ${bundleURL.href}`
        );
      }
      exports.set(exposed, insideName);
    }
  }
  return { exports, reexports };
}

function makeLocalNamespaces(
  module: ModuleResolution,
  bundleURL: URL,
  assignments: BundleAssignment[],
  state: State
): { code: string; bindingName: string }[] {
  let results: { code: string; bindingName: string }[] = [];
  for (let desc of module.desc.names.values()) {
    if (desc.type !== "import" || !isNamespaceMarker(desc.name)) {
      continue;
    }
    let { module: importedModule } = resolveReexport(
      desc.name,
      module.resolvedImports[desc.importIndex]
    );
    let assignment = assignments.find(
      (a) => a.module.url.href === importedModule.url.href
    );
    if (assignment?.bundleURL.href !== bundleURL.href) {
      continue;
    }

    let namespaceDeclaration: string[] = [];
    let nameMappings = state.assignedImportedNames.get(
      importedModule.url.href
    )!;
    let bindingName = nameMappings.get(NamespaceMarker)!;
    namespaceDeclaration.push(`const ${bindingName} = {`);
    let declarators: string[] = [];
    for (let [
      exportedName,
      exportDesc,
    ] of importedModule.desc.exports.entries()) {
      // TODO might need to revisit this decision `export * as foo from "bar"`
      if (isNamespaceMarker(exportDesc.name)) {
        continue;
      }
      let {
        module: namespaceItemModule,
        name: namespaceItemName,
      } = resolveReexport(exportedName, importedModule);
      if (isNamespaceMarker(namespaceItemName)) {
        declarators.push(exportedName);
      } else {
        let nameDesc = namespaceItemModule.desc.names.get(namespaceItemName);
        if (nameDesc?.type === "local" && nameDesc.original) {
          let assignedName =
            state.assignedImportedNames
              .get(nameDesc.original.moduleHref)
              ?.get(nameDesc.original.exportedName) ??
            state.assignedNamesWithForeignOrigins
              .get(nameDesc.original.moduleHref)!
              .get(nameDesc.original.exportedName)!;
          declarators.push(
            exportedName === assignedName
              ? exportedName
              : `${exportedName}: ${assignedName}`
          );
        } else if (
          exportDesc.type === "local" &&
          importedModule === namespaceItemModule
        ) {
          let assignedName = nameMappings.get(exportedName)!;
          declarators.push(
            exportedName === assignedName
              ? exportedName
              : `${exportedName}: ${assignedName}`
          );
        } else {
          let assignedName =
            state.assignedLocalNames
              .get(namespaceItemModule.url.href)
              ?.get(namespaceItemName) ??
            // we check assignedImportedNames to handle the case where the binding is
            // explicitly imported, and then explicitly exported in the same
            // module
            state.assignedImportedNames
              .get(namespaceItemModule.url.href)
              ?.get(namespaceItemName);
          if (!assignedName) {
            throw new Error(
              `bug: could not determine assigned name for binding '${namespaceItemName}' in ${namespaceItemModule.url.href}`
            );
          }
          declarators.push(
            exportedName === assignedName
              ? exportedName
              : `${exportedName}: ${assignedName}`
          );
        }
      }
    }
    namespaceDeclaration.push(declarators.join(", "));
    namespaceDeclaration.push(`};`);
    results.push({ code: namespaceDeclaration.join(" "), bindingName });
  }
  return results;
}

function assignedImports(
  assignments: BundleAssignment[],
  state: State,
  removedBindings: Set<string>
): {
  namedImports: Map<string, Map<string, string>>; // bundleHref => <exposedName => local name>
  namespaceImports: Map<string, string>; // bundleHref => local name
} {
  let namedImports: Map<string, Map<string, string>> = new Map();
  let namespaceImports: Map<string, string> = new Map();
  for (let [moduleHref, mappings] of state.assignedImportedNames) {
    let assignment = assignments.find((a) => a.module.url.href === moduleHref)!;
    if (!assignment) {
      // this binding is actually a local binding that originally was imported
      // into a module that this bundle includes
      continue;
    }
    if (assignment.bundleURL.href === state.bundle.href) {
      // internal, no import needed
      continue;
    }
    if (
      [...mappings.values()].every((localName) =>
        removedBindings.has(localName)
      )
    ) {
      continue; // skip over this import--it's actually unconsumed
    }

    let importsFromBundle = namedImports.get(assignment.bundleURL.href);
    if (!importsFromBundle) {
      importsFromBundle = new Map();
      namedImports.set(assignment.bundleURL.href, importsFromBundle);
    }
    for (let [exportedName, localName] of mappings) {
      if (isNamespaceMarker(exportedName)) {
        namespaceImports.set(assignment.bundleURL.href, localName);
        continue;
      }
      let exposedName = assignment.exposedNames.get(exportedName);
      if (!exposedName) {
        // check to see if this is actually a reexport that is being projected
        // to the bundle's entrypoint
        let entrypointAssignment = assignments.find(
          (a) => a.module.url.href === assignment.entrypointModuleURL.href
        );
        if (entrypointAssignment) {
          let { name, module } = resolveReexport(
            localName,
            entrypointAssignment.module
          );
          let reexportedName = state.assignedImportedNames
            .get(module.url.href)
            ?.get(name);
          if (
            module.url.href === assignment.module.url.href &&
            reexportedName
          ) {
            exposedName = entrypointAssignment.exposedNames.get(reexportedName);
          }
        }
        if (!exposedName) {
          throw new Error(
            `bug: tried to import ${exportedName} from ${moduleHref} from another bundle, but it's not exposed`
          );
        }
      }
      importsFromBundle.set(exposedName, localName);
    }
  }
  return { namedImports, namespaceImports };
}

function resolveReexport(
  name: string | NamespaceMarker,
  module: Resolution
): {
  name: string | NamespaceMarker;
  module: Resolution;
} {
  if (isNamespaceMarker(name)) {
    return { name, module };
  }
  let remoteDesc = module.desc.exports.get(name);
  if (
    remoteDesc?.type === "reexport" ||
    (remoteDesc?.type == "local" &&
      module.desc.names.get(remoteDesc.name)?.type === "import")
  ) {
    if (module.type === "cyclic") {
      let cyclicModule = [...module.cyclicGroup].find(
        (m) => m.url.href === module.url.href
      );
      if (!cyclicModule) {
        throw new Error(
          `bug: can't find cyclic module ${module.url.href} in its cyclic group`
        );
      }
      module = cyclicModule;
    }
    if (remoteDesc.type === "reexport") {
      return resolveReexport(
        remoteDesc.name,
        module.resolvedImports[remoteDesc.importIndex]
      );
    } else {
      let localDesc = module.desc.names.get(
        remoteDesc.name
      )! as ImportedNameDescription;
      return resolveReexport(
        localDesc.name,
        module.resolvedImports[localDesc.importIndex]
      );
    }
  }
  return { name, module };
}
