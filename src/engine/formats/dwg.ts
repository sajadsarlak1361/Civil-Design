/**
 * DWG engines.
 *
 * LibreDWG (GPL-3.0) is bundled as WebAssembly. The reader loads in a worker
 * the first time a DWG is opened, in the browser and on the desktop, and reads
 * R14 through 2018. A second module writes DWG 2000 and DWG 2004 offline.
 * No other program is required for those versions.
 *
 * ODA File Converter is optional. It writes DWG 2007 and later when it is
 * installed and selected. When it is missing, Export still writes DWG 2000
 * and shows where to download the converter.
 */

export type DwgEngineId = 'auto' | 'libredwg' | 'oda';

export interface DwgVersionOption {
  id: 'ACAD2000' | 'ACAD2004' | 'ACAD2007' | 'ACAD2010' | 'ACAD2013' | 'ACAD2018';
  label: string;
  /** LibreDWG dxf2dwg version token. R2000 is the writer the project documents as reliable. */
  libre: string;
}

export const DWG_VERSIONS: DwgVersionOption[] = [
  { id: 'ACAD2000', label: 'DWG 2000', libre: 'r2000' },
  { id: 'ACAD2004', label: 'DWG 2004', libre: 'r2004' },
  { id: 'ACAD2007', label: 'DWG 2007', libre: 'r2007' },
  { id: 'ACAD2010', label: 'DWG 2010', libre: 'r2010' },
  { id: 'ACAD2013', label: 'DWG 2013', libre: 'r2013' },
  { id: 'ACAD2018', label: 'DWG 2018', libre: 'r2018' },
];

export type DwgVersionId = DwgVersionOption['id'];

export interface DwgSettings {
  engine: DwgEngineId;
  odaPath: string;
  version: DwgVersionId;
}

export interface DwgVerdict {
  read: 'yes';
  write: 'yes';
  reason: string;
}

export const DWG_VERDICT: DwgVerdict = {
  read: 'yes',
  write: 'yes',
  reason:
    'LibreDWG reads DWG and DWT from R14 through 2018 and writes DWG 2000 and DWG 2004 offline in the browser and on the desktop (GPL-3.0). No other program is required for those versions. DWG 2007 and later use ODA File Converter when it is installed. If it is missing, the file is still saved as DWG 2000.',
};

export const DWG_NATIVE_WRITE =
  'LibreDWG writes DWG 2000 and DWG 2004 offline. No other program is required. DWG 2007, 2010, 2013, and 2018 use ODA File Converter when it is installed. If it is missing, the file is still saved as DWG 2000.';

export const DWG_WRITE_LIMIT = 'LibreDWG could not write a DWG. Civil Design saved a DXF instead.';

/** Shown as text. The page does not request this address. */
export const ODA_DOWNLOAD_URL = 'https://www.opendesign.com/guestfiles/oda_file_converter';

export const ODA_MISSING =
  `ODA File Converter was not found. Install it, then set its path in DWG Settings. Download: ${ODA_DOWNLOAD_URL}. Windows looks in Program Files\\ODA\\ODAFileConverter and in versioned folders next to it. Linux looks at /usr/bin/ODAFileConverter, /usr/local/bin/ODAFileConverter, /opt/ODAFileConverter/ODAFileConverter, and ODAFileConverter under your home directory. DWG 2000 and DWG 2004 are still written by the bundled LibreDWG writer.`;

const SETTINGS_KEY = 'fieldline.dwg';

const FALLBACK: DwgSettings = { engine: 'auto', odaPath: '', version: 'ACAD2000' };

export function dwgAvailable(): boolean {
  return true;
}

export function dwgVersion(id: string | undefined): DwgVersionOption {
  return DWG_VERSIONS.find((item) => item.id === id) ?? DWG_VERSIONS[0];
}

/** LibreDWG encodes these two releases. Newer releases go through ODA File Converter. */
export function dwgLibreWritable(id: DwgVersionId): boolean {
  return id === 'ACAD2000' || id === 'ACAD2004';
}

export function dwgFallbackNote(requestedLabel: string): string {
  return `Wrote DWG 2000 with LibreDWG. ${requestedLabel} is not written by the bundled LibreDWG writer. Install ODA File Converter and choose it in DWG Settings to write that version. Download: ${ODA_DOWNLOAD_URL}`;
}

export function readDwgSettings(): DwgSettings {
  if (typeof localStorage === 'undefined') return { ...FALLBACK };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '') as Partial<DwgSettings>;
    const engine = raw.engine === 'libredwg' || raw.engine === 'oda' ? raw.engine : 'auto';
    return { engine, odaPath: typeof raw.odaPath === 'string' ? raw.odaPath : '', version: dwgVersion(raw.version).id };
  } catch {
    return { ...FALLBACK };
  }
}

export function writeDwgSettings(next: DwgSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ engine: next.engine, odaPath: next.odaPath, version: dwgVersion(next.version).id }));
}
