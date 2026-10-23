import type { Xyz } from './cadShapes';

export interface BlockDef {
  name: string;
  base: Xyz;
  description: string;
  /** Entity records stored with the block. Parsed with the drawing. */
  entities: object[];
}

export interface GroupRec {
  name: string;
  description: string;
  ids: string[];
  selectable: boolean;
}

export interface TextStyle {
  name: string;
  font: string;
  height: number;
  widthFactor: number;
  oblique: number;
}

export interface DimStyle {
  name: string;
  dimclrd: string;
  dimclre: string;
  dimlwd: number;
  dimlwe: number;
  dimdli: number;
  dimexo: number;
  dimexe: number;
  dimsd1: boolean;
  dimsd2: boolean;
  dimse1: boolean;
  dimse2: boolean;
  dimdle: number;
  dimasz: number;
  dimblk: string;
  dimcen: number;
  dimtxt: number;
  dimclrt: string;
  dimtad: number;
  dimjust: number;
  dimgap: number;
  dimtih: boolean;
  dimtoh: boolean;
  dimtxsty: string;
  dimatfit: number;
  dimtix: boolean;
  dimtofl: boolean;
  dimscale: number;
  dimtmove: number;
  annotative: boolean;
  dimlunit: number;
  dimdec: number;
  dimdsep: string;
  dimpost: string;
  dimzin: number;
  dimlfac: number;
  dimalt: boolean;
  dimaltf: number;
  dimaltd: number;
  dimapost: string;
  dimaltu: number;
  dimtol: boolean;
  dimlim: boolean;
  dimtp: number;
  dimtm: number;
  dimtfac: number;
  dimtolj: number;
  dimtdec: number;
}

export interface LeaderStyle {
  name: string;
  arrow: string;
  arrowSize: number;
  dogleg: number;
  textStyle: string;
  textHeight: number;
  landing: boolean;
}

export interface TableStyle {
  name: string;
  textHeight: number;
  headerFill: string;
  gridColor: string;
  textColor: string;
}

export interface CadLibrary {
  blocks: BlockDef[];
  groups: GroupRec[];
  textStyles: TextStyle[];
  currentTextStyle: string;
  dimStyles: DimStyle[];
  currentDimStyle: string;
  leaderStyles: LeaderStyle[];
  currentLeaderStyle: string;
  tableStyles: TableStyle[];
  currentTableStyle: string;
  /** 1 selects the whole group. 0 selects one object. PICKSTYLE. */
  pickStyle: number;
  groupBBox: boolean;
  /** Empty means dimensions use the current layer. DIMLAYER. */
  dimLayer: string;
  annotationScale: number;
  /** Last dimension, used by DIMCONTINUE and DIMBASELINE. */
  lastDimId: string;
  /** Entities moved to paper space by CHSPACE. Hidden in model space. */
  paperIds: string[];
  /** In-place block edit (BEDIT / REFEDIT). */
  editing: { name: string; ids: string[] } | null;
}

export function standardDimStyle(): DimStyle {
  return {
    name: 'Standard',
    dimclrd: 'bylayer',
    dimclre: 'bylayer',
    dimlwd: -1,
    dimlwe: -1,
    dimdli: 3.75,
    dimexo: 0.625,
    dimexe: 1.25,
    dimsd1: false,
    dimsd2: false,
    dimse1: false,
    dimse2: false,
    dimdle: 0,
    dimasz: 2.5,
    dimblk: 'closedfilled',
    dimcen: 2.5,
    dimtxt: 2.5,
    dimclrt: 'bylayer',
    dimtad: 1,
    dimjust: 0,
    dimgap: 0.625,
    dimtih: false,
    dimtoh: false,
    dimtxsty: 'Standard',
    dimatfit: 3,
    dimtix: false,
    dimtofl: false,
    dimscale: 1,
    dimtmove: 0,
    annotative: false,
    dimlunit: 2,
    dimdec: 2,
    dimdsep: '.',
    dimpost: '<>',
    dimzin: 0,
    dimlfac: 1,
    dimalt: false,
    dimaltf: 25.4,
    dimaltd: 2,
    dimapost: '[]',
    dimaltu: 2,
    dimtol: false,
    dimlim: false,
    dimtp: 0,
    dimtm: 0,
    dimtfac: 1,
    dimtolj: 1,
    dimtdec: 2,
  };
}

