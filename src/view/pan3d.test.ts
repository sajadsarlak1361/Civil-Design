import { describe, expect, it } from 'vitest';
import { orbitConstrained, panGrab, projectPoint, rayFromPixel, targetDepth, viewBasis, viewDepth, zoomToward, type Pose, type Vec3 } from './pan3d';

const pose: Pose = { position: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0] };
const size = { fov: 90, aspect: 1, width: 200, height: 200 };

function rayAt(x: number, y: number, from: Pose = pose) {
  return rayFromPixel(from, size.fov, size.aspect, x, y, size.width, size.height);
}

describe('3D screen pan', () => {
  it('keeps the grabbed point under the cursor and moves the camera with the target', () => {
    const grabbed: Vec3 = [0, 0, 0];
    const next = panGrab(pose, grabbed, rayAt(150, 100));
    const delta = next.position.map((value, index) => value - pose.position[index]);
    const targetDelta = next.target.map((value, index) => value - pose.target[index]);
    expect(delta[0]).toBeCloseTo(targetDelta[0]);
    expect(delta[1]).toBeCloseTo(targetDelta[1]);
    expect(delta[2]).toBeCloseTo(targetDelta[2]);
    expect(viewBasis(next).forward[2]).toBeCloseTo(viewBasis(pose).forward[2]);
    expect(Math.abs(delta[0] * viewBasis(pose).forward[0] + delta[1] * viewBasis(pose).forward[1] + delta[2] * viewBasis(pose).forward[2])).toBeLessThan(1e-6);
    const projected = projectPoint(next, size.fov, size.aspect, grabbed, size.width, size.height);
    expect(projected?.x).toBeCloseTo(150);
    expect(projected?.y).toBeCloseTo(100);
  });

  it('pans less when the point under the cursor is closer than the orbit target', () => {
    const far = panGrab(pose, [0, 0, 0], rayAt(140, 80));
    const near = panGrab(pose, [0, 0, 6], rayAt(140, 80));
    const travel = (next: Pose) => Math.hypot(next.position[0] - pose.position[0], next.position[1] - pose.position[1], next.position[2] - pose.position[2]);
    expect(viewDepth(pose, [0, 0, 6])).toBeLessThan(targetDepth(pose));
    expect(travel(near)).toBeLessThan(travel(far));
    const stuck = projectPoint(near, size.fov, size.aspect, [0, 0, 6], size.width, size.height);
    expect(stuck?.x).toBeCloseTo(140);
    expect(stuck?.y).toBeCloseTo(80);
  });

  it('zooms toward the cursor without changing the view direction', () => {
    const focus: Vec3 = [2, 1, 0];
    const before = viewBasis(pose).forward;
    const next = zoomToward(pose, focus, 2);
    const after = viewBasis(next).forward;
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(after[2]).toBeCloseTo(before[2]);
    expect(viewDepth(next, focus)).toBeCloseTo(viewDepth(pose, focus) / 2);
    const pixel = projectPoint(pose, size.fov, size.aspect, focus, size.width, size.height);
    const stuck = projectPoint(next, size.fov, size.aspect, focus, size.width, size.height);
    expect(stuck?.x).toBeCloseTo(pixel!.x);
    expect(stuck?.y).toBeCloseTo(pixel!.y);
  });

  it('orbits around the target and leaves the radius alone', () => {
    const next = orbitConstrained(pose, 30, -10, size.height);
    expect(next.target).toEqual(pose.target);
    const before = Math.hypot(...pose.position.map((value, index) => value - pose.target[index]));
    const after = Math.hypot(...next.position.map((value, index) => value - next.target[index]));
    expect(after).toBeCloseTo(before);
    expect(next.position[0]).not.toBeCloseTo(pose.position[0]);
    expect(next.up).toEqual([0, 1, 0]);
  });
});
