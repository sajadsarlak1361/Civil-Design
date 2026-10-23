import { describe, expect, it } from 'vitest';
import { drawingBounds, emptyDrawing } from '../drafting';
import { parseDxf } from './dxfDoc';
import { parseDxfParts } from './dxfStream';

const contour = `0
SECTION
2
ENTITIES
0
POLYLINE
8
INDEX_CONTOUR
66
1
38
450
62
4
0
VERTEX
8
INDEX_CONTOUR
10
10
20
20
38
450
0
VERTEX
8
INDEX_CONTOUR
10
30
20
20
0
SEQEND
8
INDEX_CONTOUR
0
LINE
8
Road
10
0
20
0
30
0
11
5
21
0
31
0
0
TEXT
8
Road
10
1
20
2
30
0
40
2.5
1
STA
0
EOF
`;

describe('large DXF stream', () => {
  it('reads a polyline, a line, and text without building a group list', () => {
    const bytes = new TextEncoder().encode(contour);
    const model = parseDxf(bytes, { bulkBytes: 1 });
    expect(model.bulk?.entityCount).toBe(3);
    expect(model.bulk?.segmentCount).toBe(2);
    expect(model.bulk?.segments[0]).toBe(10);
    expect(model.bulk?.segments[1]).toBe(20);
    expect(model.bulk?.segments[2]).toBe(30);
    expect(model.bulk?.segments[4]).toBe(0);
    expect(model.bulk?.segments[6]).toBe(5);
    expect(model.entities.map((entity) => entity.type)).toEqual(['text']);
    expect(model.entities[0]).toMatchObject({ content: 'STA', height: 2.5 });
    expect(model.layers).toEqual(expect.arrayContaining(['INDEX_CONTOUR', 'Road']));
    expect(model.bulk).toMatchObject({ minX: 0, minY: 0, maxX: 30, maxY: 20, truncated: false });
  });

  it('accepts group pairs split across chunks', async () => {
    const bytes = new TextEncoder().encode(contour);
    const model = await parseDxfParts(bytes.byteLength, async (offset, length) => bytes.subarray(offset, offset + Math.min(length, 7)));
    expect(model.bulk?.entityCount).toBe(3);
    expect(model.bulk?.segmentCount).toBe(2);
    expect(model.entities[0]).toMatchObject({ content: 'STA' });
  });

  it('keeps the first segments when the drawing is past the cap', () => {
    const lines = ['0', 'SECTION', '2', 'ENTITIES'];
    for (let index = 0; index < 3; index += 1) {
      lines.push('0', 'LINE', '8', 'Road', '10', String(index), '20', '0', '30', '0', '11', String(index + 1), '21', '1', '31', '0');
    }
    lines.push('0', 'ENDSEC', '0', 'EOF', '');
    const model = parseDxf(new TextEncoder().encode(lines.join('\n')), { bulkBytes: 1, maxSegments: 1 });
    expect(model.bulk?.segmentCount).toBe(1);
    expect(model.bulk?.entityCount).toBe(3);
    expect(model.bulk?.truncated).toBe(true);
  });

  it('includes packed geometry in the drawing extents', () => {
    const doc = emptyDrawing();
    doc.bulk = {
      segments: Float64Array.of(10, 20, 30, 40),
      points: new Float64Array(0),
      segmentCount: 1,
      pointCount: 0,
      entityCount: 1,
      minX: 10,
      minY: 20,
      maxX: 30,
      maxY: 40,
      truncated: false,
    };
    expect(drawingBounds(doc)).toMatchObject({ minX: 10, minY: 20, maxX: 30, maxY: 40 });
  });
});
