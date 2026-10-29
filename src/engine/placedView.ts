import { formatStation, pointAtDistance, type SolvedAlignment } from './alignment';
import type { DrawEntity, PolyVertex } from './drafting';
import type { ProfileVertex } from './profile';
import { geometryBand, profileSheets, clipProfile } from './profileSheet';
import type { LinearUnit } from './types';

/**
 * Profile and section graphs drawn in plan space.
 * The caller supplies the insertion point from a canvas click.
 * Sheet spacing is a fraction of that graph, measured from the click.
 */
export interface GraphSample {
  x: number;
  y: number | null;
}

export interface GraphSeries {
  name: string;
  color: string;
  samples: GraphSample[];
}

export interface PlacedGraph {
  title: string;
  series: GraphSeries[];
  /** Station labels use the project station format. Offset labels stay plain numbers. */
  axis?: 'station' | 'offset';
  showBands?: boolean;
  bandCells?: { from: number; to: number; label: string }[];
  bandValue?: string;
}

export interface ProfilePlaceInput {
  name: string;
  unit: LinearUnit;
  startStation: number;
  solved: SolvedAlignment;
  profiles: { name: string; color: string; vertices: ProfileVertex[] }[];
  design: ProfileVertex[];
  superimposed: { name: string; color: string; samples: { station: number; elevation: number }[] } | null;
  sheetLength: number | null;
  sheetOverlap: number;
  bands: boolean;
}

export interface SectionPlaceInput {
  unit: LinearUnit;
  sections: { station: number; surfaces: { name: string; color: string; samples: { offset: number; elevation: number | null }[] }[] }[];
  layout: 'single' | 'multiple';
  index: number;
}

const FRAME = '#8b95a8';
const DESIGN = '#f2d48a';

export function profileViewEntities(input: ProfilePlaceInput, origin: { x: number; y: number }, nextId: () => string, layer = 'C-PROF'): DrawEntity[] | null {
  const end = input.startStation + Math.max(input.solved.length, 0);
  const sheets =
    input.sheetLength && input.sheetLength > 1
      ? profileSheets(input.startStation, end, input.sheetLength, input.sheetOverlap)
      : [{ start: input.startStation, end }];
  const graphs = sheets.map((sheet, index) => {
    const clip = (vertices: ProfileVertex[]) => clipProfile(vertices, sheet.start, sheet.end);
    const series: GraphSeries[] = [
      ...input.profiles.map((profile) => ({ name: profile.name, color: profile.color || '#7eb6ff', samples: toSamples(clip(profile.vertices)) })),
      ...seriesFrom(clip(input.design), 'Design profile', DESIGN),
      ...(input.superimposed ? seriesFrom(clip(input.superimposed.samples), input.superimposed.name, input.superimposed.color || '#8fd0b3') : []),
    ];
    const known = input.design.filter((sample) => sample.elevation !== null && sample.station >= sheet.start && sample.station <= sheet.end);
    const mid = known[Math.floor(known.length / 2)];
    return {
      title: sheets.length > 1 ? `${input.name} ${index + 1}  ${formatStation(sheet.start, input.unit)}` : `${input.name}  ${formatStation(sheet.start, input.unit)}`,
      series,
      showBands: input.bands,
      bandCells: input.bands ? geometryBand(input.solved, input.startStation).filter((cell) => cell.to > sheet.start && cell.from < sheet.end) : [],
      bandValue: mid?.elevation != null ? mid.elevation.toFixed(2) : '',
    } satisfies PlacedGraph;
  });
  return placeGraphs(graphs, origin, nextId, layer, input.unit, graphs.length);
}

export function sectionViewEntities(input: SectionPlaceInput, origin: { x: number; y: number }, nextId: () => string, layer = 'C-SECT'): DrawEntity[] | null {
  if (input.sections.length === 0) return null;
  const shown = input.layout === 'multiple' ? input.sections : [input.sections[Math.min(Math.max(input.index, 0), input.sections.length - 1)]];
  const graphs: PlacedGraph[] = shown.map((section) => ({
    title: `Section ${formatStation(section.station, input.unit)}`,
    axis: 'offset' as const,
    series: section.surfaces.map((surface) => ({
      name: surface.name,
      color: surface.color || '#7eb6ff',
      samples: surface.samples.map((sample) => ({ x: sample.offset, y: sample.elevation })),
    })),
  }));
  return placeGraphs(graphs, origin, nextId, layer, input.unit, gridColumns(graphs.length));
}

