import type { SurveyPoint, Triangle, Vec2 } from './types';

/** Flat bounding-volume hierarchy over triangles, stored in typed arrays. */
export interface BvhPacked {
  minX: Float64Array;
  minY: Float64Array;
  maxX: Float64Array;
  maxY: Float64Array;
  left: Int32Array;
  right: Int32Array;
  tri: Int32Array;
  count: number;
}

export class TriangleBvh {
  private minX: Float64Array;
  private minY: Float64Array;
  private maxX: Float64Array;
  private maxY: Float64Array;
  private left: Int32Array;
  private right: Int32Array;
  private tri: Int32Array;
  private count = 0;

  constructor(points: Vec2[], triangles: Triangle[]) {
    const n = Math.max(triangles.length, 1);
    const capacity = n * 2 + 4;
    this.minX = new Float64Array(capacity);
    this.minY = new Float64Array(capacity);
    this.maxX = new Float64Array(capacity);
    this.maxY = new Float64Array(capacity);
    this.left = new Int32Array(capacity);
    this.right = new Int32Array(capacity);
    this.tri = new Int32Array(capacity);
    this.left.fill(-1);
    this.right.fill(-1);
    this.tri.fill(-1);
    if (triangles.length === 0) return;
    const order = new Int32Array(triangles.length);
    const cx = new Float64Array(triangles.length);
    const cy = new Float64Array(triangles.length);
    const tMinX = new Float64Array(triangles.length);
    const tMinY = new Float64Array(triangles.length);
    const tMaxX = new Float64Array(triangles.length);
    const tMaxY = new Float64Array(triangles.length);
    for (let i = 0; i < triangles.length; i++) {
      order[i] = i;
      const [ia, ib, ic] = triangles[i];
      const a = points[ia];
      const b = points[ib];
      const c = points[ic];
      tMinX[i] = Math.min(a.x, b.x, c.x);
      tMinY[i] = Math.min(a.y, b.y, c.y);
      tMaxX[i] = Math.max(a.x, b.x, c.x);
      tMaxY[i] = Math.max(a.y, b.y, c.y);
      cx[i] = (tMinX[i] + tMaxX[i]) * 0.5;
      cy[i] = (tMinY[i] + tMaxY[i]) * 0.5;
    }
    this.build(order, 0, order.length, cx, cy, tMinX, tMinY, tMaxX, tMaxY);
  }

  candidatesAt(x: number, y: number): number[] {
    const out: number[] = [];
    if (this.count === 0) return out;
    const stack = [0];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (x < this.minX[node] || x > this.maxX[node] || y < this.minY[node] || y > this.maxY[node]) continue;
      const leaf = this.tri[node];
      if (leaf >= 0) {
        out.push(leaf);
        continue;
      }
      const right = this.right[node];
      const left = this.left[node];
      if (right >= 0) stack.push(right);
      if (left >= 0) stack.push(left);
    }
    return out;
  }

  pack(): BvhPacked {
    return {
      minX: this.minX,
      minY: this.minY,
      maxX: this.maxX,
      maxY: this.maxY,
      left: this.left,
      right: this.right,
      tri: this.tri,
      count: this.count,
    };
  }

  static unpack(packed: BvhPacked): TriangleBvh {
    const bvh = new TriangleBvh([], []);
    bvh.minX = packed.minX;
    bvh.minY = packed.minY;
    bvh.maxX = packed.maxX;
    bvh.maxY = packed.maxY;
    bvh.left = packed.left;
    bvh.right = packed.right;
    bvh.tri = packed.tri;
    bvh.count = packed.count;
    return bvh;
  }

  private build(
    order: Int32Array,
    start: number,
    end: number,
    cx: Float64Array,
    cy: Float64Array,
    tMinX: Float64Array,
    tMinY: Float64Array,
    tMaxX: Float64Array,
    tMaxY: Float64Array,
  ): number {
    const node = this.count++;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = start; i < end; i++) {
      const tri = order[i];
      if (tMinX[tri] < minX) minX = tMinX[tri];
      if (tMinY[tri] < minY) minY = tMinY[tri];
      if (tMaxX[tri] > maxX) maxX = tMaxX[tri];
      if (tMaxY[tri] > maxY) maxY = tMaxY[tri];
    }
    const pad = Math.max(maxX - minX, maxY - minY, 1) * 1e-9;
    this.minX[node] = minX - pad;
    this.minY[node] = minY - pad;
    this.maxX[node] = maxX + pad;
    this.maxY[node] = maxY + pad;
    if (end - start === 1) {
      this.tri[node] = order[start];
      return node;
    }
    const axis = maxX - minX >= maxY - minY ? 0 : 1;
    const mid = (start + end) >> 1;
    quickselect(order, start, end, mid, axis === 0 ? cx : cy);
    this.left[node] = this.build(order, start, mid, cx, cy, tMinX, tMinY, tMaxX, tMaxY);
    this.right[node] = this.build(order, mid, end, cx, cy, tMinX, tMinY, tMaxX, tMaxY);
    return node;
  }
}

/** Place the median at `k` so the two sides of a BVH split stay balanced. */
function quickselect(order: Int32Array, start: number, end: number, k: number, values: Float64Array): void {
  let lo = start;
  let hi = end;
  while (hi - lo > 1) {
    const pivot = values[order[lo + ((hi - lo) >> 1)]];
    let i = lo;
    let j = hi - 1;
    while (i <= j) {
      while (values[order[i]] < pivot) i++;
      while (values[order[j]] > pivot) j--;
      if (i <= j) {
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j + 1;
    else if (k >= i) lo = i;
    else return;
  }
}

const cache = new WeakMap<Triangle[], TriangleBvh>();

export function bvhFor(points: SurveyPoint[], triangles: Triangle[]): TriangleBvh {
  const hit = cache.get(triangles);
  if (hit) return hit;
  const built = new TriangleBvh(points, triangles);
  cache.set(triangles, built);
  return built;
}

/** Install a BVH that was built off the main thread for this triangle array. */
export function rememberBvh(triangles: Triangle[], bvh: TriangleBvh): void {
  cache.set(triangles, bvh);
}

export function hasBvh(triangles: Triangle[]): boolean {
  return cache.has(triangles);
}

export function packBvh(bvh: TriangleBvh): BvhPacked {
  return bvh.pack();
}

export function unpackBvh(packed: BvhPacked): TriangleBvh {
  return TriangleBvh.unpack(packed);
}
