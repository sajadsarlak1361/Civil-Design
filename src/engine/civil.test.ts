import { describe, expect, it } from 'vitest';
import { applyAssembly, stockLaneAssembly } from './assembly';
import { solveAlignment, type AlignmentRecord } from './alignment';
import { buildTin } from './tin';
import { CIVIL_COMMANDS, civilCommand } from './commands';
import { filterPointGroup, interpolatePoints, matchWildcard, pointGrid, pointsAlongAlignment } from './cogo';
import { buildCorridor } from './corridor';
import { elevationsFromSurface, featureLength2d, insertFeaturePoint, setFeatureGrade } from './featureLine';
import { gradeFeatureLine } from './grading';
import { alignmentCrossing, curbReturn, curbReturns } from './intersection';
import { averageEndAreas, massHaul } from './masshaul';
import { offsetAlignmentPis } from './offsetAlignment';
import { buildParcel } from './parcels';
import { manningDischarge, solveGravityNetwork } from './pipes';
import { hazenWilliamsHeadLoss, solvePressureNetwork } from './pressure';
import { clipProfile, geometryBand, profileSheets, quickProfile, superimposeProfile } from './profileSheet';
import { parseProject, serializeProject, type SurfaceRecord } from './project';
import { runCivilCommand } from './runCommand';
import { defaultSurfaceStyle } from './types';
import { figuresFromPoints, parseFigureCodes, parseSurveyBook } from './surveyFigures';
import { aashtoSideFriction, maximumRelativeGradient, slopesAtStation, superelevationDiagram, superelevationRate } from './superelevation';
import { adjustTraverse, courseAzimuths } from './traverse';
import { emptyCivil } from './civilModel';

describe('COGO points and point groups', () => {
  it('interpolates plan and elevation, and filters a point group', () => {
    const points = interpolatePoints({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 10 }, 4, 10, 'EP', (number) => `p${number}`);
    expect(points).toHaveLength(5);
    expect(points[2]).toMatchObject({ number: 12, x: 50, z: 5, description: 'EP' });
    expect(matchWildcard('EP*,GS', 'ep-1')).toBe(true);
    expect(matchWildcard('EP*', 'CL')).toBe(false);
    const grouped = filterPointGroup(
      [
        ...points,
        { id: 'a', number: 1, x: 0, y: 0, z: 50, description: 'GS' },
      ],
      { description: 'EP', minElevation: 4, maxElevation: 8, minNumber: null, maxNumber: null, excludeNumbers: [] },
    );
    expect(grouped.map((point) => point.number)).toEqual([12, 13]);
  });

  it('places points along an alignment and on a grid', () => {
    const solved = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 100, y: 0, radius: 0 },
    ]);
    const along = pointsAlongAlignment({
      solved,
      startStation: 0,
      fromStation: 0,
      toStation: 100,
      interval: 50,
      offset: 5,
      elevationAt: () => 12,
      fallbackZ: 0,
      startNumber: 1,
      description: 'CL',
      idFor: (number) => `a${number}`,
    });
    expect(along.map((point) => point.x)).toEqual([0, 50, 100]);
    expect(along[0].y).toBeCloseTo(-5, 6);
    expect(along[0].z).toBe(12);
    const grid = pointGrid({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
      columns: 2,
      rows: 2,
      elevationAt: (x, y) => x + y,
      fallbackZ: 0,
      startNumber: 1,
      description: 'GS',
      idFor: (number) => `g${number}`,
    });
    expect(grid).toHaveLength(4);
    expect(grid[3]).toMatchObject({ x: 10, y: 10, z: 20 });
  });
});

