import type { LinearUnit, SurveyPoint, Triangle } from './types';

export interface LandXmlSurface {
  name: string;
  points: SurveyPoint[];
  triangles: Triangle[];
}

export interface LandXmlPointGroup {
  name: string;
  points: SurveyPoint[];
}

export interface LandXmlAlignment {
  name: string;
  startStation: number;
  /** Easting / northing, in file order. Radius stays 0; curves are sampled as PIs. */
  pis: { x: number; y: number }[];
  profile: { station: number; elevation: number }[];
}

export interface LandXmlRead {
  surfaces: LandXmlSurface[];
  pointGroups: LandXmlPointGroup[];
  alignments: LandXmlAlignment[];
}

function stripNamespaces(xml: string): string {
  return xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
}

function attr(source: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(source);
  return match?.[1];
}

function coordsOf(text: string): number[] | null {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  const values = parts.slice(0, 3).map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  return values;
}

export function looksLikeLandXml(text: string): boolean {
  const head = text.slice(0, 800).toLowerCase();
  return head.includes('<landxml');
}

export function parseLandXml(xml: string): LandXmlRead {
  const source = stripNamespaces(xml);
  const surfaces: LandXmlSurface[] = [];
  const surfaceRe = /<Surface\b([^>]*)>([\s\S]*?)<\/Surface>/gi;
  let surfaceMatch: RegExpExecArray | null;
  while ((surfaceMatch = surfaceRe.exec(source))) {
    const name = attr(surfaceMatch[1], 'name') || `Surface ${surfaces.length + 1}`;
    const body = surfaceMatch[2];
    const idToIndex = new Map<string, number>();
    const points: SurveyPoint[] = [];
    const pointRe = /<P\b([^>]*)>([^<]*)<\/P>/gi;
    let pointMatch: RegExpExecArray | null;
    while ((pointMatch = pointRe.exec(body))) {
      const coords = coordsOf(pointMatch[2]);
      if (!coords) continue;
      const id = attr(pointMatch[1], 'id') ?? String(points.length + 1);
      idToIndex.set(id, points.length);
      // LandXML point order is northing, easting, elevation.
      points.push({ y: coords[0], x: coords[1], z: coords[2], number: id, role: 'survey' });
    }
    const triangles: Triangle[] = [];
    const faceRe = /<F\b[^>]*>([^<]*)<\/F>/gi;
    let faceMatch: RegExpExecArray | null;
    while ((faceMatch = faceRe.exec(body))) {
      const ids = faceMatch[1].trim().split(/\s+/).filter(Boolean);
      if (ids.length < 3) continue;
      const a = idToIndex.get(ids[0]);
      const b = idToIndex.get(ids[1]);
      const c = idToIndex.get(ids[2]);
      if (a === undefined || b === undefined || c === undefined) continue;
      triangles.push([a, b, c]);
    }
    if (points.length > 0) surfaces.push({ name, points, triangles });
  }

  const pointGroups: LandXmlPointGroup[] = [];
  const groupRe = /<CgPoints\b([^>]*)>([\s\S]*?)<\/CgPoints>/gi;
  let groupMatch: RegExpExecArray | null;
  while ((groupMatch = groupRe.exec(source))) {
    const name = attr(groupMatch[1], 'name') || 'Points';
    const points: SurveyPoint[] = [];
    const cgRe = /<CgPoint\b([^>]*)>([^<]*)<\/CgPoint>/gi;
    let cgMatch: RegExpExecArray | null;
    while ((cgMatch = cgRe.exec(groupMatch[2]))) {
      const coords = coordsOf(cgMatch[2]);
      if (!coords) continue;
      const number = attr(cgMatch[1], 'name');
      const description = attr(cgMatch[1], 'code');
      const point: SurveyPoint = { y: coords[0], x: coords[1], z: coords[2], role: 'survey' };
      if (number) point.number = number;
      if (description) point.description = description;
      points.push(point);
    }
    if (points.length > 0) pointGroups.push({ name, points });
  }
  const alignments: LandXmlAlignment[] = [];
  const alignRe = /<Alignment\b([^>]*)>([\s\S]*?)<\/Alignment>/gi;
  let alignMatch: RegExpExecArray | null;
  while ((alignMatch = alignRe.exec(source))) {
    const name = attr(alignMatch[1], 'name') || `Alignment ${alignments.length + 1}`;
    const startStation = Number(attr(alignMatch[1], 'staStart') ?? 0);
    const body = alignMatch[2];
    const pis: { x: number; y: number }[] = [];
    const push = (text: string | undefined) => {
      if (!text) return;
      const parts = text.trim().split(/\s+/).map(Number);
      if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return;
      const point = { y: parts[0], x: parts[1] };
      const last = pis[pis.length - 1];
      if (last && last.x === point.x && last.y === point.y) return;
      pis.push(point);
    };
    const lineRe = /<Line\b[^>]*>([\s\S]*?)<\/Line>/gi;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRe.exec(body))) {
      push(/<Start>([^<]*)<\/Start>/i.exec(lineMatch[1])?.[1]);
      push(/<End>([^<]*)<\/End>/i.exec(lineMatch[1])?.[1]);
    }
    const profile: { station: number; elevation: number }[] = [];
    const pviRe = /<PVI>([^<]*)<\/PVI>/gi;
    let pviMatch: RegExpExecArray | null;
    while ((pviMatch = pviRe.exec(body))) {
      const parts = pviMatch[1].trim().split(/\s+/).map(Number);
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) profile.push({ station: parts[0], elevation: parts[1] });
    }
    if (pis.length >= 2) alignments.push({ name, startStation: Number.isFinite(startStation) ? startStation : 0, pis, profile });
  }
  return { surfaces, pointGroups, alignments };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

