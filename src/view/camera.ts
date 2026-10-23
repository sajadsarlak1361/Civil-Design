import type { Bounds, Vec2 } from '../engine';

export interface PlanCamera {
  cx: number;
  cy: number;
  /** CSS pixels per world unit. */
  scale: number;
}

export function worldToScreen(camera: PlanCamera, x: number, y: number, width: number, height: number): Vec2 {
  return {
    x: (x - camera.cx) * camera.scale + width / 2,
    y: (camera.cy - y) * camera.scale + height / 2,
  };
}

export function screenToWorld(camera: PlanCamera, x: number, y: number, width: number, height: number): Vec2 {
  return {
    x: camera.cx + (x - width / 2) / camera.scale,
    y: camera.cy - (y - height / 2) / camera.scale,
  };
}

export function fitCamera(bounds: Bounds, width: number, height: number, pad = 0.1): PlanCamera {
  const dx = Math.max(bounds.maxX - bounds.minX, 1);
  const dy = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min((width * (1 - pad * 2)) / dx, (height * (1 - pad * 2)) / dy);
  return {
    cx: (bounds.minX + bounds.maxX) / 2,
    cy: (bounds.minY + bounds.maxY) / 2,
    scale: Math.min(8000, Math.max(0.002, scale)),
  };
}

export function screenToWorldDown(camera: PlanCamera, x: number, y: number, width: number, height: number): Vec2 {
  return {
    x: camera.cx + (x - width / 2) / camera.scale,
    y: camera.cy + (y - height / 2) / camera.scale,
  };
}

export function zoomAt(camera: PlanCamera, screenX: number, screenY: number, width: number, height: number, factor: number, yDown = false): PlanCamera {
  const world = yDown ? screenToWorldDown(camera, screenX, screenY, width, height) : screenToWorld(camera, screenX, screenY, width, height);
  const scale = Math.min(8000, Math.max(0.002, camera.scale * factor));
  return {
    scale,
    cx: world.x - (screenX - width / 2) / scale,
    cy: yDown ? world.y - (screenY - height / 2) / scale : world.y + (screenY - height / 2) / scale,
  };
}

export function panBy(camera: PlanCamera, dx: number, dy: number, yDown = false): PlanCamera {
  return {
    ...camera,
    cx: camera.cx - dx / camera.scale,
    cy: yDown ? camera.cy - dy / camera.scale : camera.cy + dy / camera.scale,
  };
}

/** A 1/2/5 step at or just under the requested world size. */
export function niceStep(worldTarget: number): number {
  if (!(worldTarget > 0) || !Number.isFinite(worldTarget)) return 1;
  const pow = 10 ** Math.floor(Math.log10(worldTarget));
  const mantissa = worldTarget / pow;
  const nice = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
  return nice * pow;
}