describe('traverse adjustment', () => {
  it('closes a square with the compass rule and reads angle-right', () => {
    const result = adjustTraverse({
      startX: 0,
      startY: 0,
      startAzimuthDeg: 90,
      method: 'compass',
      closed: true,
      courses: [
        { azimuthDeg: 90, distance: 100 },
        { azimuthDeg: 180, distance: 100 },
        { azimuthDeg: 270, distance: 100 },
        { azimuthDeg: 0, distance: 100.2 },
      ],
    });
    expect(result.linearMisclosure).toBeCloseTo(0.2, 8);
    expect(result.precision).toBeCloseTo(400.2 / 0.2, 6);
    const end = result.adjusted[result.adjusted.length - 1];
    expect(end.x).toBeCloseTo(0, 6);
    expect(end.y).toBeCloseTo(0, 6);
    const transit = adjustTraverse({ ...result, startX: 0, startY: 0, startAzimuthDeg: 90, method: 'transit', closed: true, courses: [
      { azimuthDeg: 90, distance: 100 },
      { azimuthDeg: 180, distance: 100 },
      { azimuthDeg: 270, distance: 100 },
      { azimuthDeg: 0, distance: 100.2 },
    ] });
    expect(transit.adjusted[transit.adjusted.length - 1].y).toBeCloseTo(0, 6);
    const azimuths = courseAzimuths({
      startAzimuthDeg: 90,
      courses: [{ distance: 100 }, { angleRightDeg: 270, distance: 100 }, { angleRightDeg: 270, distance: 100 }],
    });
    expect(azimuths.azimuths.map((value) => Math.round(value))).toEqual([90, 180, 270]);
  });
});

describe('survey figures', () => {
  it('begins, continues, and closes figures from description codes', () => {
    expect(parseFigureCodes('EP1 B CW1')).toEqual([
      { figure: 'EP1', command: 'begin' },
      { figure: 'CW1', command: 'continue' },
    ]);
    const book = parseSurveyBook('1,100,0,10,EP1 B\n2,100,10,11,EP1\n3,110,10,12,EP1 CLS\n');
    const figures = figuresFromPoints(book.points);
    expect(figures).toHaveLength(1);
    expect(figures[0].closed).toBe(true);
    expect(figures[0].points).toHaveLength(3);
    expect(figures[0].points[0]).toMatchObject({ x: 0, y: 100, z: 10 });
  });
});

describe('feature lines and grading', () => {
  it('sets a grade and reads elevations from a plane', () => {
    const line = setFeatureGrade(
      { id: 'f', name: 'EP', points: [{ x: 0, y: 0, z: 100 }, { x: 50, y: 0, z: 100 }, { x: 100, y: 0, z: 100 }] },
      0,
      2,
      -0.02,
    );
    expect(line.points[1].z).toBeCloseTo(99, 8);
    expect(line.points[2].z).toBeCloseTo(98, 8);
    expect(featureLength2d(line)).toBeCloseTo(100, 8);
    const inserted = insertFeaturePoint(line, 25);
    expect(inserted.points[1]).toMatchObject({ x: 25, z: 99.5 });
    const tin = buildTin([
      { x: 0, y: 0, z: 10 },
      { x: 10, y: 0, z: 10 },
      { x: 0, y: 10, z: 12 },
      { x: 10, y: 10, z: 12 },
    ]);
    const draped = elevationsFromSurface({ id: 'f', name: 'EP', points: [{ x: 0, y: 5, z: 0 }] }, tin.points, tin.triangles);
    expect(draped.line.points[0].z).toBeCloseTo(11, 6);
  });

  it('daylights a fill slope to a flat surface at the analytical distance', () => {
    const tin = buildTin([
      { x: -5, y: -5, z: 100 },
      { x: 20, y: -5, z: 100 },
      { x: 20, y: 20, z: 100 },
      { x: -5, y: 20, z: 100 },
    ]);
    const graded = gradeFeatureLine({
      footprint: { id: 'f', name: 'Pad', points: [{ x: 0, y: 0, z: 102 }, { x: 10, y: 0, z: 102 }] },
      side: 'left',
      cutSlope: 2,
      fillSlope: 2,
      points: tin.points,
      triangles: tin.triangles,
      interval: 5,
    });
    expect(graded.warnings).toEqual([]);
    expect(graded.daylight.length).toBeGreaterThan(0);
    for (const chain of graded.daylight) {
      for (const point of chain) {
        expect(point.y).toBeCloseTo(4, 2);
        expect(point.z).toBeCloseTo(100, 2);
      }
    }
    expect(graded.triangles.length).toBeGreaterThan(0);
  });
});

