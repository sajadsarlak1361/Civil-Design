import { directDistance, v3, type Vec3 } from '../engine/drafting';

export interface KeywordSpec {
  /** Display label. Capital letters (and digits) are the short abbreviation. */
  label: string;
}

export function keywordAbbrev(label: string): string {
  const picked = [...label].filter((ch) => (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')).join('');
  if (picked) return picked.toLowerCase();
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function keywordFull(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Match a command option. Exact abbreviation wins over a longer prefix. */
export function matchKeyword(raw: string, keywords: KeywordSpec[]): string | 'ambiguous' | null {
  const query = raw.trim().toLowerCase();
  if (!query || keywords.length === 0) return null;
  const specs = keywords.map((keyword) => ({
    label: keyword.label,
    full: keywordFull(keyword.label),
    abbr: keywordAbbrev(keyword.label),
  }));
  const exactAbbr = specs.filter((spec) => spec.abbr === query);
  if (exactAbbr.length === 1) return exactAbbr[0].label;
  if (exactAbbr.length > 1) return 'ambiguous';
  const exactFull = specs.filter((spec) => spec.full === query);
  if (exactFull.length === 1) return exactFull[0].label;
  if (exactFull.length > 1) return 'ambiguous';
  const prefix = specs.filter((spec) => spec.full.startsWith(query));
  if (prefix.length === 1) return prefix[0].label;
  if (prefix.length > 1) return 'ambiguous';
  return null;
}

export interface PromptSpec {
  head: string;
  keywords?: KeywordSpec[];
  def?: string;
  expect: 'point' | 'number' | 'text' | 'select' | 'any';
  /** Space acts as Enter except while typing literal text. */
  spaceCommits: boolean;
}

export type ParsedInput =
  | { kind: 'empty' }
  | { kind: 'point'; point: Vec3 }
  | { kind: 'number'; value: number }
  | { kind: 'keyword'; name: string }
  | { kind: 'text'; text: string }
  | { kind: 'invalid'; message: string };

const ABS = /^(-?\d*\.?\d+),(-?\d*\.?\d+)(?:,(-?\d*\.?\d+))?$/;
const REL = /^@(-?\d*\.?\d+),(-?\d*\.?\d+)(?:,(-?\d*\.?\d+))?$/;
const POLAR = /^@(-?\d*\.?\d+)<(-?\d*\.?\d+)(?:,(-?\d*\.?\d+))?$/;
const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

export function parseCoordinate(raw: string, base: Vec3 | null): Vec3 | null {
  const text = raw.trim();
  const abs = ABS.exec(text);
  if (abs) return v3(Number(abs[1]), Number(abs[2]), abs[3] === undefined ? base?.z ?? 0 : Number(abs[3]));
  const rel = REL.exec(text);
  if (rel) {
    const origin = base ?? v3(0, 0, 0);
    return v3(origin.x + Number(rel[1]), origin.y + Number(rel[2]), origin.z + (rel[3] === undefined ? 0 : Number(rel[3])));
  }
  const polar = POLAR.exec(text);
  if (polar) {
    const origin = base ?? v3(0, 0, 0);
    const distance = Number(polar[1]);
    const angle = (Number(polar[2]) * Math.PI) / 180;
    return v3(
      origin.x + Math.cos(angle) * distance,
      origin.y + Math.sin(angle) * distance,
      origin.z + (polar[3] === undefined ? 0 : Number(polar[3])),
    );
  }
  return null;
}

export function parsePromptInput(
  raw: string,
  prompt: PromptSpec,
  base: Vec3 | null,
  cursor: Vec3 | null,
): ParsedInput {
  const text = raw.trim();
  if (!text) {
    if (prompt.def && prompt.expect !== 'text') {
      const numeric = Number(prompt.def);
      if (prompt.expect === 'number' && Number.isFinite(numeric)) return { kind: 'number', value: numeric };
      return { kind: 'keyword', name: prompt.def };
    }
    return { kind: 'empty' };
  }
  if (prompt.expect === 'text') return { kind: 'text', text: raw };
  const keyword = matchKeyword(text, prompt.keywords ?? []);
  if (keyword === 'ambiguous') return { kind: 'invalid', message: 'Ambiguous response, please clarify.' };
  const coordinate = parseCoordinate(text, base);
  if (coordinate && keyword && prompt.expect === 'point') {
    // A coordinate wins when the token is an actual point. Abbreviations are letters.
  }
  if (coordinate && (prompt.expect === 'point' || prompt.expect === 'any')) return { kind: 'point', point: coordinate };
  if (keyword) return { kind: 'keyword', name: keyword };
  if (NUM.test(text)) {
    const value = Number(text);
    if (prompt.expect === 'number' || prompt.expect === 'any') return { kind: 'number', value };
    if (prompt.expect === 'point' && base && cursor) {
      const point = directDistance(base, cursor, value);
      if (point) return { kind: 'point', point };
    }
    if (prompt.expect === 'point') return { kind: 'invalid', message: 'Point or option keyword required.' };
    return { kind: 'number', value };
  }
  if (prompt.expect === 'select' || prompt.expect === 'any') return { kind: 'text', text };
  return { kind: 'invalid', message: 'Point or option keyword required.' };
}

export function formatPrompt(prompt: PromptSpec): string {
  const keys = prompt.keywords ?? [];
  const option = keys.length > 0 ? ` [${keys.map((keyword) => keyword.label).join('/')}]` : '';
  const def = prompt.def ? ` <${prompt.def}>` : '';
  const colon = prompt.head.endsWith(':') || prompt.head.endsWith('.') ? '' : ':';
  return `${prompt.head}${option}${def}${colon}`;
}
