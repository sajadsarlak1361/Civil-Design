import { describe, expect, it } from 'vitest';
import type { PlanCamera } from './camera';
import { classifyPointer, createGesture, cssTransform, previewBetween, REALTIME_NAV_PROMPT, reduceGesture, wheelDeltaY, wheelNotches, wheelZoomRatio, worldAt } from './navigate';

const camera: PlanCamera = { cx: 10, cy: 20, scale: 2 };
const size = { width: 200, height: 100 };

function down(partial: Partial<Extract<Parameters<typeof reduceGesture>[1], { type: 'down' }>> = {}) {
  return reduceGesture(createGesture(), {
    type: 'down',
    x: 40,
    y: 30,
    button: 0,
    shift: false,
    view: '2d',
    command: 'pan',
    time: 0,
    camera,
    width: size.width,
    height: size.height,
    ...partial,
  });
}

describe('navigation state machine', () => {
  it('pans in real time by a view transform and commits the camera once', () => {
    const start = down();
    expect(start.action).toBe('preview');
    expect(start.camera).toBeNull();
    expect(start.cursor).toBe('grabbing');
    expect(start.interruptsCommand).toBe(false);
    const moved = reduceGesture(start.state, { type: 'move', x: 70, y: 30, width: size.width, height: size.height });
    expect(moved.action).toBe('preview');
    expect(moved.camera).toBeNull();
    expect(moved.css).toContain('translate');
    expect(moved.state.live?.scale).toBe(camera.scale);
    expect(moved.state.drawn).toEqual(camera);
    const end = reduceGesture(moved.state, { type: 'up', x: 70, y: 30, button: 0, time: 40, width: size.width, height: size.height });
    expect(end.action).toBe('commit');
    expect(end.camera?.cx).toBeCloseTo(camera.cx - 30 / camera.scale);
    expect(end.camera?.cy).toBeCloseTo(camera.cy);
    expect(end.state.kind).toBe('none');
  });

  it('uses a hand cursor for PAN and does not rebuild while the button is down', () => {
    const start = down();
    expect(start.cursor).toBe('grabbing');
    expect(REALTIME_NAV_PROMPT).toBe('Press ESC or ENTER to exit, or right-click to display shortcut menu.');
    const moved = reduceGesture(start.state, { type: 'move', x: 48, y: 36, width: size.width, height: size.height });
    expect(moved.action).toBe('preview');
    expect(cssTransform(previewBetween(camera, moved.state.live!, size.width, size.height))).toBe(moved.css);
  });

  it('opens the shortcut menu on right-click during PAN', () => {
    const menu = down({ button: 2, x: 12, y: 18 });
    expect(menu.action).toBe('menu');
    expect(menu.consumed).toBe(true);
  });

  it('reads a desktop wheelDelta when deltaY is zero', () => {
    expect(wheelDeltaY({ deltaY: 0, wheelDelta: 120 })).toBe(-120);
    expect(wheelZoomRatio(wheelDeltaY({ deltaY: 0, wheelDelta: 120 }))).toBeGreaterThan(1);
    expect(wheelDeltaY({ deltaY: 1, deltaMode: 1 })).toBe(40);
    expect(wheelNotches(wheelDeltaY({ deltaY: 1, deltaMode: 1 }))).toBe(1);
    expect(wheelDeltaY({ deltaY: 0 })).toBe(0);
  });

  it('zooms the wheel about the cursor with ZOOMFACTOR and leaves the command alone', () => {
    expect(wheelZoomRatio(100, 60)).toBeCloseTo(1 / 1.6);
    expect(wheelZoomRatio(-100, 60)).toBeCloseTo(1.6);
    const wheeled = reduceGesture(createGesture(), {
      type: 'wheel',
      x: 150,
      y: 40,
      deltaY: -100,
      width: size.width,
      height: size.height,
      camera,
      zoomFactor: 60,
    });
    expect(wheeled.action).toBe('preview');
    expect(wheeled.camera).toBeNull();
    expect(wheeled.interruptsCommand).toBe(false);
    const before = worldAt(camera, 150, 40, size.width, size.height);
    const after = worldAt(wheeled.state.live!, 150, 40, size.width, size.height);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(wheeled.state.live?.scale).toBeCloseTo(camera.scale * 1.6);
    const committed = reduceGesture({ ...wheeled.state, kind: 'none' }, { type: 'commit', width: size.width, height: size.height });
    expect(committed.action).toBe('commit');
    expect(committed.camera?.scale).toBeCloseTo(camera.scale * 1.6);
  });

  it('treats middle-drag as a transparent pan and a double middle click as extents', () => {
    const start = down({ button: 1, command: 'busy', time: 1000 });
    expect(start.action).toBe('preview');
    expect(start.interruptsCommand).toBe(false);
    expect(classifyPointer(1, false, '2d', 'busy')).toBe('pan');
    const moved = reduceGesture(start.state, { type: 'move', x: 80, y: 50, width: size.width, height: size.height });
    const end = reduceGesture(moved.state, { type: 'up', x: 80, y: 50, button: 1, time: 1100, width: size.width, height: size.height });
    expect(end.action).toBe('commit');
    expect(end.interruptsCommand).toBe(false);

    const first = down({ button: 1, time: 0 });
    const up = reduceGesture(first.state, { type: 'up', x: 40, y: 30, button: 1, time: 20, width: size.width, height: size.height });
    expect(up.action).not.toBe('extents');
    const second = reduceGesture(up.state, {
      type: 'down',
      x: 40,
      y: 30,
      button: 1,
      shift: false,
      view: '2d',
      command: 'busy',
      time: 200,
      camera,
      width: size.width,
      height: size.height,
    });
    const zoom = reduceGesture(second.state, { type: 'up', x: 41, y: 30, button: 1, time: 220, width: size.width, height: size.height });
    expect(zoom.action).toBe('extents');
    expect(zoom.interruptsCommand).toBe(false);
  });

  it('orbits in 3D only for Shift+middle and pans for middle', () => {
    expect(classifyPointer(1, false, '3d', 'idle')).toBe('pan');
    expect(classifyPointer(1, true, '3d', 'busy')).toBe('orbit');
    expect(classifyPointer(0, false, '3d', 'idle')).toBe('orbit');
    expect(classifyPointer(0, false, '3d', 'pan')).toBe('pan');
    expect(classifyPointer(0, false, '2d', 'busy')).toBe('passthrough');
    const orbit = down({ button: 1, shift: true, view: '3d' });
    expect(orbit.action).toBe('orbit');
    expect(orbit.consumed).toBe(false);
  });
});