describe('offset alignments, parcels, and profile sheets', () => {
  it('offsets a line to the right and an arc away from its center', () => {
    const line = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 100, y: 0, radius: 0 },
    ]);
    const offset = offsetAlignmentPis(line, 5);
    expect(offset.pis[0]).toMatchObject({ x: 0, y: -5 });
    expect(offset.pis[offset.pis.length - 1]).toMatchObject({ x: 100, y: -5 });
    const arc = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 200, y: 0, radius: 50 },
      { x: 200, y: 200, radius: 0 },
    ]);
    const arcEntity = arc.entities.find((entity) => entity.kind === 'arc');
    expect(arcEntity && arcEntity.kind === 'arc' ? arcEntity.radius : 0).toBeCloseTo(50, 3);
    const widened = offsetAlignmentPis(arc, 10);
    const center = arcEntity && arcEntity.kind === 'arc' ? arcEntity.center : { x: 0, y: 0 };
    const onArc = widened.pis.filter((point) => Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - 60) < 0.05);
    expect(onArc.length).toBeGreaterThan(8);
  });

  it('reports parcel area, centroid, and a quadrant bearing', () => {
    const parcel = buildParcel('p', 'Lot 1', [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    expect(parcel.area).toBeCloseTo(100, 8);
    expect(parcel.perimeter).toBeCloseTo(40, 8);
    expect(parcel.centroid).toMatchObject({ x: 5, y: 5 });
    expect(parcel.segments[0].bearing.startsWith('N')).toBe(true);
    expect(parcel.segments[0].bearing).toContain('E');
    expect(parcel.misclosure).toBe(0);
  });

  it('splits profile sheets, clips, superimposes, and samples a quick profile', () => {
    expect(profileSheets(0, 250, 100, 0).map((sheet) => [sheet.start, sheet.end])).toEqual([
      [0, 100],
      [100, 200],
      [200, 250],
    ]);
    const clipped = clipProfile(
      [
        { station: 0, elevation: 0 },
        { station: 10, elevation: 10 },
        { station: 20, elevation: 20 },
      ],
      5,
      15,
    );
    expect(clipped[0]).toMatchObject({ station: 5, elevation: 5 });
    expect(clipped[clipped.length - 1]).toMatchObject({ station: 15, elevation: 15 });
    const host = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 100, y: 0, radius: 0 },
    ]);
    const mapped = superimposeProfile(host, 0, [
      { x: 0, y: 10, elevation: 5 },
      { x: 50, y: 10, elevation: 6 },
    ]);
    expect(mapped[0].station).toBeCloseTo(0, 1);
    expect(mapped[1].station).toBeCloseTo(50, 1);
    expect(mapped[1].elevation).toBe(6);
    const tin = buildTin([
      { x: 0, y: -5, z: 0 },
      { x: 100, y: -5, z: 100 },
      { x: 0, y: 5, z: 0 },
      { x: 100, y: 5, z: 100 },
    ]);
    const quick = quickProfile(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [{ name: 'EG', points: tin.points, triangles: tin.triangles }],
      50,
    );
    expect(quick[0].elevations[0].elevation).toBeCloseTo(0, 4);
    expect(quick[quick.length - 1].elevations[0].elevation).toBeCloseTo(100, 4);
    const curve = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 100, y: 0, radius: 40 },
      { x: 100, y: 80, radius: 0 },
    ]);
    const band = geometryBand(curve, 0);
    expect(band.some((cell) => cell.label.startsWith('R '))).toBe(true);
    expect(band.some((cell) => cell.label === 'Tangent')).toBe(true);
  });
});

describe('mass haul', () => {
  it('balances a cut and fill lobe and separates free haul from overhaul', () => {
    const samples = [
      { station: 0, cut: 10, fill: 0 },
      { station: 10, cut: 10, fill: 0 },
      { station: 20, cut: 0, fill: 10 },
      { station: 30, cut: 0, fill: 10 },
    ];
    const increments = averageEndAreas(samples);
    expect(increments[0].cut).toBeCloseTo(100, 6);
    expect(increments[2].fill).toBeCloseTo(100, 6);
    const tight = massHaul(samples, 10);
    expect(tight.cumulative[1]).toBeCloseTo(100, 6);
    expect(tight.cumulative[3]).toBeCloseTo(0, 4);
    expect(tight.unbalanced).toBeCloseTo(0, 4);
    expect(tight.lobes[0].overhaul).toBeCloseTo(0, 1);
    const long = massHaul(samples, 20);
    expect(long.lobes[0].overhaul).toBeCloseTo(50, 1);
    expect(long.totalCut).toBeCloseTo(long.totalFill, 6);
  });
});

