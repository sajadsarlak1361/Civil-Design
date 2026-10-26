import { panBy, screenToWorld, zoomAt, type PlanCamera } from './camera';

/** Shown while PAN or realtime ZOOM is active. */
export const REALTIME_NAV_PROMPT = 'Press ESC or ENTER to exit, or right-click to display shortcut menu.';
export const PAN_BASE_PROMPT = 'Specify base point or displacement:';
export const PAN_SECOND_PROMPT = 'Specify second point:';

export const NAV_MENU = ['Exit', 'Pan', 'Zoom', 'Zoom Window', 'Zoom Original', 'Zoom Extents'] as const;
export type NavMenuAction = (typeof NAV_MENU)[number];

/** Realtime menu while the current view is a 3D camera. */
export const NAV_MENU_3D = ['Exit', 'Pan', 'Zoom', '3D Orbit', 'Zoom Window', 'Zoom Extents'] as const;

/** ZOOMFACTOR system variable. 3–100, default 60. */
export const DEFAULT_ZOOM_FACTOR = 60;

export type NavCommand = 'pan' | 'zoom' | 'idle' | 'busy';
export type PointerClass = 'pan' | 'zoom' | 'orbit' | 'menu' | 'passthrough';

export function wheelNotches(deltaY: number): number {
  if (!deltaY) return 0;
  const sign = deltaY > 0 ? 1 : -1;
  const abs = Math.abs(deltaY);
  const notches = abs >= 40 ? Math.max(1, Math.round(abs / 100)) : Math.max(1, Math.round(abs));
  return sign * notches;
}

/**
 * Wheel distance in the same units as a pixel delta.
 * Some desktop webviews report `wheelDelta` and leave `deltaY` at 0.
 * Positive means zoom out.
 */
export function wheelDeltaY(event: { deltaY: number; deltaMode?: number; wheelDelta?: number }): number {
  let delta = event.deltaY;
  if (!delta && event.wheelDelta) delta = -event.wheelDelta;
  if (!delta) return 0;
  if (event.deltaMode === 1) return Math.sign(delta) * Math.max(40, Math.abs(delta) * 40);
  if (event.deltaMode === 2) return Math.sign(delta) * Math.max(40, Math.abs(delta) * 100);
  return delta;
}

/** One wheel notch scales by `1 + ZOOMFACTOR/100`. Positive deltaY zooms out. */
export function wheelZoomRatio(deltaY: number, zoomFactor = DEFAULT_ZOOM_FACTOR): number {
  const notches = wheelNotches(deltaY);
  if (!notches) return 1;
  const clamped = Math.min(100, Math.max(3, zoomFactor));
  const step = 1 + clamped / 100;
  return notches > 0 ? 1 / step ** notches : step ** -notches;
}

/**
 * Middle-drag pans in every view. Shift+middle orbits only in 3D.
 * Realtime PAN/ZOOM claim the left button. Idle 2D left-drag stays a
 * window selection. Middle-drag pans. Other commands keep the left button.
 */
export function classifyPointer(button: number, shift: boolean, view: '2d' | '3d', command: NavCommand): PointerClass {
  if (button === 1) return view === '3d' && shift ? 'orbit' : 'pan';
  if (button === 2 && (command === 'pan' || command === 'zoom')) return 'menu';
  if (button === 0 && command === 'pan') return 'pan';
  if (button === 0 && command === 'zoom') return 'zoom';
  if (button === 0 && view === '3d') return 'orbit';
  return 'passthrough';
}

export interface CssPreview {
  dx: number;
  dy: number;
  scale: number;
}

/** Affine map from the bitmap that was drawn with `drawn` onto `live`. */
export function previewBetween(drawn: PlanCamera, live: PlanCamera, width: number, height: number, yDown = false): CssPreview {
  const scale = drawn.scale === 0 ? 1 : live.scale / drawn.scale;
  const dx = (1 - scale) * (width / 2) + (drawn.cx - live.cx) * live.scale;
  const dy = yDown
    ? (1 - scale) * (height / 2) + (drawn.cy - live.cy) * live.scale
    : (1 - scale) * (height / 2) + (live.cy - drawn.cy) * live.scale;
  return { dx, dy, scale };
}

