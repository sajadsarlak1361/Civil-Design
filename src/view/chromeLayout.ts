/** Chrome sizes. The drawing area is what remains after these rows. */

export type RibbonMode = 'full' | 'titles' | 'tabs';

export const RIBBON_CYCLE: RibbonMode[] = ['full', 'titles', 'tabs'];

export function nextRibbonMode(mode: RibbonMode): RibbonMode {
  const index = RIBBON_CYCLE.indexOf(mode);
  return RIBBON_CYCLE[(index + 1) % RIBBON_CYCLE.length];
}

/** Tall windows (above this height) use the full ribbon body and a 3-line command line. */
export const SHORT_WINDOW = 820;

const TALL = { menu: 22, tabs: 24, ribbon: 90, command: 48, status: 22 };
const SHORT = { menu: 20, tabs: 22, ribbon: 68, command: 22, status: 20 };

export const PALETTE_WIDTH = 260;
export const PALETTE_STRIP = 22;

export interface ChromeMetrics {
  menu: number;
  tabs: number;
  /** Panel body. Zero when the ribbon is minimized to tab names. */
  ribbon: number;
  command: number;
  status: number;
  /** Tab strip plus the panel body. */
  ribbonWrap: number;
  short: boolean;
}

export function chromeMetrics(windowHeight: number, mode: RibbonMode = 'full'): ChromeMetrics {
  const short = windowHeight <= SHORT_WINDOW;
  const base = short ? SHORT : TALL;
  const ribbon = mode === 'full' ? base.ribbon : mode === 'titles' ? 18 : 0;
  return {
    menu: base.menu,
    tabs: base.tabs,
    ribbon,
    command: base.command,
    status: base.status,
    ribbonWrap: base.tabs + ribbon,
    short,
  };
}

/** Fraction of the window occupied by the model area. Palettes default to collapsed (0). */
export function drawingShare(width: number, height: number, mode: RibbonMode = 'full', paletteWidth = 0): number {
  if (width <= 0 || height <= 0) return 0;
  const metrics = chromeMetrics(height, mode);
  const chrome = metrics.menu + metrics.ribbonWrap + metrics.command + metrics.status;
  const drawW = Math.max(0, width - paletteWidth);
  const drawH = Math.max(0, height - chrome);
  return (drawW * drawH) / (width * height);
}

/** How many panels from the right collapse to a single dropdown so the row fits. */
export function panelsToCollapse(panelWidths: number[], available: number): number {
  if (available <= 0) return panelWidths.length;
  const collapsed = 28;
  let used = panelWidths.reduce((sum, width) => sum + width, 0);
  let hide = 0;
  while (used > available + 1 && hide < panelWidths.length) {
    const width = panelWidths[panelWidths.length - 1 - hide];
    used += collapsed - width;
    hide += 1;
  }
  return hide;
}