describe('superelevation', () => {
  it('matches the Green Book side-friction anchors and the runoff length', () => {
    expect(aashtoSideFriction(50 * 1.609344)).toBeCloseTo(0.14, 6);
    expect(aashtoSideFriction(55 * 1.609344)).toBeCloseTo(0.13, 6);
    expect(aashtoSideFriction(70 * 1.609344)).toBeCloseTo(0.1, 6);
    expect(aashtoSideFriction(85 * 1.609344)).toBeCloseTo(0.07, 6);
    expect(maximumRelativeGradient(50 * 1.609344)).toBeCloseTo(0.005, 6);
    const rate = superelevationRate(80, 250, 0.08, 0.14);
    expect(rate).toBeCloseTo(6400 / (127 * 250) - 0.14, 6);
    const solved = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 200, y: 0, radius: 50 },
      { x: 200, y: 200, radius: 0 },
    ]);
    const diagram = superelevationDiagram({
      solved,
      startStation: 0,
      designSpeedKmh: 80,
      emax: 0.06,
      laneWidth: 3.6,
      normalCrown: 0.02,
    });
    expect(diagram.curves[0].turn).toBe('left');
    expect(diagram.curves[0].rate).toBeCloseTo(0.06, 6);
    const delta = maximumRelativeGradient(80);
    expect(diagram.curves[0].runoff).toBeCloseTo((3.6 * 0.06) / delta, 4);
    const arc = solved.entities.find((entity) => entity.kind === 'arc');
    if (!arc) throw new Error('missing arc');
    const mid = arc.start + arc.length / 2;
    const slopes = slopesAtStation(diagram.stations, mid, 0.02);
    expect(slopes.left).toBeCloseTo(0.06, 3);
    expect(slopes.right).toBeCloseTo(0.06, 3);
    expect(slopesAtStation(diagram.stations, -10, 0.02)).toEqual({ left: 0.02, right: -0.02 });
  });
});

describe('assemblies and corridors', () => {
  it('daylights a flat embankment and reports the analytical fill', () => {
    const assembly = stockLaneAssembly('a');
    assembly.right = [
      { kind: 'lane', name: 'Lane', width: 3.5, slope: 0, depth: 0 },
      { kind: 'daylight', name: 'Daylight', cutSlope: 2, fillSlope: 2, maxWidth: 30 },
    ];
    assembly.left = [];
    const section = applyAssembly(assembly, { centerElevation: 102, egAt: () => 100 });
    const right = section.points.find((point) => point.code === 'Daylight' && point.offset > 0);
    const left = section.points.find((point) => point.code === 'Daylight' && point.offset < 0);
    expect(right?.offset).toBeCloseTo(7.5, 2);
    expect(right?.elevation).toBeCloseTo(100, 2);
    expect(left?.offset).toBeCloseTo(-7.5, 2);
    expect(section.fillArea).toBeCloseTo(22, 1);
    expect(section.cutArea).toBeCloseTo(0, 2);

    const points = [];
    for (let x = -10; x <= 110; x += 10) {
      for (let y = -20; y <= 20; y += 5) points.push({ x, y, z: 100 });
    }
    const tin = buildTin(points);
    const solved = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 100, y: 0, radius: 0 },
    ]);
    const corridor = buildCorridor({
      solved,
      startStation: 0,
      profile: [
        { station: 0, elevation: 102, curveLength: 0 },
        { station: 100, elevation: 102, curveLength: 0 },
      ],
      assembly,
      frequency: 50,
      surfacePoints: tin.points,
      surfaceTriangles: tin.triangles,
    });
    expect(corridor.warnings).toEqual([]);
    expect(corridor.fill).toBeCloseTo(2200, 0);
    expect(corridor.cut).toBeCloseTo(0, 0);
    const edge = corridor.featureLines.find((line) => line.code === 'Daylight-R');
    expect(edge?.points[0].y).toBeCloseTo(-7.5, 2);
    expect(edge?.points[0].z).toBeCloseTo(100, 2);
    expect(corridor.surfaceTriangles.length).toBeGreaterThan(0);
    expect(corridor.pavementArea).toBeCloseTo(700, 0);
  });

  it('targets the largest surface and still crosses when another alignment is parallel', () => {
    const points = [];
    for (let x = -10; x <= 110; x += 10) {
      for (let y = -30; y <= 30; y += 10) points.push({ x, y, z: 100 });
    }
    const tin = buildTin(points);
    const style = defaultSurfaceStyle(0);
    const ground: SurfaceRecord = {
      id: 'eg',
      name: 'Existing Ground',
      visible: true,
      source: 'points',
      sourcePoints: points,
      points: tin.points,
      triangles: tin.triangles,
      boundary: null,
      breaklines: [],
      maxEdgeLength: null,
      style,
    };
    const speck = buildTin([
      { x: 0, y: 0, z: 50 },
      { x: 1, y: 0, z: 50 },
      { x: 0, y: 1, z: 50 },
    ]);
    const tiny: SurfaceRecord = {
      ...ground,
      id: 'tiny',
      name: 'Grading',
      sourcePoints: speck.points,
      points: speck.points,
      triangles: speck.triangles,
    };
    const alignment: AlignmentRecord = {
      id: 'al',
      name: 'Access',
      visible: true,
      startStation: 0,
      pis: [
        { x: 0, y: 0, radius: 0 },
        { x: 100, y: 0, radius: 0 },
      ],
      designProfile: [
        { station: 0, elevation: 102, curveLength: 0 },
        { station: 100, elevation: 102, curveLength: 0 },
      ],
      labelInterval: 20,
      profileInterval: 5,
      sampleSpacing: 20,
      sampleLeft: 20,
      sampleRight: 20,
      sectionStep: 2,
      showSampleLines: false,
    };
    const offset: AlignmentRecord = {
      ...alignment,
      id: 'off',
      name: 'Access offset',
      pis: [
        { x: 0, y: 6, radius: 0 },
        { x: 100, y: 6, radius: 0 },
      ],
      designProfile: undefined,
    };
    const ctx = {
      unit: 'm' as const,
      surfaces: [ground, tiny],
      alignments: [alignment, offset],
      civil: emptyCivil(),
      activeSurfaceId: 'tiny',
      activeAlignmentId: 'al',
      nextId: (prefix: string) => prefix,
    };
    const corridor = runCivilCommand('CREATECORRIDOR', { frequency: 50 }, ctx);
    expect(corridor.ok).toBe(true);
    expect(corridor.summary).toMatch(/Fill [1-9]/);
    const intersection = runCivilCommand('CREATEINTERSECTION', {}, { ...ctx, civil: corridor.civil, alignments: corridor.alignments });
    expect(intersection.status).toContain('curb return');
  });
});

