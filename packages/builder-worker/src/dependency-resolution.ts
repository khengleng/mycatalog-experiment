import { makeNonCyclic, ModuleResolution } from "./nodes/resolution";
import { NamespaceMarker, RegionPointer } from "./code-region";
import { BundleAssignment } from "./nodes/bundle";
import { resolveDeclaration } from "./module-rewriter";
import { Dependencies } from "./nodes/entrypoint";
import { pkgInfoFromCatalogJsURL } from "./resolver";
import { satisfies, coerce, compare, validRange } from "semver";
//@ts-ignore
import { intersect } from "semver-intersect";
import { LockFile } from "./nodes/lock-file";

export class DependencyResolver {
  private consumedDeps: ConsumedDependencies;
  private resolutionCache: Map<string, ResolvedDependency[]> = new Map();
  constructor(
    dependencies: Dependencies,
    lockFile: LockFile | undefined,
    assignments: BundleAssignment[],
    private bundle: URL
  ) {
    this.consumedDeps = gatherDependencies(
      dependencies,
      lockFile,
      assignments,
      bundle
    );
    this.resolutionCache = new Map();
  }

  resolutionsForPkg(pkgHref: string): ResolvedDependency[] {
    let cachedResolutions = this.resolutionCache.get(pkgHref);
    if (cachedResolutions) {
      return cachedResolutions;
    }

    let resolutions = this.consumedDeps.get(pkgHref);
    if (!resolutions || resolutions.length === 0) {
      return [];
    }

    // this is a map of bundleHrefs (which include the pkg version), to a set of
    // resolution indices (from the "resolutions" array) whose consumption range
    // satisfies the bundleHref version. The goal is to find the package that
    // has the most amount of range satisfications.
    let rangeSatisfications = new Map<string, Set<number>>();

    for (let [versionIndex, { bundleHref }] of resolutions.entries()) {
      let { version: ver } = pkgInfoFromCatalogJsURL(new URL(bundleHref))!;
      let version = coerce(ver);
      if (!version) {
        throw new Error(
          `the version ${ver} for the bundle ${bundleHref} is not a valid version, while processing bundle ${this.bundle.href}`
        );
      }
      let rangeIndices = rangeSatisfications.get(bundleHref);
      if (!rangeIndices) {
        rangeIndices = new Set();
        rangeSatisfications.set(bundleHref, rangeIndices);
      }
      for (let [rangeIndex, { range }] of resolutions.entries()) {
        if (versionIndex === rangeIndex) {
          // the version used for a declaration should always match its own consumption range
          rangeIndices.add(rangeIndex);
          continue;
        }
        // npm allows non-semver range strings in the right hand side of the
        // dependency (e.g. URLs, tags, branches, etc)
        if (!validRange(range)) {
          continue;
        }
        if (satisfies(version, range)) {
          rangeIndices.add(rangeIndex);
        }
      }
    }

    // Choose the bundleHref (pkg ver) that is satisfied by the most amount of
    // consumption ranges. For the unsatisfied bundleHrefs, choose the bundle
    // href that has the next highest amount of satisfications, and so on, until
    // we have accounted for all the consumption points. The determinations made
    // using this algorithm will not look past local maxima when trying to
    // optimize for the greatest reuse, so there are definitely improvements
    // that can be made to this algorithm. When there is a tie, select the
    // bundleHref that is the highest version. The resulting range for each set
    // will be an intersection of all the ranges that correspond to the versions
    // that were satisfied in the group.
    let resultingResolutions: ResolvedDependency[] = [];
    let unsatisfiedConsumptionIndices = [...resolutions.entries()].map(
      ([index]) => index
    );
    let sortedBundleHrefs = [...rangeSatisfications.entries()].sort(
      ([bundleHrefA, aIndices], [bundleHrefB, bIndices]) => {
        let diff = bIndices.size - aIndices.size;
        if (diff !== 0) {
          return diff;
        }
        let { version: verA } = pkgInfoFromCatalogJsURL(new URL(bundleHrefA))!;
        let versionA = coerce(verA)!;
        let { version: verB } = pkgInfoFromCatalogJsURL(new URL(bundleHrefB))!;
        let versionB = coerce(verB)!;
        return compare(versionB, versionA);
      }
    );
    while (unsatisfiedConsumptionIndices.length > 0) {
      if (sortedBundleHrefs.length === 0) {
        throw new Error(
          `unable to determine bundleHref to satisfy consumption ranges: ${unsatisfiedConsumptionIndices
            .map((i) => resolutions![i].range)
            .join()}`
        );
      }
      let [selectedBundleHref, consumptionIndices] = sortedBundleHrefs.shift()!;
      let selectedIndex = resolutions.findIndex(
        (r) => r.bundleHref === selectedBundleHref
      )!;
      let selected = resolutions[selectedIndex];
      let obviatedIndices = [...consumptionIndices].filter(
        (i) => i != selectedIndex
      );
      let {
        bundleHref,
        importedSource,
        consumedBy,
        consumedByPointer,
      } = selected;

      let invalidSemverRangeIndex = [...consumptionIndices].find(
        (i) => !validRange(resolutions![i].range)
      );
      let invalidSemverRange =
        invalidSemverRangeIndex != null
          ? resolutions[invalidSemverRangeIndex].range
          : undefined;
      if (invalidSemverRange && consumptionIndices.size > 1) {
        throw new Error(
          `a non semver range '${invalidSemverRange}' satisfied more than one pkg version--this should be impossible. the satisfied packages are: ${[
            ...consumptionIndices,
          ]
            .map((i) => resolutions![i].bundleHref)
            .join(", ")}`
        );
      }
      let range: string;
      let obviatedDependencies: ResolvedDependency["obviatedDependencies"];
      if (invalidSemverRange) {
        range = invalidSemverRange;
        obviatedDependencies = [];
      } else {
        range = intersect(
          ...[...consumptionIndices].map((i) => resolutions![i].range)
        );
        obviatedDependencies = obviatedIndices.map((i) => ({
          moduleHref: resolutions![i].consumedBy.url.href,
          pointer: resolutions![i].consumedByPointer,
        }));
      }

      resultingResolutions.push({
        importedSource,
        consumedBy,
        consumedByPointer,
        bundleHref,
        range,
        obviatedDependencies,
        importedAs: resolutions[[...consumptionIndices][0]].importedAs,
      });
      unsatisfiedConsumptionIndices = unsatisfiedConsumptionIndices.filter(
        (i) => !consumptionIndices.has(i)
      );
    }

    this.resolutionCache.set(pkgHref, resultingResolutions);
    return resultingResolutions;
  }
}

