/** Screen-space 3D navigation. Camera and target move together; meshes stay put. */

export type Vec3 = readonly [number, number, number];

export interface Pose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
}

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

export interface ViewBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(a: Vec3, scale: number): Vec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 {
  const span = length(a);
  if (span < 1e-12) return [0, 0, 1];
  return [a[0] / span, a[1] / span, a[2] / span];
}

export function viewBasis(pose: Pose): ViewBasis {
  const forward = normalize(sub(pose.target, pose.position));
  let right = cross(forward, pose.up);
  if (length(right) < 1e-6) {
    const fallback: Vec3 = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    right = cross(forward, fallback);
  }
  right = normalize(right);
  const up = normalize(cross(right, forward));
  return { forward, right, up };
}

/** Ray through a pixel. `orthoHeight` is the world half-height of an orthographic view; 0 means perspective. */
export function rayFromPixel(
  pose: Pose,
  fovDeg: number,
  aspect: number,
  x: number,
  y: number,
  width: number,
  height: number,
  orthoHeight = 0,
): Ray {
  const { forward, right, up } = viewBasis(pose);
  const nx = (x / Math.max(width, 1)) * 2 - 1;
  const ny = -((y / Math.max(height, 1)) * 2 - 1);
  if (orthoHeight > 0) {
    const origin = add(add(pose.position, mul(right, nx * orthoHeight * aspect)), mul(up, ny * orthoHeight));
    return { origin, dir: forward };
  }
  const tanY = Math.tan((fovDeg * Math.PI) / 360);
  const tanX = tanY * Math.max(aspect, 1e-6);
  const dir = normalize(add(add(mul(right, nx * tanX), mul(up, ny * tanY)), forward));
  return { origin: pose.position, dir };
}

/** Distance from the camera to `point` along the view direction. */
export function viewDepth(pose: Pose, point: Vec3): number {
  return dot(sub(point, pose.position), viewBasis(pose).forward);
}

export function targetDepth(pose: Pose): number {
  return Math.max(length(sub(pose.target, pose.position)), 0.05);
}

/** Point on the ray where the view-direction depth equals `depth`. */
export function pointAtDepth(pose: Pose, ray: Ray, depth: number): Vec3 {
  const { forward } = viewBasis(pose);
  const denom = dot(ray.dir, forward);
  const travel = Math.abs(denom) > 1e-8 ? depth / denom : depth;
  return add(ray.origin, mul(ray.dir, Math.max(travel, 1e-4)));
}

function hitViewPlane(pose: Pose, point: Vec3, ray: Ray): Vec3 | null {
  const { forward } = viewBasis(pose);
  const denom = dot(ray.dir, forward);
  if (Math.abs(denom) < 1e-8) return null;
  const travel = dot(sub(point, ray.origin), forward) / denom;
  if (travel < 0) return null;
  return add(ray.origin, mul(ray.dir, travel));
}

/**
 * Translate the camera and the orbit target by the same vector, parallel to the
 * view plane, so `grabbed` stays under the cursor. A closer grab moves less.
 */
export function panGrab(pose: Pose, grabbed: Vec3, ray: Ray): Pose {
  const landed = hitViewPlane(pose, grabbed, ray);
  if (!landed) return pose;
  const delta = sub(grabbed, landed);
  return { position: add(pose.position, delta), target: add(pose.target, delta), up: pose.up };
}

/** Scale the rig about `focus`. Ratio above 1 moves the camera closer. The view direction stays put. */
export function zoomToward(pose: Pose, focus: Vec3, ratio: number): Pose {
  if (!(ratio > 0) || Math.abs(ratio - 1) < 1e-9) return pose;
  const pull = (point: Vec3): Vec3 => add(focus, mul(sub(point, focus), 1 / ratio));
  return { position: pull(pose.position), target: pull(pose.target), up: pose.up };
}

function rotateAround(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const unit = normalize(axis);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return add(add(mul(vector, cos), mul(cross(unit, vector), sin)), mul(unit, dot(unit, vector) * (1 - cos)));
}

/** Constrained orbit around the target. World Y stays up. Target and radius stay put. */
export function orbitConstrained(
  pose: Pose,
  dx: number,
  dy: number,
  height: number,
  limits: { minPolar: number; maxPolar: number } = { minPolar: 0.08, maxPolar: Math.PI - 0.08 },
): Pose {
  const offset = sub(pose.position, pose.target);
  const radius = Math.max(length(offset), 1e-4);
  let theta = Math.atan2(offset[0], offset[2]);
  let phi = Math.acos(Math.max(-1, Math.min(1, offset[1] / radius)));
  const speed = (2 * Math.PI) / Math.max(height, 1);
  theta -= dx * speed;
  phi = Math.max(limits.minPolar, Math.min(limits.maxPolar, phi - dy * speed));
  const position: Vec3 = [
    pose.target[0] + radius * Math.sin(phi) * Math.sin(theta),
    pose.target[1] + radius * Math.cos(phi),
    pose.target[2] + radius * Math.sin(phi) * Math.cos(theta),
  ];
  return { position, target: pose.target, up: [0, 1, 0] };
}

/** Free orbit. The camera tumbles about the target and its up vector follows. */
export function orbitFree(pose: Pose, dx: number, dy: number, height: number): Pose {
  const { right, up } = viewBasis(pose);
  const speed = (2 * Math.PI) / Math.max(height, 1);
  let offset = sub(pose.position, pose.target);
  offset = rotateAround(offset, up, -dx * speed);
  offset = rotateAround(offset, right, -dy * speed);
  let nextUp = rotateAround(pose.up, up, -dx * speed);
  nextUp = rotateAround(nextUp, right, -dy * speed);
  return { position: add(pose.target, offset), target: pose.target, up: normalize(nextUp) };
}

/** Project a world point back to pixels. Tests use this to prove the grab sticks. */
export function projectPoint(
  pose: Pose,
  fovDeg: number,
  aspect: number,
  point: Vec3,
  width: number,
  height: number,
  orthoHeight = 0,
): { x: number; y: number } | null {
  const { forward, right, up } = viewBasis(pose);
  const relative = sub(point, pose.position);
  const ahead = dot(relative, forward);
  if (ahead <= 1e-6) return null;
  if (orthoHeight > 0) {
    const nx = dot(relative, right) / (orthoHeight * aspect);
    const ny = dot(relative, up) / orthoHeight;
    return { x: ((nx + 1) * 0.5) * width, y: ((1 - ny) * 0.5) * height };
  }
  const tanY = Math.tan((fovDeg * Math.PI) / 360);
  const tanX = tanY * Math.max(aspect, 1e-6);
  const nx = dot(relative, right) / (ahead * tanX);
  const ny = dot(relative, up) / (ahead * tanY);
  return { x: ((nx + 1) * 0.5) * width, y: ((1 - ny) * 0.5) * height };
}