describe('intersections', () => {
  it('fits a 90 degree curb return with tangent length equal to the radius', () => {
    const approach = { x: 50, y: 0, tx: 1, ty: 0 };
    const depart = { x: 50, y: 0, tx: 0, ty: 1 };
    const fit = curbReturn(approach, depart, 3.5, 8);
    if (!fit) throw new Error('curb return was not solved');
    expect(fit.turn).toBe('left');
    expect(fit.tangent).toBeCloseTo(8, 6);
    expect(fit.pc).toMatchObject({ x: 45.5, y: 3.5 });
    expect(fit.pt.x).toBeCloseTo(53.5, 6);
    expect(fit.pt.y).toBeCloseTo(11.5, 6);
    expect(Math.hypot(fit.center.x - fit.pc.x, fit.center.y - fit.pc.y)).toBeCloseTo(8, 6);
    const east = solveAlignment([
      { x: 0, y: 0, radius: 0 },
      { x: 100, y: 0, radius: 0 },
    ]);
    const north = solveAlignment([
      { x: 50, y: -50, radius: 0 },
      { x: 50, y: 50, radius: 0 },
    ]);
    const crossing = alignmentCrossing(east, 0, north, 0);
    expect(crossing?.point.x).toBeCloseTo(50, 1);
    expect(crossing?.point.y).toBeCloseTo(0, 1);
    expect(crossing ? curbReturns(crossing, 3.5, 8).length : 0).toBe(4);
  });
});

