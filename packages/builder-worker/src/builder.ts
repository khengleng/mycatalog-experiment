import {
  FileSystem,
  Event as FSEvent,
  eventCategory,
  eventGroup,
} from "./filesystem";
import { addEventListener, Event, dispatchEvent } from "./event-bus";
import { ReloadEvent, eventGroup as reloadEventGroup } from "./client-reload";
import bind from "bind-decorator";
import {
  OutputTypes,
  BuilderNode,
  NodeOutput,
  debugName,
} from "./nodes/common";
import { FileNode, WriteFileNode } from "./nodes/file";
import { MakeProjectNode } from "./nodes/project";
import { FileDescriptor } from "./filesystem-drivers/filesystem-driver";
import { Deferred } from "./deferred";
import { assertNever } from "shared/util";
import { error } from "./logger";

type BoolForEach<T> = {
  [P in keyof T]: boolean;
};

// nodes are allowed to use any type as their cacheKey, we use this alias to
// make our own types more readable
type CacheKey = unknown;

type InternalResult =
  | { node: BuilderNode; changed: boolean }
  | { value: unknown; changed: boolean };

type CurrentState =
  | InitialState
  | ReusedState
  | EvaluatingState
  | CompleteState;

interface InitialState {
  name: "initial";
  node: BuilderNode;
}

interface ReusedState {
  name: "reused";
  node: BuilderNode;
  deps: { [name: string]: BuilderNode } | null;
}

interface EvaluatingState {
  name: "evaluating";
  node: BuilderNode;
  deps: { [name: string]: BuilderNode } | null;
  output: Promise<InternalResult>;
}

interface CompleteState {
  name: "complete";
  node: BuilderNode;
  deps: { [name: string]: BuilderNode } | null;
  output: InternalResult;
  didChange: boolean;
}

type Explanation = Map<
  string,
  { prevNodes: Set<string>; nextNode: string | undefined; didChange: boolean }
>;

class CurrentContext {
  nodeStates: Map<string, CurrentState> = new Map();
  constructor(public changedFiles: Set<string>) {}
}

class BuildRunner<Input> {
  private nodeStates: Map<CacheKey, CompleteState> = new Map();
  private watchedFiles: Set<string> = new Set();
  private recentlyChangedFiles: Set<string> = new Set();
  private currentContext: CurrentContext | undefined;

  constructor(
    private fs: FileSystem,
    private roots: Input,
    private inputDidChange?: () => void
  ) {}

  explain(): Explanation {
    let explanation: Explanation = new Map();
    for (let state of this.nodeStates.values()) {
      let prevNodes = new Set<string>();
      if (state.deps) {
        for (let dep of Object.values(state.deps)) {
          prevNodes.add(debugName(dep));
        }
      }
      let nextNode: string | undefined;
      if ("node" in state.output) {
        nextNode = debugName(state.output.node);
      }
      explanation.set(debugName(state.node), {
        prevNodes,
        nextNode,
        didChange: state.didChange,
      });
    }
    return explanation;
  }

  async build(): Promise<OutputTypes<Input>> {
    let context = new CurrentContext(this.recentlyChangedFiles);
    this.currentContext = context;
    this.recentlyChangedFiles = new Set();
    let result = await this.evalNodes(this.roots);
    assertAllComplete(context.nodeStates);
    this.nodeStates = context.nodeStates;
    this.currentContext = undefined;
    return result.values;
  }

  @bind
  private getCurrentContext(): CurrentContext {
    if (this.currentContext) {
      return this.currentContext;
    }
    throw new Error(`bug: tried to access currentContext outside of a build`);
  }

  private async evalNodes<LocalInput>(
    nodes: LocalInput
  ): Promise<{
    values: OutputTypes<LocalInput>;
    changes: BoolForEach<LocalInput>;
  }> {
    let values = {} as OutputTypes<LocalInput>;
    let changes = {} as BoolForEach<LocalInput>;
    for (let [name, node] of Object.entries(nodes)) {
      let { value, changed } = await this.evalNode(node);
      (values as any)[name] = value;
      (changes as any)[name] = changed;
    }
    return { values, changes };
  }