interface ConsumedDependency {
  importedSource?: {
    pointer: RegionPointer;
    declaredIn: ModuleResolution;
  };
  importedAs: string | NamespaceMarker;
  consumedByPointer: RegionPointer;
  consumedBy: ModuleResolution;
  bundleHref: string;
  range: string;
}

export interface ResolvedDependency extends ConsumedDependency {
  obviatedDependencies: { moduleHref: string; pointer: RegionPointer }[];
}

type ConsumedDependencies = Map<string, ConsumedDependency[]>; // the key of the map is the pkgHref

function gatherDependencies(
  dependencies: Dependencies,
  lockFile: LockFile | undefined,
  assignments: BundleAssignment[],
  bundle: URL
): ConsumedDependencies {
  let consumedDeps: ConsumedDependencies = new Map();
  let ownAssignments = assignments.filter(
    (a) => a.bundleURL.href === bundle.href
  );

  // first we gather up all the direct dependencies of the project from the lock
  // file--this has the benefit of listing out all the direct dependencies of
  // the project and their resolutions
  for (let [specifier, bundleHref] of Object.entries(lockFile ?? {})) {
    let [pkgName, ...bundleParts] = specifier.split("/");
    if (pkgName.startsWith("@")) {
      pkgName = `${pkgName}/${bundleParts.shift()}`;
    }
    if (!bundleHref) {
      throw new Error(
        `unable to determine resolution for ${specifier} in bundle ${bundle.href} from lock file.`
      );
    }
    let pkgAssignment = assignments.find(
      (a) => a.module.url.href === bundleHref
    );
    if (!pkgAssignment) {
      continue;
    }
    let dependency = dependencies[pkgName];
    if (!dependency) {
      throw new Error(
        `unable to determine entrypoints.json dependency from the specifier ${specifier} with resolution ${bundleHref} in bundle ${bundle.href}. Are you missing an dependency for '${pkgName}' in your entrypoints.json file?`
      );
    }
    let { pkgURL } = pkgInfoFromCatalogJsURL(new URL(bundleHref)) ?? {};
    if (!pkgURL) {
      throw new Error(
        `cannot derive pkgURL from bundle URL ${bundleHref} (resolved from '${specifier}') when building bundle ${bundle.href}`
      );
    }
    for (let { module } of ownAssignments) {
      for (let [pointer, region] of module.desc.regions.entries()) {
        // TODO don't forget about pure side effect imports...
        if (
          region.type !== "declaration" ||
          region.declaration.type !== "import" ||
          module.resolvedImports[region.declaration.importIndex].url.href !==
            bundleHref
        ) {
          continue;
        }
        let source = resolveDeclaration(
          region.declaration.importedName,
          module.resolvedImports[region.declaration.importIndex],
          module,
          ownAssignments
        );
        if (source.type === "resolved") {
          let consumed = consumedDeps.get(pkgURL.href);
          if (!consumed) {
            consumed = [];
            consumedDeps.set(pkgURL.href, consumed);
          }

          consumed.push({
            importedSource: {
              pointer: source.pointer,
              declaredIn: makeNonCyclic(source.module),
            },
            bundleHref,
            consumedBy: module,
            consumedByPointer: pointer,
            importedAs: region.declaration.importedName,
            range: dependency.range,
          });
        }
      }
    }
  }

  // then we gather up all the embedded deps in the included bundles via the
  // "original" property
  for (let { module } of assignments) {
    if (
      assignments.find((a) => a.module.url.href === module.url.href)?.bundleURL
        .href !== bundle.href
    ) {
      continue;
    }
    for (let [, { pointer, declaration }] of module.desc.declarations) {
      if (declaration.type === "import") {
        continue;
      }
      if (declaration.original) {
        let { pkgURL } =
          pkgInfoFromCatalogJsURL(new URL(declaration.original.bundleHref)) ??
          {};
        if (!pkgURL) {
          throw new Error(
            `cannot derive pkgURL from bundle URL ${declaration.original.bundleHref} when building bundle ${bundle.href}`
          );
        }
        let consumed = consumedDeps.get(pkgURL.href);
        if (!consumed) {
          consumed = [];
          consumedDeps.set(pkgURL.href, consumed);
        }

        consumed.push({
          consumedByPointer: pointer,
          consumedBy: module,
          importedAs: declaration.original.importedAs,
          range: declaration.original.range,
          bundleHref: declaration.original.bundleHref,
        });
      }
    }
  }
  return consumedDeps;
}

export function resolutionForPkgDepDeclaration(
  module: ModuleResolution,
  bindingName: string,
  depResolver: DependencyResolver
): ResolvedDependency | undefined {
  let { declaration: desc, pointer } =
    module.desc.declarations.get(bindingName) ?? {};
  if (!desc) {
    return;
  }
  let pkgURL: URL | undefined;
  if (desc.type === "local" && desc.original) {
    pkgURL = pkgInfoFromCatalogJsURL(new URL(desc.original.bundleHref))?.pkgURL;
  } else if (desc.type === "import") {
    pkgURL = pkgInfoFromCatalogJsURL(
      module.resolvedImports[desc.importIndex].url
    )?.pkgURL;
  }
  if (pkgURL) {
    return depResolver
      .resolutionsForPkg(pkgURL?.href)
      .find(
        (r) =>
          (r.consumedBy.url.href === module!.url.href &&
            r.consumedByPointer === pointer) ||
          r.obviatedDependencies.find(
            (o) => o.moduleHref === module!.url.href && o.pointer === pointer
          )
      );
  }
  return;
}