describe('pipe and pressure networks', () => {
  it('solves Manning capacity, cover, and a known full-pipe discharge', () => {
    const discharge = manningDischarge(0.3, 0.01, 0.013, 1, 'm');
    expect(discharge).toBeCloseTo(0.09670075853355611, 8);
    expect(manningDischarge(0.3, 0.01, 0.013, 0.5, 'm')).toBeLessThan(discharge);
    const solved = solveGravityNetwork({
      structures: [
        { id: 'a', name: 'MH1', x: 0, y: 0, rim: 100 },
        { id: 'b', name: 'MH2', x: 40, y: 0, rim: 99.9 },
      ],
      pipes: [{ id: 'p', name: 'Pipe 1', fromId: 'a', toId: 'b', diameter: 0.45, manningN: 0.013, slope: 0.005, flow: 0.02 }],
      unit: 'm',
      minCover: 1,
      minSlope: 0.003,
      designDepthRatio: 0.8,
    });
    expect(solved[0].length).toBeCloseTo(40, 6);
    expect(solved[0].slope).toBeCloseTo(0.005, 6);
    expect(solved[0].invertTo).toBeCloseTo(solved[0].invertFrom - 0.2, 6);
    expect(solved[0].coverFrom).toBeCloseTo(1, 6);
    expect(solved[0].capacityDesign).toBeGreaterThan(0);
    expect(solved[0].warnings).toEqual([]);
  });

  it('splits flow between parallel pipes with Hazen-Williams', () => {
    expect(hazenWilliamsHeadLoss(100, 0.01, 140, 0.15, 'm')).toBeCloseTo(0.23012874324427204, 8);
    const solved = solvePressureNetwork(
      [
        { id: 'a', name: 'Reservoir', x: 0, y: 0, elevation: 100, demand: 0, fixedHgl: 140 },
        { id: 'b', name: 'Demand', x: 100, y: 0, elevation: 100, demand: 0.05 },
      ],
      [
        { id: 'p1', name: 'Large', fromId: 'a', toId: 'b', diameter: 0.2, hazenWilliams: 140, length: 100 },
        { id: 'p2', name: 'Small', fromId: 'a', toId: 'b', diameter: 0.1, hazenWilliams: 140, length: 100 },
      ],
      'm',
    );
    const large = solved.flows.find((pipe) => pipe.name === 'Large');
    const small = solved.flows.find((pipe) => pipe.name === 'Small');
    expect(large && small ? large.flow + small.flow : 0).toBeCloseTo(0.05, 4);
    const ratio = (0.2 / 0.1) ** (4.87 / 1.852);
    expect(large && small ? large.flow / small.flow : 0).toBeCloseTo(ratio, 2);
    expect(Math.abs((large?.headLoss ?? 0) - (small?.headLoss ?? 0))).toBeLessThan(0.02);
    const demand = solved.nodes.find((node) => node.name === 'Demand');
    expect(demand?.pressureHead).toBeGreaterThan(30);
    expect(demand?.pressureKpa).toBeCloseTo((demand?.pressureHead ?? 0) * 9.80665, 4);
  });
});

describe('command names', () => {
  it('lists every former Home-ribbon placeholder plus mass haul and superelevation', () => {
    const names = CIVIL_COMMANDS.map((spec) => spec.command);
    expect(new Set(names).size).toBe(names.length);
    for (const command of [
      'CREATEPOINTS',
      'CREATEPOINTGROUP',
      'TRAVERSEEDITOR',
      'CREATESURVEYFIGURE',
      'IMPORTSURVEYDATA',
      'CREATEPARCELFROMOBJECTS',
      'CREATEFEATURELINES',
      'CREATEGRADING',
      'CREATEOFFSETALIGNMENT',
      'CREATEPROFILEFROMCORRIDOR',
      'CREATECORRIDOR',
      'CREATEINTERSECTION',
      'CREATEASSEMBLY',
      'CREATEPIPENETWORK',
      'CREATEPRESSURENETWORK',
      'CREATEMULTIPLEPROFILEVIEW',
      'ADDPROFILEVIEWBANDS',
      'SUPERIMPOSEPROFILE',
      'CREATEQUICKPROFILE',
      'CREATEMASSHAULDIAGRAM',
      'CALCULATESUPERELEVATION',
    ]) {
      expect(civilCommand(command)?.label.length).toBeGreaterThan(0);
    }
    expect(civilCommand('TRAVERSE')?.command).toBe('TRAVERSEEDITOR');
    expect(civilCommand('CREATEFEATURELINE')?.command).toBe('CREATEFEATURELINES');
    expect(civilCommand('QUICKPROFILE')?.command).toBe('CREATEQUICKPROFILE');
    expect(emptyCivil().points).toEqual([]);
    const saved = serializeProject({
      format: 'fieldline-project',
      version: 1,
      name: 'Civil',
      unit: 'm',
      activeId: null,
      surfaces: [],
      volumeSetup: { baseId: null, mode: 'surface', comparisonId: null, datum: 0 },
      showVolumeMap: false,
      civil: { ...emptyCivil(), points: [{ id: 'p', number: 1, x: 2, y: 3, z: 4, description: 'GS' }] },
    });
    expect(parseProject(saved).civil?.points[0]).toMatchObject({ number: 1, x: 2, y: 3, z: 4, description: 'GS' });
  });
});
