import type { UiRequest } from '../lib/uiBus';

/** One File or Insert row. Another pass can regroup these arrays without rewriting the commands. */
export interface FileMenuAction {
  id: string;
  label: string;
  command?: string;
  request?: UiRequest;
  disabled?: boolean;
  title?: string;
}

export const FILE_IMPORT: FileMenuAction[] = [
  { id: 'points', label: 'Points…', command: 'IMPORTPOINTS' },
  { id: 'landxml', label: 'LandXML…', command: 'LANDXMLIN' },
  { id: 'dxf', label: 'DXF…', command: 'OPEN', title: 'Drawing interchange. Lines, polylines, points, and basic 3D.' },
  { id: 'dem', label: 'DEM / GeoTIFF…', command: 'OPEN' },
  { id: 'las', label: 'LAS…', command: 'OPEN' },
  { id: 'laz', label: 'LAZ…', command: 'OPEN', title: 'LASzip point cloud. Export is LAS.' },
  { id: 'e57', label: 'E57…', command: 'OPEN', title: 'ASTM E57. Cartesian or spherical points, pose applied.' },
  { id: 'pcd', label: 'PCD…', command: 'OPEN', title: 'PCL point cloud. ASCII, binary, or binary compressed.' },
  { id: 'pts', label: 'PTS / PTX…', command: 'OPEN', title: 'Leica PTS and PTX.' },
  { id: 'shp', label: 'Shapefile…', command: 'OPEN' },
  { id: 'image', label: 'Image…', command: 'IMAGEATTACH' },
  { id: 'obj', label: 'OBJ…', command: 'OPEN' },
  { id: 'stl', label: 'STL…', command: 'OPEN' },
  { id: 'gltf', label: 'glTF…', command: 'OPEN' },
  { id: 'ply', label: 'PLY…', command: 'OPEN', title: 'Stanford PLY. Points and triangle meshes, ASCII or binary.' },
];

export const FILE_ATTACH: FileMenuAction = { id: 'attach', label: 'Attach', command: 'XATTACH' };

/** Insert tab → Reference. Shared with the compact ribbon. */
export const REFERENCE_MENU: FileMenuAction[] = [
  { id: 'xrefs', label: 'Xrefs', command: 'XREF', title: 'External References' },
  FILE_ATTACH,
  { id: 'clip', label: 'Clip', command: 'XCLIP' },
  { id: 'bind', label: 'Bind', command: 'XBIND' },
];

export const FILE_EXPORT: FileMenuAction[] = [
  { id: 'dxf', label: 'DXF…', request: 'export-dxf', title: 'Drawing interchange. Lines, polylines, points, and basic 3D.' },
  { id: 'landxml', label: 'LandXML…', request: 'export-landxml' },
  { id: 'csv', label: 'Points CSV…', request: 'export-csv' },
  { id: 'pdf', label: 'PDF…', request: 'export-pdf' },
  { id: 'png', label: 'PNG…', request: 'export-png' },
  { id: 'svg', label: 'SVG…', request: 'export-svg' },
  { id: 'obj', label: 'OBJ…', request: 'export-obj' },
  { id: 'stl', label: 'STL…', request: 'export-stl' },
  { id: 'gltf', label: 'glTF…', request: 'export-gltf' },
  { id: 'ply', label: 'PLY…', request: 'export-ply', title: 'Stanford PLY. The selected surface, or the active surface.' },
  { id: 'las', label: 'LAS…', request: 'export-las', title: 'LAS 1.2 point format 0.' },
  { id: 'xyz', label: 'Points XYZ…', request: 'export-xyz', title: 'X Y Z, one point per line.' },
  { id: 'pcd', label: 'PCD…', request: 'export-pcd', title: 'ASCII PCD.' },
  { id: 'pts', label: 'PTS…', request: 'export-pts', title: 'Leica PTS. A count, then X Y Z.' },
  { id: 'volume', label: 'Volume CSV…', request: 'export-volume' },
];

/** Insert-menu shape of the attach and drawing imports, ready to lift out of File. */
export const INSERT_MENU: FileMenuAction[] = [FILE_ATTACH, ...FILE_IMPORT.filter((item) => item.id === 'dxf' || item.id === 'image')];

export const FILE_MENU_GROUPS = {
  import: FILE_IMPORT,
  attach: [FILE_ATTACH],
  reference: REFERENCE_MENU,
  export: FILE_EXPORT,
} as const;