export function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

/** Nearest candidate by sampled plan points. Used to pick an alignment from a click. */
export function nearestBySamples(candidates: { id: string; samples: { x: number; y: number }[] }[], point: { x: number; y: number }): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const candidate of candidates) {
    for (const sample of candidate.samples) {
      const d = (sample.x - point.x) ** 2 + (sample.y - point.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = candidate.id;
      }
    }
  }
  return best;
}

export function alignmentSamples(solved: SolvedAlignment, stepHint = 1): { x: number; y: number }[] {
  if (solved.length <= 0 || solved.entities.length === 0) return [];
  const step = Math.max(solved.length / 80, stepHint);
  const samples: { x: number; y: number }[] = [];
  for (let distance = 0; distance <= solved.length + 1e-6; distance += step) {
    const at = pointAtDistance(solved, Math.min(distance, solved.length));
    if (at) samples.push({ x: at.x, y: at.y });
    if (distance >= solved.length - 1e-6) break;
  }
  return samples;
}

export function placeGraphs(
  graphs: PlacedGraph[],
  origin: { x: number; y: number },
  nextId: () => string,
  layer: string,
  unit: LinearUnit,
  columns: number,
): DrawEntity[] | null {
  const frames = graphs
    .map((graph) => placeGraph(graph, { x: 0, y: 0 }, nextId, layer, unit))
    .filter((frame): frame is PlacedFrame => frame !== null);
  if (frames.length === 0) return null;
  const cellW = Math.max(...frames.map((frame) => frame.width));
  const cellH = Math.max(...frames.map((frame) => frame.height));
  const gap = Math.max(cellW, cellH) * 0.08;
  const cols = Math.max(1, Math.min(columns, frames.length));
  const entities: DrawEntity[] = [];
  frames.forEach((frame, index) => {
    const column = index % cols;
    const row = Math.floor(index / cols);
    const dx = origin.x + column * (cellW + gap);
    const dy = origin.y + row * (cellH + gap);
    for (const entity of frame.entities) entities.push(shift(entity, dx, dy));
  });
  return entities;
}

interface PlacedFrame {
  entities: DrawEntity[];
  width: number;
  height: number;
}

function placeGraph(graph: PlacedGraph, origin: { x: number; y: number }, nextId: () => string, layer: string, unit: LinearUnit): PlacedFrame | null {
  const known = graph.series.flatMap((series) => series.samples.filter((sample): sample is { x: number; y: number } => sample.y !== null && Number.isFinite(sample.y) && Number.isFinite(sample.x)));
  if (known.length < 2) return null;
  const minX = Math.min(...known.map((sample) => sample.x));
  const maxX = Math.max(...known.map((sample) => sample.x));
  const minY = Math.min(...known.map((sample) => sample.y));
  const maxY = Math.max(...known.map((sample) => sample.y));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 0.5);
  const pad = Math.max(spanY * 0.08, 0.25);
  const exaggeration = Math.min(40, Math.max(1, (spanX / spanY) * 0.45));
  const width = spanX;
  const graphHeight = (spanY + pad * 2) * exaggeration;
  const textHeight = Math.max(width, graphHeight) * 0.035;
  const bandHeight = graph.showBands ? textHeight * 5.4 : 0;
  const baseY = origin.y + bandHeight;
  const mapX = (x: number) => origin.x + (x - minX);
  const mapY = (y: number) => baseY + (y - (minY - pad)) * exaggeration;
  const entities: DrawEntity[] = [];
  entities.push(frame(nextId, layer, origin.x, baseY, width, graphHeight));
  for (const series of graph.series) {
    for (const run of runsOf(series.samples, mapX, mapY)) {
      entities.push({
        id: nextId(),
        type: 'polyline',
        layer,
        color: series.color || '#7eb6ff',
        closed: false,
        vertices: run,
      });
    }
  }
  entities.push(textAt(nextId, layer, graph.title, origin.x, baseY + graphHeight + textHeight * 0.35, textHeight, '#e7e9ee'));
  const labelX = (value: number) => (graph.axis === 'offset' ? value.toFixed(1) : formatStation(value, unit));
  entities.push(textAt(nextId, layer, labelX(minX), origin.x, baseY + textHeight * 0.15, textHeight * 0.72, FRAME));
  entities.push(textAt(nextId, layer, labelX(maxX), origin.x + width, baseY + textHeight * 0.15, textHeight * 0.72, FRAME));
  entities.push(textAt(nextId, layer, minY.toFixed(2), origin.x, mapY(minY), textHeight * 0.72, FRAME));
  if (graph.showBands) {
    const cells = graph.bandCells ?? [];
    entities.push(textAt(nextId, layer, 'Station', origin.x, origin.y + textHeight * 3.6, textHeight * 0.62, FRAME));
    entities.push(textAt(nextId, layer, graph.bandValue ? `Elevation ${graph.bandValue}` : 'Elevation', origin.x, origin.y + textHeight * 2.1, textHeight * 0.62, FRAME));
    entities.push(textAt(nextId, layer, 'Geometry', origin.x, origin.y + textHeight * 0.6, textHeight * 0.62, FRAME));
    for (const cell of cells) {
      const mid = (Math.max(cell.from, minX) + Math.min(cell.to, maxX)) / 2;
      if (!Number.isFinite(mid)) continue;
      entities.push(textAt(nextId, layer, cell.label, mapX(mid), origin.y + textHeight * 0.6, textHeight * 0.62, '#d5dbe6'));
    }
  }
  return { entities, width, height: graphHeight + bandHeight + textHeight * 1.6 };
}

