import { clickWorld, navigationMode } from '../commands/runtime';
import { screenToWorld, screenToWorldDown, type PlanCamera } from './camera';
import { setNavDrag } from './navUi';
import { createGesture, reduceGesture, wheelDeltaY, type GestureOutcome, type NavCommand } from './navigate';

export function paintGesture(canvas: HTMLCanvasElement, outcome: GestureOutcome, commit: (camera: PlanCamera) => void): void {
  if (outcome.action === 'preview') {
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = outcome.css;
    setNavDrag(outcome.cursor === 'zoom' ? 'zoom' : 'pan');
    canvas.style.cursor = 'none';
    return;
  }
  if ((outcome.action === 'commit' && outcome.camera) || outcome.action === 'extents') {
    canvas.style.transform = '';
    setNavDrag(null);
    if (outcome.camera) commit(outcome.camera);
  }
}

export function attachSheetGestures(
  canvas: HTMLCanvasElement,
  options: {
    yDown?: boolean;
    getCamera: () => PlanCamera;
    setCamera: (camera: PlanCamera) => void;
    redraw: () => void;
    zoomExtents: () => void;
  },
): () => void {
  let gesture = createGesture(Boolean(options.yDown));
  const commandOf = (): NavCommand => {
    const nav = navigationMode();
    if (nav === 'pan') return 'pan';
    if (nav === 'zoom') return 'zoom';
    return 'idle';
  };
  const commit = (next: PlanCamera) => {
    options.setCamera(next);
    canvas.style.transform = '';
    options.redraw();
    const nav = navigationMode();
    canvas.style.cursor = nav === 'pan' || nav === 'zoom' ? 'none' : '';
  };
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height };
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 1) event.preventDefault();
    const point = local(event);
    const result = reduceGesture(gesture, {
      type: 'down',
      x: point.x,
      y: point.y,
      button: event.button,
      shift: event.shiftKey,
      view: '2d',
      command: commandOf(),
      time: event.timeStamp,
      camera: options.getCamera(),
      width: point.width,
      height: point.height,
    });
    gesture = result.state;
    if (result.action === 'menu') {
      event.preventDefault();
      const menuEvent = new CustomEvent('fieldline-nav-menu', { detail: { x: event.clientX, y: event.clientY } });
      window.dispatchEvent(menuEvent);
      return;
    }
    if (result.action === 'preview') {
      paintGesture(canvas, result, commit);
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // The button was already released, or this webview rejected capture.
      }
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (gesture.kind === 'none') return;
    const point = local(event);
    const result = reduceGesture(gesture, { type: 'move', x: point.x, y: point.y, width: point.width, height: point.height });
    gesture = result.state;
    paintGesture(canvas, result, commit);
  };
  const onPointerUp = (event: PointerEvent) => {
    const point = local(event);
    if (gesture.kind !== 'none' || event.button === 1) {
      const result = reduceGesture(gesture, {
        type: 'up',
        x: point.x,
        y: point.y,
        button: event.button,
        time: event.timeStamp,
        width: point.width,
        height: point.height,
      });
      gesture = result.state;
      paintGesture(canvas, result, commit);
      if (result.action === 'extents') options.zoomExtents();
      if (result.consumed) return;
    }
    if (event.button === 0 && navigationMode() === 'window') {
      const world = options.yDown
        ? screenToWorldDown(options.getCamera(), point.x, point.y, point.width, point.height)
        : screenToWorld(options.getCamera(), point.x, point.y, point.width, point.height);
      clickWorld({ x: world.x, y: world.y, z: 0 });
    }
  };
  const onWheel = (event: WheelEvent) => {
    const deltaY = wheelDeltaY(event);
    if (!deltaY) return;
    event.preventDefault();
    const point = local(event);
    const result = reduceGesture(gesture, {
      type: 'wheel',
      x: point.x,
      y: point.y,
      deltaY,
      width: point.width,
      height: point.height,
      camera: options.getCamera(),
    });
    gesture = result.state;
    const committed = reduceGesture(gesture, { type: 'commit', width: point.width, height: point.height });
    gesture = committed.state;
    paintGesture(canvas, committed, commit);
  };
  const onMouseDown = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
  };
  const onContext = (event: Event) => event.preventDefault();
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('auxclick', onMouseDown);
  canvas.addEventListener('contextmenu', onContext);
  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('auxclick', onMouseDown);
    canvas.removeEventListener('contextmenu', onContext);
  };
}
