/**
 * DWG engines.
 *
 * LibreDWG (GPL-3.0) is bundled as WebAssembly and loaded in a worker the
 * first time a DWG is opened, in the browser and on the desktop. That build
 * reads R14 through 2018. Its writer is not in the module, so Save As emits
 * the DXF that a LibreDWG dxf2dwg step consumes.
 *
 * ODA File Converter is optional. Choose it in DWG Settings to write a DWG,
 * or to read one when the bundled module cannot. Auto uses LibreDWG first.
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
  write: 'partial';
  reason: string;
}

export const DWG_VERDICT: DwgVerdict = {
  read: 'yes',
  write: 'partial',
  reason:
    'LibreDWG reads DWG and DWT from R14 through 2018 offline in the browser and on the desktop (GPL-3.0). The bundled module does not include a DWG writer, so Save As writes DXF. ODA File Converter is optional. When it is selected, it writes DWG at the chosen version (2000 through 2018).',
};

export const DWG_WRITE_LIMIT =
  'LibreDWG in this build reads DWG and does not write it. Civil Design saved a DXF instead. Choose ODA File Converter under DWG Settings to write a DWG. LibreDWG itself writes the 2000 release most reliably from that DXF.';

export const ODA_MISSING =
  'ODA File Converter was not found. Install it, then set its path in DWG Settings. Windows looks in Program Files\\ODA\\ODAFileConverter and in versioned folders next to it. Linux looks at /usr/bin/ODAFileConverter, /usr/local/bin/ODAFileConverter, /opt/ODAFileConverter/ODAFileConverter, and ODAFileConverter under your home directory. Until then, Auto uses the bundled LibreDWG reader.';

const SETTINGS_KEY = 'fieldline.dwg';

const FALLBACK: DwgSettings = { engine: 'auto', odaPath: '', version: 'ACAD2018' };

export function dwgAvailable(): boolean {
  return true;
}

export function dwgVersion(id: string | undefined): DwgVersionOption {
  return DWG_VERSIONS.find((item) => item.id === id) ?? DWG_VERSIONS[DWG_VERSIONS.length - 1];
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