  private getNodeState(node: BuilderNode): CurrentState {
    let state = this.getCurrentContext().nodeStates.get(node.cacheKey);
    if (state) {
      return state;
    }

    // if we had the same cacheKey in the previous build, reuse the Node
    // instance. This lets nodes do stateful optimizations.
    let lastState = this.nodeStates.get(node.cacheKey);
    if (lastState) {
      return {
        name: "reused",
        node: lastState.node,
        deps: lastState.deps,
      };
    }

    return {
      name: "initial",
      node,
    };
  }

  private async evalNode(
    node: BuilderNode
  ): Promise<{ value: unknown; changed: boolean }> {
    let state = this.getNodeState(node);

    switch (state.name) {
      case "initial":
        let realNode = state.node;
        if (FileNode.isFileNode(realNode)) {
          realNode = new InternalFileNode(
            realNode.url,
            this.fs,
            this.getCurrentContext,
            this.roots,
            this.ensureWatching
          );
        }
        return this.handleNextNode(
          await this.evaluate(realNode, realNode.deps())
        );
      case "reused":
        return this.handleNextNode(await this.evaluate(state.node, state.deps));
      case "evaluating":
      case "complete":
        return this.handleNextNode(await state.output);
      default:
        throw assertNever(state);
    }
  }

  private async evaluate(node: BuilderNode, maybeDeps: unknown) {
    let state = this.startEvaluating(node, maybeDeps);
    let result = await state.output;
    this.getCurrentContext().nodeStates.set(node.cacheKey, {
      name: "complete",
      node,
      deps: state.deps,
      output: result,
      didChange: result.changed,
    });
    return result;
  }

  private startEvaluating(
    node: BuilderNode,
    maybeDeps: unknown
  ): EvaluatingState {
    let deps: EvaluatingState["deps"];

    if (hasDeps(maybeDeps)) {
      let deduplicatedDeps: typeof maybeDeps = {};
      for (let [key, depNode] of Object.entries(maybeDeps)) {
        let existing = this.getNodeState(depNode);
        if (existing) {
          deduplicatedDeps[key] = existing.node;
        } else {
          this.getCurrentContext().nodeStates.set(depNode.cacheKey, {
            name: "initial",
            node: depNode,
          });
          deduplicatedDeps[key] = depNode;
        }
      }
      deps = deduplicatedDeps;
    } else {
      deps = null;
    }

    let output = this.runNode(node, deps);
    let state: EvaluatingState = {
      name: "evaluating",
      node,
      deps,
      output,
    };
    this.getCurrentContext().nodeStates.set(node.cacheKey, state);
    return state;
  }

  private async handleNextNode(
    result: InternalResult
  ): Promise<{ value: unknown; changed: boolean }> {
    if ("node" in result) {
      return this.evalNode(result.node);
    } else {
      return result;
    }
  }

  private async runNode(
    node: BuilderNode,
    deps: EvaluatingState["deps"]
  ): Promise<InternalResult> {
    let inputs = deps ? await this.evalNodes(deps) : null;
    let previous = this.nodeStates.get(node.cacheKey);
    if (previous && !node.volatile) {
      let stableInputs: boolean;
      if (inputs) {
        stableInputs = Object.values(inputs.changes).every(
          (didChange) => !didChange
        );
      } else {
        stableInputs = true;
      }
      if (stableInputs) {
        return makeInternalResult(previous.output, false);
      }
    }

    if (WriteFileNode.isWriteFileNode(node)) {
      let fd = (await this.fs.open(node.url, true)) as FileDescriptor;
      await fd.write(Object.values(inputs!.values)[0] as string);
      fd.close();
      return { value: undefined, changed: true };
    } else if (inputs) {
      return this.handleUnchanged(node, await node.run(inputs.values));
    } else {
      return this.handleUnchanged(
        node,
        await (node as BuilderNode<unknown, void>).run()
      );
    }
  }

  @bind
  private ensureWatching(url: URL) {
    if (!this.watchedFiles.has(url.href)) {
      addEventListener(this.fileDidChange);
      this.watchedFiles.add(url.href);
    }
  }

