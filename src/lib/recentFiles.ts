const KEY = 'fieldline.recentFiles';

export function rememberRecent(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const current = recentFiles().filter((item) => item !== trimmed);
    localStorage.setItem(KEY, JSON.stringify([trimmed, ...current].slice(0, 8)));
  } catch {
    // Storage can be unavailable from file://.
  }
}

export function recentFiles(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
