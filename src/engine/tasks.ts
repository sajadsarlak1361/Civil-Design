export interface TaskStart {
  /** Command name echoed to the command line, for example CREATESURFACE. */
  command?: string;
  /** What the status bar says, without the Busy prefix. */
  title: string;
  /** Ordered stage names. The first one is current. */
  stages?: string[];
  /** When true the whole window uses the wait cursor. Otherwise the viewport uses progress. */
  blocksInput?: boolean;
  cancellable?: boolean;
}

export interface TaskView {
  id: string;
  command: string;
  title: string;
  stages: string[];
  stageIndex: number;
  /** 0..1, or null when the stage has no measurement yet. */
  fraction: number | null;
  startedAt: number;
  blocksInput: boolean;
  cancellable: boolean;
}

export interface BusyView {
  tasks: TaskView[];
  idle: boolean;
  /** Ready, or the busy sentence. */
  headline: string;
  stageTrail: string;
  cursor: 'auto' | 'progress' | 'wait';
  percent: number | null;
  elapsedSec: number;
  etaSec: number | null;
  taskCount: number;
}

export interface TaskHandle {
  id: string;
  signal: AbortSignal;
  stage(name: string, fraction?: number | null): void;
  progress(fraction: number | null): void;
  finish(): void;
  cancel(): void;
}

type Listener = () => void;
type Logger = (line: string) => void;

interface LiveTask {
  view: TaskView;
  controller: AbortController;
  finished: boolean;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0 s';
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  return `${Math.round(seconds)} s`;
}

class TaskManager {
  private tasks: LiveTask[] = [];
  private listeners = new Set<Listener>();
  private logger: Logger = () => {};
  private seq = 1;
  private snapshot: BusyView = idleView();

  setLogger(logger: Logger): void {
    this.logger = logger;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): BusyView {
    return this.snapshot;
  }

  /** Keep elapsed time moving while a task is open. Returns the current snapshot. */
  tick(now = Date.now()): BusyView {
    if (this.tasks.length === 0) return this.snapshot;
    this.snapshot = buildView(this.tasks.map((task) => task.view), now);
    for (const listener of this.listeners) listener();
    return this.snapshot;
  }

  start(options: TaskStart, now = Date.now()): TaskHandle {
    const id = `t${this.seq++}`;
    const stages = options.stages && options.stages.length > 0 ? options.stages.slice() : [];
    const view: TaskView = {
      id,
      command: options.command ?? '',
      title: options.title,
      stages,
      stageIndex: 0,
      fraction: stages.length > 0 ? 0 : null,
      startedAt: now,
      blocksInput: options.blocksInput ?? false,
      cancellable: options.cancellable ?? true,
    };
    const controller = new AbortController();
    const live: LiveTask = { view, controller, finished: false };
    this.tasks.push(live);
    this.publish(now);
    const label = options.command ? `${options.command} — ${options.title}` : options.title;
    this.logger(label);
    const handle: TaskHandle = {
      id,
      signal: controller.signal,
      stage: (name, fraction) => {
        if (live.finished) return;
        const index = view.stages.indexOf(name);
        if (index >= 0) view.stageIndex = index;
        else {
          view.stages.push(name);
          view.stageIndex = view.stages.length - 1;
        }
        if (fraction !== undefined) view.fraction = fraction;
        this.publish();
      },
      progress: (fraction) => {
        if (live.finished) return;
        view.fraction = fraction == null || !Number.isFinite(fraction) ? null : Math.min(1, Math.max(0, fraction));
        this.publish();
      },
      finish: () => this.complete(live, false),
      cancel: () => this.complete(live, true),
    };
    return handle;
  }

  cancel(id: string): void {
    const live = this.tasks.find((task) => task.view.id === id);
    if (live) this.complete(live, true);
  }

  private complete(live: LiveTask, cancelled: boolean): void {
    if (live.finished) return;
    live.finished = true;
    if (cancelled) live.controller.abort();
    this.tasks = this.tasks.filter((task) => task !== live);
    const seconds = (Date.now() - live.view.startedAt) / 1000;
    const name = live.view.command || live.view.title;
    this.logger(cancelled ? `${name} cancelled after ${formatSeconds(seconds)}` : `${name} completed in ${formatSeconds(seconds)}`);
    this.publish();
  }

  private publish(now = Date.now()): void {
    this.snapshot = buildView(this.tasks.map((task) => task.view), now);
    for (const listener of this.listeners) listener();
  }
}

function idleView(): BusyView {
  return {
    tasks: [],
    idle: true,
    headline: 'Ready',
    stageTrail: '',
    cursor: 'auto',
    percent: null,
    elapsedSec: 0,
    etaSec: null,
    taskCount: 0,
  };
}

export function buildView(tasks: TaskView[], now: number): BusyView {
  if (tasks.length === 0) return idleView();
  const primary = tasks[0];
  const elapsedSec = Math.max(0, (now - primary.startedAt) / 1000);
  const percent = primary.fraction == null ? null : Math.round(primary.fraction * 100);
  let etaSec: number | null = null;
  if (primary.fraction != null && primary.fraction > 0.02 && primary.fraction < 1) {
    etaSec = elapsedSec * (1 - primary.fraction) / primary.fraction;
  }
  const pct = percent == null ? '' : ` ${percent}%`;
  const count = tasks.length > 1 ? `${tasks.length} tasks — ` : '';
  const headline = `Busy — ${count}${primary.title}…${pct}`;
  const stageTrail = primary.stages.join(' → ');
  const cursor = tasks.some((task) => task.blocksInput) ? 'wait' : 'progress';
  return {
    tasks: tasks.map((task) => ({ ...task, stages: task.stages.slice() })),
    idle: false,
    headline,
    stageTrail,
    cursor,
    percent,
    elapsedSec,
    etaSec,
    taskCount: tasks.length,
  };
}

export const tasks = new TaskManager();

export function subscribeTasks(listener: () => void): () => void {
  return tasks.subscribe(listener);
}

export function taskSnapshot() {
  return tasks.getSnapshot();
}

/** Test helper. Production code uses the shared `tasks` instance. */
export function createTaskManager(): TaskManager {
  return new TaskManager();
}

export type { TaskManager };