  @bind
  private fileDidChange(event: Event<FSEvent>) {
    if (
      event.group === eventGroup &&
      event.args.category === eventCategory &&
      this.watchedFiles.has(event.args.href)
    ) {
      this.recentlyChangedFiles.add(event.args.href);
      this.inputDidChange?.();
    }
  }

  private handleUnchanged(
    node: BuilderNode,
    result: NodeOutput<unknown>
  ): InternalResult {
    if ("unchanged" in result) {
      let previous = this.nodeStates.get(node.cacheKey);
      if (!previous) {
        throw new Error(
          `Node ${node.cacheKey} returned { unchanged: true } from its first run()`
        );
      }
      return makeInternalResult(previous.output, false);
    }
    return makeInternalResult(result, true);
  }
}

export class Builder<Input> {
  private runner: BuildRunner<Input>;

  constructor(fs: FileSystem, roots: Input) {
    this.runner = new BuildRunner(fs, roots);
  }

  // roots lists [inputRoot, outputRoot]
  static forProjects(fs: FileSystem, roots: [URL, URL][]) {
    return new this(fs, projectsToNodes(roots));
  }

  async build(): ReturnType<BuildRunner<Input>["build"]> {
    return this.runner.build();
  }

  explain(): Explanation {
    return this.runner.explain();
  }
}

type RebuilderState =
  | {
      name: "created";
    }
  | {
      name: "working";
    }
  | {
      name: "idle";
      lastBuildSucceeded: true;
    }
  | {
      name: "idle";
      lastBuildSucceeded: false;
      error: Error;
    }
  | {
      name: "shutdown-requested";
    }
  | {
      name: "rebuild-requested";
    }
  | {
      name: "shutdown";
    };

export class Rebuilder<Input> {
  private runner: BuildRunner<Input>;
  private state: RebuilderState = {
    name: "created",
  };
  private nextState: Deferred<RebuilderState> = new Deferred();

  constructor(fs: FileSystem, roots: Input) {
    this.runner = new BuildRunner(fs, roots, this.inputDidChange);
  }

  // roots lists [inputRoot, outputRoot]
  static forProjects(fs: FileSystem, roots: [URL, URL][]) {
    for (let [input, output] of roots) {
      if (input.origin === output.origin) {
        throw new Error(
          `The input root origin ${input.href} cannot be the same as the output root origin ${output}. This situation triggers a run away rebuild.`
        );
      }
    }
    return new this(fs, projectsToNodes(roots));
  }

  get status():
    | { name: "succeeded" }
    | { name: "failed"; exception: Error }
    | { name: "running" } {
    if (this.state.name === "idle") {
      return this.state.lastBuildSucceeded
        ? { name: "succeeded" }
        : { name: "failed", exception: this.state.error };
    } else {
      return { name: "running" };
    }
  }

  start() {
    if (this.state.name === "created") {
      this.run();
    }
  }

  @bind
  private inputDidChange() {
    switch (this.state.name) {
      case "shutdown-requested":
      case "shutdown":
        // shutdown takes precedence
        break;
      default:
        this.setState({ name: "rebuild-requested" });
    }
  }

  private setState(newState: RebuilderState): void {
    this.state = newState;
    let nextState = this.nextState;
    this.nextState = new Deferred();
    nextState.resolve(newState);
  }

  private async run(): Promise<void> {
    while (true) {
      switch (this.state.name) {
        case "created":
          this.setState({ name: "working" });
          break;
        case "working":
          try {
            await this.runner.build();
            if (this.state.name === "working") {
              this.setState({ name: "idle", lastBuildSucceeded: true });
            }
            dispatchEvent<ReloadEvent>(reloadEventGroup, {});
          } catch (err) {
            if (this.state.name === "working") {
              this.setState({
                name: "idle",
                lastBuildSucceeded: false,
                error: err,
              });
            }
            error(`Exception while building`, err);
          }
          break;
        case "idle":
          await this.nextState.promise;
          break;
        case "rebuild-requested":
          this.setState({ name: "working" });
          break;
        case "shutdown-requested":
          this.setState({ name: "shutdown" });
          break;
        case "shutdown":
          return;
        default:
          throw assertNever(this.state);
      }
    }
  }