function seriesFrom(vertices: { station: number; elevation: number | null }[], name: string, color: string): GraphSeries[] {
  if (vertices.length < 2) return [];
  return [{ name, color, samples: toSamples(vertices) }];
}

function toSamples(vertices: { station: number; elevation: number | null }[]): GraphSample[] {
  return vertices.map((vertex) => ({ x: vertex.station, y: vertex.elevation }));
}

function runsOf(samples: GraphSample[], mapX: (x: number) => number, mapY: (y: number) => number): PolyVertex[][] {
  const runs: PolyVertex[][] = [];
  let run: PolyVertex[] = [];
  const flush = () => {
    if (run.length > 1) runs.push(run);
    run = [];
  };
  for (const sample of samples) {
    if (sample.y === null || !Number.isFinite(sample.y) || !Number.isFinite(sample.x)) {
      flush();
      continue;
    }
    run.push({ x: mapX(sample.x), y: mapY(sample.y), z: 0, bulge: 0 });
  }
  flush();
  return runs;
}

function frame(nextId: () => string, layer: string, x: number, y: number, width: number, height: number): DrawEntity {
  return {
    id: nextId(),
    type: 'polyline',
    layer,
    color: FRAME,
    closed: true,
    vertices: [
      { x, y, z: 0, bulge: 0 },
      { x: x + width, y, z: 0, bulge: 0 },
      { x: x + width, y: y + height, z: 0, bulge: 0 },
      { x, y: y + height, z: 0, bulge: 0 },
    ],
  };
}

function textAt(nextId: () => string, layer: string, content: string, x: number, y: number, height: number, color: string): DrawEntity {
  return {
    id: nextId(),
    type: 'text',
    layer,
    color,
    p: { x, y, z: 0 },
    height: Math.max(height, 0.01),
    rotation: 0,
    content,
  };
}

function shift(entity: DrawEntity, dx: number, dy: number): DrawEntity {
  if (entity.type === 'line') {
    return { ...entity, a: { ...entity.a, x: entity.a.x + dx, y: entity.a.y + dy }, b: { ...entity.b, x: entity.b.x + dx, y: entity.b.y + dy } };
  }
  if (entity.type === 'polyline') {
    return { ...entity, vertices: entity.vertices.map((vertex) => ({ ...vertex, x: vertex.x + dx, y: vertex.y + dy })) };
  }
  if (entity.type === 'text' || entity.type === 'point') {
    return { ...entity, p: { ...entity.p, x: entity.p.x + dx, y: entity.p.y + dy } };
  }
  if (entity.type === 'circle' || entity.type === 'arc') {
    return { ...entity, center: { ...entity.center, x: entity.center.x + dx, y: entity.center.y + dy } };
  }
  if (entity.type === 'block') {
    return { ...entity, p: { ...entity.p, x: entity.p.x + dx, y: entity.p.y + dy } };
  }
  return entity;
}
