import { describe, expect, it } from 'vitest';
import { solveAlignment } from './alignment';
import { nearestBySamples, profileViewEntities, sectionViewEntities } from './placedView';

function ids() {
  let n = 0;
  return () => `e${++n}`;
}

describe('placed profile and section views', () => {
  const solved = solveAlignment([
    { x: 0, y: 0, radius: 0 },
    { x: 100, y: 0, radius: 0 },
  ]);

  it('anchors the profile frame on the supplied point', () => {
    const entities = profileViewEntities(
      {
        name: 'Main',
        unit: 'm',
        startStation: 0,
        solved,
        profiles: [
          {
            name: 'EG',
            color: '#7eb6ff',
            vertices: [
              { station: 0, elevation: 10 },
              { station: 50, elevation: 12 },
              { station: 100, elevation: 11 },
            ],
          },
        ],
        design: [],
        superimposed: null,
        sheetLength: null,
        sheetOverlap: 0,
        bands: false,
      },
      { x: 500, y: -20 },
      ids(),
    );
    expect(entities).not.toBeNull();
    const frame = entities?.find((entity) => entity.type === 'polyline' && entity.closed);
    expect(frame?.type).toBe('polyline');
    if (frame?.type !== 'polyline') return;
    const xs = frame.vertices.map((vertex) => vertex.x);
    const ys = frame.vertices.map((vertex) => vertex.y);
    expect(Math.min(...xs)).toBeCloseTo(500);
    expect(Math.min(...ys)).toBeCloseTo(-20);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100);
  });

  it('lays section views out from the click instead of a fixed model offset', () => {
    const entities = sectionViewEntities(
      {
        unit: 'm',
        layout: 'multiple',
        index: 0,
        sections: [0, 1].map((station) => ({
          station: station * 20,
          surfaces: [
            {
              name: 'EG',
              color: '#7eb6ff',
              samples: [
                { offset: -10, elevation: 5 },
                { offset: 0, elevation: 6 },
                { offset: 10, elevation: 5 },
              ],
            },
          ],
        })),
      },
      { x: 20, y: 40 },
      ids(),
    );
    expect(entities).not.toBeNull();
    const frames = entities?.filter((entity) => entity.type === 'polyline' && entity.closed) ?? [];
    expect(frames).toHaveLength(2);
    const lefts = frames.map((frame) => (frame.type === 'polyline' ? Math.min(...frame.vertices.map((vertex) => vertex.x)) : 0));
    expect(Math.min(...lefts)).toBeCloseTo(20);
    expect(Math.max(...lefts)).toBeGreaterThan(20);
  });

  it('returns nothing when the graph has no elevations', () => {
    expect(
      profileViewEntities(
        {
          name: 'Main',
          unit: 'm',
          startStation: 0,
          solved,
          profiles: [{ name: 'EG', color: '#7eb6ff', vertices: [{ station: 0, elevation: null }] }],
          design: [],
          superimposed: null,
          sheetLength: null,
          sheetOverlap: 0,
          bands: false,
        },
        { x: 0, y: 0 },
        ids(),
      ),
    ).toBeNull();
  });

  it('picks the alignment closest to the click', () => {
    const id = nearestBySamples(
      [
        { id: 'far', samples: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
        { id: 'near', samples: [{ x: 100, y: 50 }, { x: 110, y: 50 }] },
      ],
      { x: 104, y: 51 },
    );
    expect(id).toBe('near');
  });
});
