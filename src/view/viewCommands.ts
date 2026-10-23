import { getHost, getView } from '../commands/host';
import { getWorkspace, patchChrome, recallNamedView, setActivePreset, setLayout, setOrbitMode, setVisualStyle, type OrbitMode, type ViewPreset, type ViewportCount, type VisualStyle } from './workspace';

/** Directional pan uses the plan view's existing panScreen, which calls panBy. */
export function panDirection(direction: 'left' | 'right' | 'up' | 'down'): void {
  const view = getView();
  if (view?.panScreen) {
    view.panScreen(direction);
    return;
  }
  getHost()?.setView('plan');
}

export function applyOrbit(mode: OrbitMode): void {
  setOrbitMode(mode);
  getHost()?.setView('3d');
}

export function applyPlan(): void {
  setActivePreset('plan');
  getHost()?.setView('plan');
}

export function applyViewportLayout(count: ViewportCount): void {
  setLayout(count);
  if (count > 1) getHost()?.setView('3d');
}

export function applyPreset(preset: ViewPreset): void {
  setActivePreset(preset);
  if (preset === 'plan') getHost()?.setView('plan');
  else getHost()?.setView('3d');
}

export function applyStyle(style: VisualStyle): void {
  setVisualStyle(style);
}

export function restoreView(name: string): boolean {
  const named = getWorkspace().namedViews.find((view) => view.name.toLowerCase() === name.trim().toLowerCase());
  if (!named || !recallNamedView(name)) return false;
  if (named.preset === 'plan') getHost()?.setView('plan');
  else getHost()?.setView('3d');
  return true;
}

export function toggleChrome(key: 'showGrid' | 'ucsAtOrigin' | 'commandLine' | 'statusBar' | 'properties' | 'layers' | 'xrefs' | 'toolPalettes' | 'viewCube' | 'navBar' | 'textWindow' | 'cleanScreen'): void {
  patchChrome({ [key]: !getWorkspace()[key] });
  if (key === 'showGrid' || key === 'ucsAtOrigin') getView()?.redraw();
}
