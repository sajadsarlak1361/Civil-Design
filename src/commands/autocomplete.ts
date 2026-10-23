export interface SuggestSource {
  name: string;
  aliases: string[];
  description: string;
  implemented: boolean;
  /** Higher ranks sort first. Design commands use a higher rank than classic.pgp. */
  rank?: number;
}

export interface Suggestion {
  label: string;
  command: string;
  description: string;
  implemented: boolean;
  score: number;
}

function fuzzy(query: string, text: string): number | null {
  let qi = 0;
  let score = 0;
  let streak = 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) {
      streak = 0;
      continue;
    }
    streak += 1;
    score += 2 + streak;
    if (i === qi) score += 2;
    qi += 1;
  }
  if (qi < q.length) return null;
  return score - (t.length - q.length) * 0.05;
}

export function suggestCommands(query: string, sources: SuggestSource[], limit = 12): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranked: Suggestion[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!source.implemented) continue;
    const names = [source.name, ...source.aliases];
    let best = -Infinity;
    let label = source.name;
    for (const name of names) {
      const lower = name.toLowerCase();
      let score: number | null = null;
      if (lower === q) score = 1000;
      else if (lower.startsWith(q)) score = 800 - (lower.length - q.length);
      else if (lower.includes(q)) score = 500 - lower.indexOf(q);
      else score = fuzzy(q, lower);
      if (score === null) continue;
      if (name !== source.name) score += 5;
      if (score > best) {
        best = score;
        label = name.toUpperCase() === source.name ? source.name : `${name.toUpperCase()} → ${source.name}`;
      }
    }
    if (!Number.isFinite(best) || best === -Infinity) continue;
    if (seen.has(source.name)) continue;
    seen.add(source.name);
    ranked.push({
      label,
      command: source.name,
      description: source.description,
      implemented: source.implemented,
      score: best + (source.implemented ? 20 : 0) + (source.rank ?? 0),
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.command.localeCompare(b.command));
  return ranked.slice(0, limit);
}
