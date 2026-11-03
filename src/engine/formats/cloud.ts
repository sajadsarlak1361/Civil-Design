import { readLasOffThread } from '../importWork';
import { parsePointFile, parseXyzCloud } from '../points';
import type { TaskHandle } from '../tasks';
import type { SurveyPoint } from '../types';
import { readE57 } from './e57';
import { gridToPoints, parseXyzGrid } from './grid';
import { classifyFile } from './ingest';
import { readLaz } from './laz';
import { readPcd } from './pcd';
import { parsePly } from './ply';
import { readPts, readPtx } from './pts';

const TEXT = new TextDecoder();

/** Read a point cloud into survey points. DXF and project files are not point clouds. */
export async function readPointCloudFile(name: string, bytes: Uint8Array, task?: TaskHandle): Promise<SurveyPoint[]> {
  const classified = classifyFile(name, bytes);
  switch (classified.kind) {
    case 'las':
      return readLasOffThread(bytes, task);
    case 'laz':
      return readLaz(bytes);
    case 'e57':
      return readE57(bytes);
    case 'pcd':
      return readPcd(bytes);
    case 'pts':
      return readPts(TEXT.decode(bytes));
    case 'ptx':
      return readPtx(TEXT.decode(bytes));
    case 'ply':
      return parsePly(bytes).points;
    case 'xyz-grid':
      return gridToPoints(parseXyzGrid(TEXT.decode(bytes)));
    case 'points': {
      const text = TEXT.decode(bytes);
      if (/\.xyz$/i.test(name)) return parseXyzCloud(text);
      return parsePointFile(text).points;
    }
    default:
      throw new Error(classified.reason ?? 'That file is not a point cloud Civil Design can read.');
  }
}