  async isIdle(): Promise<void> {
    while (this.state.name !== "idle") {
      await this.nextState.promise;
    }
  }

  async shutdown(): Promise<void> {
    if (this.state.name === "created") {
      // we want to kick off the run loop so that this builder can't be reused
      this.run();
    }
    this.setState({ name: "shutdown-requested" });
    while (this.state.name !== "shutdown") {
      await this.nextState.promise;
    }
  }

  explain(): Explanation {
    return this.runner.explain();
  }
}

function hasDeps(deps: unknown): deps is { [key: string]: BuilderNode } {
  return typeof deps === "object" && deps != null;
}

function makeInternalResult(
  input: { value: unknown } | { node: BuilderNode },
  changed: boolean
): InternalResult {
  if ("node" in input) {
    return { node: input.node, changed };
  } else {
    return { value: input.value, changed };
  }
}

function assertAllComplete(
  nodeStates: Map<CacheKey, CurrentState>
): asserts nodeStates is Map<CacheKey, CompleteState> {
  for (let state of nodeStates.values()) {
    if (state.name !== "complete") {
      throw new Error(
        `bug: found a node that was not in state "complete" at the end of the build: ${state.node.cacheKey}`
      );
    }
  }
}

function dotSafeName(name: string): string {
  return name.replace(/"/g, '\\"');
}

export function explainAsDot(explanation: Explanation): string {
  let output = ["digraph {"];
  for (let [debugName, { prevNodes, nextNode, didChange }] of explanation) {
    let name = dotSafeName(debugName);

    // nodes with red outlines have changed on the last build.
    output.push(`"${name}" ${didChange ? '[color="red"]' : ""}`);

    for (let prevNode of prevNodes) {
      let entry = explanation.get(prevNode)!;
      while (entry.nextNode) {
        // keep following nextNode, because that is what actually provides our
        // output. This means the black arrows on the graph will actually point
        // at where your answer came from.
        prevNode = entry.nextNode;
        entry = explanation.get(prevNode)!;
      }
      output.push(`"${name}" -> "${dotSafeName(prevNode)}"`);
    }

    if (nextNode) {
      // the blue arrows mean "created by"
      output.push(`"${dotSafeName(nextNode)}" -> "${name}" [color="blue"]`);
    }
  }
  output.push("}");
  return output.join("\n");
}

function projectsToNodes(roots: [URL, URL][]) {
  return roots.map(([input, output]) => new MakeProjectNode(input, output));
}

class InternalFileNode<Input> implements BuilderNode<string> {
  cacheKey: string;
  volatile = true;

  private firstRun = true;

  constructor(
    private url: URL,
    private fs: FileSystem,
    private getCurrentContext: () => CurrentContext,
    private roots: Input,
    private ensureWatching: BuildRunner<Input>["ensureWatching"]
  ) {
    this.cacheKey = `file:${this.url.href}`;
  }

  deps() {
    for (let _rootNode of Object.values(this.roots)) {
      let rootNode = _rootNode as BuilderNode;
      if (
        rootNode.projectOutputRoot &&
        this.url.href.startsWith(rootNode.projectOutputRoot.href)
      ) {
        return { dependsOnProject: rootNode };
      }
    }
    return undefined;
  }

  async run(dependsOnProject: unknown): Promise<NodeOutput<string>> {
    if (
      !this.firstRun &&
      !this.getCurrentContext().changedFiles.has(this.url.href)
    ) {
      return { unchanged: true };
    }
    if (this.firstRun) {
      this.firstRun = false;
    }

    if (!dependsOnProject) {
      this.ensureWatching(this.url);
    }
    let fd: FileDescriptor | undefined;
    try {
      fd = (await this.fs.open(this.url)) as FileDescriptor;
      if (fd.type === "file") {
        return { value: await fd.readText() };
      } else {
        throw new Error(
          `bug: expecting ${this.url} to be a file, but it was a directory`
        );
      }
    } finally {
      if (fd) {
        fd.close();
      }
    }
  }
}