export function defaultLibrary(): CadLibrary {
  return {
    blocks: [],
    groups: [],
    textStyles: [{ name: 'Standard', font: 'IBM Plex Sans', height: 0, widthFactor: 1, oblique: 0 }],
    currentTextStyle: 'Standard',
    dimStyles: [standardDimStyle()],
    currentDimStyle: 'Standard',
    leaderStyles: [{ name: 'Standard', arrow: 'closedfilled', arrowSize: 2.5, dogleg: 2, textStyle: 'Standard', textHeight: 2.5, landing: true }],
    currentLeaderStyle: 'Standard',
    tableStyles: [{ name: 'Standard', textHeight: 2.5, headerFill: '#2a2418', gridColor: '#d5dbe6', textColor: '#e8eef7' }],
    currentTableStyle: 'Standard',
    pickStyle: 1,
    groupBBox: false,
    dimLayer: '',
    annotationScale: 1,
    lastDimId: '',
    paperIds: [],
    editing: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function parseLibrary(value: unknown): CadLibrary {
  const base = defaultLibrary();
  if (!isRecord(value)) return base;
  const raw = value;
  if (Array.isArray(raw.blocks)) {
    base.blocks = raw.blocks.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== 'string') return [];
      const basePoint = isRecord(item.base) ? item.base : {};
      return [{
        name: item.name,
        description: typeof item.description === 'string' ? item.description : '',
        base: {
          x: typeof basePoint.x === 'number' ? basePoint.x : 0,
          y: typeof basePoint.y === 'number' ? basePoint.y : 0,
          z: typeof basePoint.z === 'number' ? basePoint.z : 0,
        },
        entities: Array.isArray(item.entities) ? item.entities.filter((entity) => isRecord(entity)) : [],
      }];
    });
  }
  if (Array.isArray(raw.groups)) {
    base.groups = raw.groups.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== 'string') return [];
      return [{
        name: item.name,
        description: typeof item.description === 'string' ? item.description : '',
        ids: Array.isArray(item.ids) ? item.ids.filter((id): id is string => typeof id === 'string') : [],
        selectable: item.selectable !== false,
      }];
    });
  }
  if (Array.isArray(raw.dimStyles)) {
    const styles = raw.dimStyles.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== 'string') return [];
      return [{ ...standardDimStyle(), ...(item as unknown as DimStyle), name: item.name }];
    });
    if (styles.length > 0) base.dimStyles = styles;
  }
  if (Array.isArray(raw.textStyles) && raw.textStyles.length > 0) {
    base.textStyles = raw.textStyles.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== 'string') return [];
      return [{
        name: item.name,
        font: typeof item.font === 'string' ? item.font : 'IBM Plex Sans',
        height: typeof item.height === 'number' ? item.height : 0,
        widthFactor: typeof item.widthFactor === 'number' ? item.widthFactor : 1,
        oblique: typeof item.oblique === 'number' ? item.oblique : 0,
      }];
    });
  }
  if (Array.isArray(raw.leaderStyles)) {
    const styles = raw.leaderStyles.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== 'string') return [];
      return [{ ...base.leaderStyles[0], ...(item as unknown as LeaderStyle), name: item.name }];
    });
    if (styles.length > 0) base.leaderStyles = styles;
  }
  if (Array.isArray(raw.tableStyles)) {
    const styles = raw.tableStyles.flatMap((item) => {
      if (!isRecord(item) || typeof item.name !== 'string') return [];
      return [{ ...base.tableStyles[0], ...(item as unknown as TableStyle), name: item.name }];
    });
    if (styles.length > 0) base.tableStyles = styles;
  }
  if (typeof raw.currentDimStyle === 'string') base.currentDimStyle = raw.currentDimStyle;
  if (typeof raw.currentTextStyle === 'string') base.currentTextStyle = raw.currentTextStyle;
  if (typeof raw.currentLeaderStyle === 'string') base.currentLeaderStyle = raw.currentLeaderStyle;
  if (typeof raw.currentTableStyle === 'string') base.currentTableStyle = raw.currentTableStyle;
  if (typeof raw.pickStyle === 'number') base.pickStyle = raw.pickStyle;
  if (typeof raw.groupBBox === 'boolean') base.groupBBox = raw.groupBBox;
  if (typeof raw.dimLayer === 'string') base.dimLayer = raw.dimLayer;
  if (typeof raw.annotationScale === 'number' && raw.annotationScale > 0) base.annotationScale = raw.annotationScale;
  if (typeof raw.lastDimId === 'string') base.lastDimId = raw.lastDimId;
  if (Array.isArray(raw.paperIds)) base.paperIds = raw.paperIds.filter((id): id is string => typeof id === 'string');
  return base;
}

export function ensureLibrary(doc: { library?: CadLibrary }): CadLibrary {
  if (!doc.library) doc.library = defaultLibrary();
  if (!doc.library.paperIds) doc.library.paperIds = [];
  return doc.library;
}

export function dimStyleByName(library: CadLibrary, name: string): DimStyle {
  return library.dimStyles.find((style) => style.name.toLowerCase() === name.toLowerCase()) ?? library.dimStyles[0] ?? standardDimStyle();
}

export function effectiveDimStyle(library: CadLibrary, name: string, overrides: Record<string, string | number | boolean>): DimStyle {
  const style = { ...dimStyleByName(library, name) };
  for (const [key, value] of Object.entries(overrides)) {
    if (key in style) (style as unknown as Record<string, unknown>)[key] = value;
  }
  return style;
}

/** Overall scale. Annotative styles multiply by the annotation scale. */
export function dimScaleOf(style: DimStyle, annotationScale: number): number {
  const scale = style.dimscale === 0 ? 1 : style.dimscale;
  return style.annotative ? scale * annotationScale : scale;
}
