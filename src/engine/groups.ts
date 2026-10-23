import type { CadLibrary, GroupRec } from './cadLibrary';

export function groupByName(library: CadLibrary, name: string): GroupRec | undefined {
  return library.groups.find((group) => group.name.toLowerCase() === name.toLowerCase());
}

export function createGroup(library: CadLibrary, name: string, ids: string[], description = ''): GroupRec {
  const existing = groupByName(library, name);
  if (existing) {
    existing.ids = [...new Set(ids)];
    existing.description = description || existing.description;
    return existing;
  }
  const group: GroupRec = { name, description, ids: [...new Set(ids)], selectable: true };
  library.groups.push(group);
  return group;
}

export function ungroup(library: CadLibrary, name: string): boolean {
  const before = library.groups.length;
  library.groups = library.groups.filter((group) => group.name.toLowerCase() !== name.toLowerCase());
  return library.groups.length !== before;
}

export function editGroup(group: GroupRec, add: string[], remove: string[]): void {
  const drop = new Set(remove);
  group.ids = [...new Set([...group.ids.filter((id) => !drop.has(id)), ...add])];
}

export function groupsOf(library: CadLibrary, id: string): GroupRec[] {
  return library.groups.filter((group) => group.selectable && group.ids.includes(id));
}

/** PICKSTYLE 1 expands a pick to every member of each selectable group. */
export function expandGroupSelection(library: CadLibrary | undefined, ids: string[], pickStyle: number): string[] {
  if (!library || pickStyle === 0) return ids;
  const out = new Set(ids);
  for (const id of ids) {
    for (const group of groupsOf(library, id)) {
      if (group.selectable) for (const member of group.ids) out.add(member);
    }
  }
  return [...out];
}