export function cssTransform(preview: CssPreview | null): string {
  if (!preview) return '';
  if (Math.abs(preview.dx) < 1e-4 && Math.abs(preview.dy) < 1e-4 && Math.abs(preview.scale - 1) < 1e-6) return '';
  return `translate(${preview.dx}px, ${preview.dy}px) scale(${preview.scale})`;
}

export interface GestureState {
  drawn: PlanCamera | null;
  live: PlanCamera | null;
  kind: 'none' | 'pan' | 'zoom';
  button: number;
  lastX: number;
  lastY: number;
  originX: number;
  originY: number;
  moved: boolean;
  lastMiddleMs: number;
  yDown: boolean;
}

export function createGesture(yDown = false): GestureState {
  return {
    drawn: null,
    live: null,
    kind: 'none',
    button: -1,
    lastX: 0,
    lastY: 0,
    originX: 0,
    originY: 0,
    moved: false,
    lastMiddleMs: -1e9,
    yDown,
  };
}

export type GestureEvent =
  | {
      type: 'down';
      x: number;
      y: number;
      button: number;
      shift: boolean;
      view: '2d' | '3d';
      command: NavCommand;
      time: number;
      camera: PlanCamera;
      width: number;
      height: number;
    }
  | { type: 'move'; x: number; y: number; width: number; height: number }
  | { type: 'up'; x: number; y: number; button: number; time: number; width: number; height: number }
  | {
      type: 'wheel';
      x: number;
      y: number;
      deltaY: number;
      width: number;
      height: number;
      camera: PlanCamera;
      zoomFactor?: number;
    }
  | { type: 'commit'; width: number; height: number };

export interface GestureOutcome {
  state: GestureState;
  /** preview updates CSS only. commit is the single camera write when the gesture ends. */
  action: 'ignore' | 'preview' | 'commit' | 'extents' | 'orbit' | 'menu' | 'passthrough';
  css: string;
  camera: PlanCamera | null;
  cursor: 'grab' | 'grabbing' | 'zoom' | null;
  /** Middle-button and wheel gestures never cancel the running command. */
  interruptsCommand: boolean;
  consumed: boolean;
}

function outcome(
  state: GestureState,
  action: GestureOutcome['action'],
  extra: Partial<Omit<GestureOutcome, 'state' | 'action'>> = {},
): GestureOutcome {
  return {
    state,
    action,
    css: extra.css ?? '',
    camera: extra.camera ?? null,
    cursor: extra.cursor ?? null,
    interruptsCommand: extra.interruptsCommand ?? false,
    consumed: extra.consumed ?? (action !== 'passthrough' && action !== 'ignore'),
  };
}

function previewCss(state: GestureState, width: number, height: number): string {
  if (!state.drawn || !state.live) return '';
  return cssTransform(previewBetween(state.drawn, state.live, width, height, state.yDown));
}

function copyCamera(camera: PlanCamera): PlanCamera {
  return { cx: camera.cx, cy: camera.cy, scale: camera.scale };
}

