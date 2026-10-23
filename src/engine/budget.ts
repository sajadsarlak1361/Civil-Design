const CPU_KEY = 'fieldline.cpuLimit';
const DEFAULT_CPU = 0.7;

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Fraction of hardware threads Civil Design may occupy. Default 70%. */
export function getCpuLimit(): number {
  const raw = storage()?.getItem(CPU_KEY);
  const value = raw == null ? DEFAULT_CPU : Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_CPU;
  return Math.min(1, Math.max(0.1, value));
}

export function setCpuLimit(fraction: number): number {
  const next = Math.min(1, Math.max(0.1, fraction));
  storage()?.setItem(CPU_KEY, String(next));
  return next;
}

export function coreCount(): number {
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0) return navigator.hardwareConcurrency;
  return 4;
}

/**
 * Worker count is about `cpuLimit` of the machine, at least one, and never every
 * core when more than one exists so the UI and OS keep a thread.
 */
export function workerCount(limit = getCpuLimit(), cores = coreCount()): number {
  const safeCores = Math.max(1, Math.floor(cores) || 1);
  let count = Math.max(1, Math.floor(safeCores * limit));
  if (safeCores > 1 && count >= safeCores) count = safeCores - 1;
  return Math.max(1, count);
}

/** Bytes Civil Design may spend on caches and LOD. `deviceMemory` is gigabytes, when the browser provides it. */
export function memoryBudgetBytes(deviceMemoryGb?: number, fraction = getCpuLimit()): number {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const gb = deviceMemoryGb && deviceMemoryGb > 0 ? deviceMemoryGb : nav?.deviceMemory && nav.deviceMemory > 0 ? nav.deviceMemory : 8;
  return Math.floor(gb * fraction * 1024 * 1024 * 1024);
}
