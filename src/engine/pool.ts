import HeavyWorker from './heavy.worker.ts?worker&inline';
import { getCpuLimit, workerCount } from './budget';

interface Slot {
  worker: Worker;
  busy: boolean;
  jobId: number;
}

interface Job {
  id: number;
  message: Record<string, unknown>;
  transfer: Transferable[];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
}

const slots: Slot[] = [];
const queue: Job[] = [];
const jobs = new Map<number, Job>();
let seq = 1;

function abortError(): Error {
  const error = new Error('The operation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function bind(slot: Slot): void {
  slot.worker.onmessage = (event: MessageEvent<{ id?: number; error?: string }>) => {
    const data = event.data;
    if (!data || data.id == null) return;
    if (slot.jobId === data.id) {
      slot.busy = false;
      slot.jobId = 0;
    }
    const job = jobs.get(data.id);
    jobs.delete(data.id);
    if (job) {
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data);
    }
    pump();
  };
  slot.worker.onerror = () => {
    const id = slot.jobId;
    slot.busy = false;
    slot.jobId = 0;
    const job = jobs.get(id);
    jobs.delete(id);
    job?.reject(new Error('TIN build failed.'));
    pump();
  };
}

function spawn(): Slot {
  const slot: Slot = { worker: new HeavyWorker(), busy: false, jobId: 0 };
  bind(slot);
  return slot;
}

export function resizePool(): void {
  const wanted = workerCount(getCpuLimit());
  while (slots.length < wanted) slots.push(spawn());
  while (slots.length > wanted) {
    const slot = slots.pop();
    if (!slot) break;
    if (slot.busy) {
      const job = jobs.get(slot.jobId);
      jobs.delete(slot.jobId);
      job?.reject(new Error('Worker pool resized.'));
    }
    slot.worker.terminate();
  }
  pump();
}

function pump(): void {
  for (const slot of slots) {
    if (slot.busy) continue;
    let job = queue.shift();
    while (job && (job.signal?.aborted || !jobs.has(job.id))) job = queue.shift();
    if (!job) return;
    slot.busy = true;
    slot.jobId = job.id;
    slot.worker.postMessage(job.message, job.transfer);
  }
}

export function runPool<T>(op: string, message: Record<string, unknown>, transfer: Transferable[] = [], signal?: AbortSignal): Promise<T> {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('Workers are not available.'));
  resizePool();
  const id = seq++;
  return new Promise<T>((resolve, reject) => {
    const job: Job = {
      id,
      message: { ...message, id, op },
      transfer,
      resolve: (value) => resolve(value as T),
      reject,
      signal,
    };
    jobs.set(id, job);
    if (signal) {
      signal.addEventListener('abort', () => cancelPool(id), { once: true });
    }
    queue.push(job);
    pump();
  });
}

export function cancelPool(id: number): void {
  const queued = queue.findIndex((job) => job.id === id);
  if (queued >= 0) queue.splice(queued, 1);
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  job.reject(abortError());
  const slot = slots.find((item) => item.jobId === id);
  if (!slot) return;
  slot.worker.terminate();
  slot.worker = new HeavyWorker();
  slot.busy = false;
  slot.jobId = 0;
  bind(slot);
  pump();
}

export function poolAvailable(): boolean {
  return typeof Worker !== 'undefined';
}