export function reduceGesture(state: GestureState, event: GestureEvent): GestureOutcome {
  if (event.type === 'down') {
    const kind = classifyPointer(event.button, event.shift, event.view, event.command);
    if (kind === 'menu') return outcome(state, 'menu', { consumed: true, cursor: state.kind === 'zoom' ? 'zoom' : 'grab' });
    if (kind === 'orbit') return outcome(state, 'orbit', { consumed: false });
    if (kind === 'passthrough') return outcome(state, 'passthrough', { consumed: false });
    const next: GestureState = {
      ...state,
      drawn: state.drawn ?? copyCamera(event.camera),
      live: state.live ?? copyCamera(event.camera),
      kind: kind === 'zoom' ? 'zoom' : 'pan',
      button: event.button,
      lastX: event.x,
      lastY: event.y,
      originX: event.x,
      originY: event.y,
      moved: false,
    };
    return outcome(next, 'preview', {
      css: previewCss(next, event.width, event.height),
      cursor: next.kind === 'zoom' ? 'zoom' : 'grabbing',
      consumed: true,
      interruptsCommand: false,
    });
  }

  if (event.type === 'move') {
    if (state.kind === 'none' || !state.live) return outcome(state, 'ignore', { consumed: false });
    const dx = event.x - state.lastX;
    const dy = event.y - state.lastY;
    let live = state.live;
    if (state.kind === 'pan') live = panBy(live, dx, dy, state.yDown);
    else {
      const factor = Math.exp(-dy * 0.012);
      live = zoomAt(live, event.width / 2, event.height / 2, event.width, event.height, factor, state.yDown);
    }
    const next: GestureState = {
      ...state,
      live,
      lastX: event.x,
      lastY: event.y,
      moved: state.moved || Math.hypot(event.x - state.originX, event.y - state.originY) > 2,
    };
    return outcome(next, 'preview', {
      css: previewCss(next, event.width, event.height),
      cursor: next.kind === 'zoom' ? 'zoom' : 'grabbing',
      consumed: true,
    });
  }

  if (event.type === 'wheel') {
    const ratio = wheelZoomRatio(event.deltaY, event.zoomFactor);
    const drawn = state.drawn ?? copyCamera(event.camera);
    const base = state.live ?? drawn;
    const live = zoomAt(base, event.x, event.y, event.width, event.height, ratio, state.yDown);
    const next: GestureState = { ...state, drawn, live };
    return outcome(next, 'preview', {
      css: previewCss(next, event.width, event.height),
      cursor: state.kind === 'pan' ? 'grabbing' : state.kind === 'zoom' ? 'zoom' : null,
      consumed: true,
      interruptsCommand: false,
    });
  }

  if (event.type === 'commit') {
    if (!state.live || !state.drawn || state.kind !== 'none') return outcome(state, 'ignore', { consumed: false });
    const camera = copyCamera(state.live);
    const next = createGesture(state.yDown);
    return outcome(next, 'commit', { camera, consumed: true });
  }

  const dragging = state.kind !== 'none';
  const button = event.button;
  const moved = state.moved;
  const doubleMiddle = button === 1 && !moved && event.time - state.lastMiddleMs < 400 && event.time - state.lastMiddleMs > 0;
  if (doubleMiddle) {
    const next = createGesture(state.yDown);
    return outcome(next, 'extents', { consumed: true, interruptsCommand: false });
  }
  if (dragging && moved && state.live) {
    const camera = copyCamera(state.live);
    const next = createGesture(state.yDown);
    next.lastMiddleMs = button === 1 ? event.time : state.lastMiddleMs;
    return outcome(next, 'commit', { camera, consumed: true, interruptsCommand: false });
  }
  const next: GestureState = {
    ...state,
    kind: 'none',
    button: -1,
    moved: false,
    lastMiddleMs: button === 1 && !moved ? event.time : state.lastMiddleMs,
  };
  if (!dragging && !state.drawn) return outcome(next, 'ignore', { consumed: false });
  if (button === 1) return outcome(next, 'ignore', { consumed: true });
  return outcome(next, 'ignore', { consumed: false, css: previewCss(next, event.width, event.height) });
}

/** World point under the cursor stays fixed. Used by the wheel tests. */
export function worldAt(camera: PlanCamera, x: number, y: number, width: number, height: number, yDown = false) {
  if (!yDown) return screenToWorld(camera, x, y, width, height);
  return {
    x: camera.cx + (x - width / 2) / camera.scale,
    y: camera.cy + (y - height / 2) / camera.scale,
  };
}
