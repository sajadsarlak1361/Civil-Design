import { describe, expect, it } from 'vitest';
import { v3 } from '../engine/drafting';
import { applyGrip, scaleFactorFromReference, stepGripScale } from './grips';

describe('grip scale reference', () => {
  it('divides the new length by the reference length', () => {
    expect(scaleFactorFromReference(4, 10)).toBeCloseTo(2.5);
    const asked = stepGripScale('run', 0, 'reference', 0);
    expect(asked.phase).toBe('ref');
    const armed = stepGripScale(asked.phase, asked.reference, 'length', 4);
    expect(armed.phase).toBe('new');
    expect(armed.reference).toBe(4);
    const done = stepGripScale(armed.phase, armed.reference, 'length', 10);
    expect(done.factor).toBeCloseTo(2.5);
    const typed = stepGripScale('run', 0, 'factor', 2);
    expect(typed.factor).toBe(2);
  });

  it('scales from the base by a factor, and a click still uses the cursor distance', () => {
    const line = { id: 'e1', type: 'line' as const, layer: '0', color: 'bylayer', a: v3(0, 0), b: v3(10, 0) };
    const byFactor = applyGrip(line, 1, 'scale', v3(0, 0), v3(0, 0), 2);
    expect(byFactor.type).toBe('line');
    if (byFactor.type === 'line') expect(byFactor.b.x).toBeCloseTo(20);
    const byCursor = applyGrip(line, 1, 'scale', v3(0, 0), v3(3, 4));
    expect(byCursor.type).toBe('line');
    if (byCursor.type === 'line') expect(byCursor.b.x).toBeCloseTo(50);
  });
});