export function surfaceToLandXml(
  surfaces: { name: string; points: SurveyPoint[]; triangles: Triangle[] }[],
  options: {
    projectName?: string;
    unit?: LinearUnit;
    date?: Date;
    alignments?: LandXmlAlignment[];
  } = {},
): string {
  const date = options.date ?? new Date();
  const isoDate = date.toISOString().slice(0, 10);
  const isoTime = date.toISOString().slice(11, 19);
  const unit = options.unit ?? 'm';
  const units =
    unit === 'ft'
      ? '<Imperial areaUnit="squareFoot" linearUnit="foot" volumeUnit="cubicYard" temperatureUnit="fahrenheit" pressureUnit="inHG"/>'
      : '<Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="mmHG"/>';
  const surfaceXml = surfaces
    .map((surface) => {
      const points = surface.points
        .map((point, index) => `          <P id="${index + 1}">${num(point.y)} ${num(point.x)} ${num(point.z)}</P>`)
        .join('\n');
      const faces = surface.triangles
        .map((tri) => `          <F>${tri[0] + 1} ${tri[1] + 1} ${tri[2] + 1}</F>`)
        .join('\n');
      return `    <Surface name="${xmlEscape(surface.name)}">
      <Definition surfType="TIN">
        <Pnts>
${points}
        </Pnts>
        <Faces>
${faces}
        </Faces>
      </Definition>
    </Surface>`;
    })
    .join('\n');
  return `<?xml version="1.0"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${isoDate}" time="${isoTime}">
  <Units>
    ${units}
  </Units>
  <Project name="${xmlEscape(options.projectName || 'Civil Design')}"/>
  <Application name="Civil Design" version="0.1" desc="Terrain surfaces"/>
  <Surfaces>
${surfaceXml}
  </Surfaces>${alignmentXml(options.alignments ?? [])}
</LandXML>
`;
}

function alignmentXml(alignments: LandXmlAlignment[]): string {
  if (alignments.length === 0) return '';
  const body = alignments
    .map((alignment) => {
      const lines = alignment.pis
        .slice(0, -1)
        .map((start, index) => {
          const end = alignment.pis[index + 1];
          return `        <Line>
          <Start>${num(start.y)} ${num(start.x)}</Start>
          <End>${num(end.y)} ${num(end.x)}</End>
        </Line>`;
        })
        .join('\n');
      const pvis = alignment.profile
        .map((pvi) => `          <PVI>${num(pvi.station)} ${num(pvi.elevation)}</PVI>`)
        .join('\n');
      const profile = pvis
        ? `
      <Profile>
        <ProfAlign name="${xmlEscape(alignment.name)}">
${pvis}
        </ProfAlign>
      </Profile>`
        : '';
      return `    <Alignment name="${xmlEscape(alignment.name)}" staStart="${num(alignment.startStation)}">
      <CoordGeom>
${lines}
      </CoordGeom>${profile}
    </Alignment>`;
    })
    .join('\n');
  return `
  <Alignments>
${body}
  </Alignments>`;
}
