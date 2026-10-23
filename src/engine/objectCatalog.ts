import type { AlignmentRecord } from './alignment';
import type { CivilModel } from './civilModel';
import { defaultLayerForKind, type CatalogEntry } from './objects';
import type { SurfaceRecord } from './project';

export function projectCatalog(input: {
  surfaces: Pick<SurfaceRecord, 'id' | 'name'>[];
  alignments: Pick<AlignmentRecord, 'id' | 'name'>[];
  civil: CivilModel;
}): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const add = (kind: string, id: string, name: string) => {
    entries.push({ key: `${kind}:${id}`, kind, name, layer: defaultLayerForKind(kind) });
  };
  for (const surface of input.surfaces) {
    add('surface', surface.id, surface.name);
    add('contour', surface.id, `${surface.name} contours`);
  }
  for (const alignment of input.alignments) {
    add('alignment', alignment.id, alignment.name);
    add('profile', alignment.id, `${alignment.name} profile`);
    add('profile-view', alignment.id, `${alignment.name} profile view`);
    add('sample-line', alignment.id, `${alignment.name} sample lines`);
    add('section-view', alignment.id, `${alignment.name} section view`);
  }
  for (const point of input.civil.points) add('cogo-point', point.id, String(point.number));
  for (const line of input.civil.featureLines) add('feature-line', line.id, line.name);
  for (const grading of input.civil.gradings) add('grading', grading.id, grading.name);
  for (const assembly of input.civil.assemblies) add('assembly', assembly.id, assembly.name);
  for (const corridor of input.civil.corridors) add('corridor', corridor.id, corridor.name);
  for (const intersection of input.civil.intersections) add('intersection', intersection.id, intersection.name);
  for (const network of input.civil.pipeNetworks) add('pipe-network', network.id, network.name);
  for (const network of input.civil.pressureNetworks) add('pressure-network', network.id, network.name);
  for (const parcel of input.civil.parcels) add('parcel', parcel.id, parcel.name);
  return entries;
}
