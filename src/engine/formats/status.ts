import { BINARY_DRAWING_NOTE } from './ingest';
import { LAZ_REASON } from './las';

export type FormatAccess = 'yes' | 'partial' | 'no';

export interface FormatStatus {
  id: string;
  label: string;
  extensions: string;
  read: FormatAccess;
  write: FormatAccess;
  note: string;
}

export const FORMAT_CATALOG: FormatStatus[] = [
  { id: 'fieldline', label: 'Civil Design project', extensions: '.fieldline .fieldline.json', read: 'yes', write: 'yes', note: 'JSON project, version 1, including drawing and xrefs.' },
  { id: 'dxf', label: 'DXF', extensions: '.dxf', read: 'yes', write: 'yes', note: 'ASCII and binary DXF. POINT, LINE, LWPOLYLINE, CIRCLE, ARC, TEXT, 3DFACE.' },
  { id: 'dwg', label: 'Binary drawing', extensions: '.dwg .dwt', read: 'no', write: 'no', note: BINARY_DRAWING_NOTE },
  { id: 'landxml', label: 'LandXML', extensions: '.xml .landxml', read: 'yes', write: 'yes', note: 'Surfaces, CgPoints, alignments, and profiles.' },
  { id: 'points', label: 'Point file', extensions: '.csv .txt .xyz', read: 'yes', write: 'yes', note: 'PNEZD, PENZD, PNEZ, PENZ, NEZ, ENZ, and XYZ.' },
  { id: 'dem', label: 'ASCII DEM', extensions: '.asc', read: 'yes', write: 'yes', note: 'ESRI ASCII grid and an XYZ grid of cell centers.' },
  { id: 'geotiff', label: 'GeoTIFF', extensions: '.tif .tiff', read: 'partial', write: 'partial', note: 'Uncompressed float32 with tie point and pixel scale. LZW, JPEG, Deflate, and PackBits are refused.' },
  { id: 'las', label: 'LAS', extensions: '.las', read: 'yes', write: 'yes', note: 'LAS 1.2 point format 0.' },
  { id: 'laz', label: 'LAZ', extensions: '.laz', read: 'no', write: 'no', note: LAZ_REASON },
  { id: 'shp', label: 'Shapefile', extensions: '.shp', read: 'yes', write: 'yes', note: 'Point, polyline, and polygon. No .dbf attributes.' },
  { id: 'image', label: 'Image', extensions: '.png .jpg .jpeg', read: 'yes', write: 'partial', note: 'Attach reads width and height. PNG export captures the current view.' },
  { id: 'pdf', label: 'PDF', extensions: '.pdf', read: 'no', write: 'yes', note: 'Plot export is a one-page Flate RGB PDF. PDF underlay is not bundled.' },
  { id: 'obj', label: 'OBJ', extensions: '.obj', read: 'yes', write: 'yes', note: 'Triangle mesh, easting / northing / elevation.' },
  { id: 'stl', label: 'STL', extensions: '.stl', read: 'yes', write: 'yes', note: 'ASCII STL triangles.' },
  { id: 'gltf', label: 'glTF', extensions: '.gltf', read: 'yes', write: 'yes', note: 'glTF 2.0, Y-up, geometry embedded in the file.' },
];

export function formatById(id: string): FormatStatus | undefined {
  return FORMAT_CATALOG.find((row) => row.id === id);
}
