/**
 * Pressure network.
 * Hazen-Williams, SI: hf = 10.67 L Q^1.852 / (C^1.852 D^4.87), Q in m³/s, D in m.
 * US customary: hf = 4.727 L Q^1.852 / (C^1.852 D^4.87), Q in ft³/s, D in ft.
 * Loops are solved by the loop-flow form of Hardy-Cross.
 */

export interface PressureNode {
  id: string;
  name: string;
  x: number;
  y: number;
  elevation: number;
  /** Outflow demand. The reservoir demand is ignored and balances the system. */
  demand: number;
  /** Known hydraulic grade. Exactly one node should set this. */
  fixedHgl?: number;
}

export interface PressurePipe {
  id: string;
  name: string;
  fromId: string;
  toId: string;
  diameter: number;
  hazenWilliams: number;
  length?: number;
}

export interface PressureResult {
  flows: { id: string; name: string; flow: number; velocity: number; headLoss: number }[];
  nodes: { id: string; name: string; hgl: number; pressureHead: number; pressureKpa: number }[];
  warnings: string[];
}

export function hazenWilliamsHeadLoss(length: number, flow: number, c: number, diameter: number, unit: 'm' | 'ft'): number {
  if (!(length > 0) || !(c > 0) || !(diameter > 0) || flow === 0) return 0;
  const q = Math.abs(flow);
  const coefficient = unit === 'ft' ? 4.727 : 10.67;
  const loss = (coefficient * length * q ** 1.852) / (c ** 1.852 * diameter ** 4.87);
  return Math.sign(flow) * loss;
}

interface Edge {
  id: string;
  name: string;
  from: string;
  to: string;
  length: number;
  diameter: number;
  c: number;
  flow: number;
  tree: boolean;
}

export function solvePressureNetwork(nodes: PressureNode[], pipes: PressurePipe[], unit: 'm' | 'ft'): PressureResult {
  const warnings: string[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const reservoir = nodes.find((node) => node.fixedHgl !== undefined) ?? nodes[0];
  if (!reservoir) return { flows: [], nodes: [], warnings: ['The network has no nodes.'] };
  if (reservoir.fixedHgl === undefined) warnings.push('No fixed HGL. The first node was treated as a reservoir 30 units above its elevation.');
  const hglFixed = reservoir.fixedHgl ?? reservoir.elevation + 30;
  const edges: Edge[] = pipes.map((pipe) => {
    const from = byId.get(pipe.fromId);
    const to = byId.get(pipe.toId);
    const length = pipe.length ?? (from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0);
    return {
      id: pipe.id,
      name: pipe.name,
      from: pipe.fromId,
      to: pipe.toId,
      length,
      diameter: pipe.diameter,
      c: pipe.hazenWilliams,
      flow: 0,
      tree: false,
    };
  });
  const adjacent = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    for (const id of [edge.from, edge.to]) {
      const list = adjacent.get(id) ?? [];
      list.push(index);
      adjacent.set(id, list);
    }
  });
  const parent = new Map<string, number>();
  const children = new Map<string, string[]>();
  const seen = new Set<string>([reservoir.id]);
  const queue = [reservoir.id];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    for (const index of adjacent.get(id) ?? []) {
      const edge = edges[index];
      const other = edge.from === id ? edge.to : edge.from;
      if (seen.has(other)) continue;
      seen.add(other);
      edge.tree = true;
      parent.set(other, index);
      const kids = children.get(id) ?? [];
      kids.push(other);
      children.set(id, kids);
      queue.push(other);
    }
  }
  for (const node of nodes) {
    if (!seen.has(node.id)) warnings.push(`${node.name} is not connected to the reservoir.`);
  }
  const chords = edges.filter((edge) => !edge.tree);
  for (const chord of chords) chord.flow = 0;

  const subtree = (id: string, into: Set<string>) => {
    into.add(id);
    for (const child of children.get(id) ?? []) subtree(child, into);
  };

  const supply = (id: string): number => {
    const members = new Set<string>();
    subtree(id, members);
    const node = byId.get(id);
    let total = node && node.id !== reservoir.id ? node.demand : 0;
    for (const child of children.get(id) ?? []) total += supply(child);
    for (const chord of chords) {
      const other = chord.from === id ? chord.to : chord.to === id ? chord.from : null;
      if (!other || members.has(other)) continue;
      total += chord.from === id ? chord.flow : -chord.flow;
    }
    return total;
  };

  const applyTreeFlows = () => {
    const walk = (id: string) => {
      for (const child of children.get(id) ?? []) {
        const index = parent.get(child);
        if (index === undefined) continue;
        const edge = edges[index];
        const needed = supply(child);
        edge.flow = edge.from === id ? needed : -needed;
        walk(child);
      }
    };
    walk(reservoir.id);
  };

  const signedLoss = (edge: Edge, directionFrom: string, directionTo: string) => {
    const forward = edge.from === directionFrom && edge.to === directionTo;
    const flow = forward ? edge.flow : -edge.flow;
    return hazenWilliamsHeadLoss(edge.length, flow, edge.c, edge.diameter, unit);
  };

  for (let iteration = 0; iteration < (chords.length > 0 ? 40 : 1); iteration++) {
    applyTreeFlows();
    if (chords.length === 0) break;
    for (const chord of chords) {
      const cycle: { edge: Edge; from: string; to: string }[] = [{ edge: chord, from: chord.from, to: chord.to }];
      const pathToRoot = (id: string) => {
        const path: string[] = [id];
        let cursor = id;
        while (cursor !== reservoir.id && parent.has(cursor)) {
          const index = parent.get(cursor);
          if (index === undefined) break;
          const edge = edges[index];
          cursor = edge.from === cursor ? edge.to : edge.from;
          path.push(cursor);
        }
        return path;
      };
      const toRoot = pathToRoot(chord.to);
      const fromRoot = pathToRoot(chord.from);
      const shared = toRoot.find((id) => fromRoot.includes(id)) ?? reservoir.id;
      for (let i = 0; i < toRoot.length - 1 && toRoot[i] !== shared; i++) {
        const index = parent.get(toRoot[i]);
        if (index === undefined) break;
        cycle.push({ edge: edges[index], from: toRoot[i], to: toRoot[i + 1] });
      }
      const down: { edge: Edge; from: string; to: string }[] = [];
      for (let i = 0; i < fromRoot.length - 1 && fromRoot[i] !== shared; i++) {
        const index = parent.get(fromRoot[i]);
        if (index === undefined) break;
        down.push({ edge: edges[index], from: fromRoot[i + 1], to: fromRoot[i] });
      }
      cycle.push(...down.reverse());
      let sum = 0;
      let derivative = 0;
      for (const step of cycle) {
        const loss = signedLoss(step.edge, step.from, step.to);
        sum += loss;
        const flow = step.edge.from === step.from ? step.edge.flow : -step.edge.flow;
        derivative += (1.852 * Math.abs(loss)) / Math.max(Math.abs(flow), 1e-6);
      }
      if (derivative > 0) chord.flow += -sum / derivative;
    }
  }
  applyTreeFlows();

  const hgl = new Map<string, number>([[reservoir.id, hglFixed]]);
  const walkHgl = (id: string) => {
    for (const child of children.get(id) ?? []) {
      const index = parent.get(child);
      if (index === undefined) continue;
      const edge = edges[index];
      const parentHgl = hgl.get(id) ?? hglFixed;
      const loss = edge.from === id ? hazenWilliamsHeadLoss(edge.length, edge.flow, edge.c, edge.diameter, unit) : hazenWilliamsHeadLoss(edge.length, -edge.flow, edge.c, edge.diameter, unit);
      hgl.set(child, parentHgl - loss);
      walkHgl(child);
    }
  };
  walkHgl(reservoir.id);

  return {
    flows: edges.map((edge) => {
      const area = Math.PI * (edge.diameter / 2) ** 2;
      return {
        id: edge.id,
        name: edge.name,
        flow: edge.flow,
        velocity: area > 0 ? edge.flow / area : 0,
        headLoss: hazenWilliamsHeadLoss(edge.length, edge.flow, edge.c, edge.diameter, unit),
      };
    }),
    nodes: nodes.map((node) => {
      const grade = hgl.get(node.id) ?? node.elevation;
      const head = grade - node.elevation;
      if (head < 0) warnings.push(`${node.name} has negative pressure.`);
      return { id: node.id, name: node.name, hgl: grade, pressureHead: head, pressureKpa: head * (unit === 'ft' ? 2.988 : 9.80665) };
    }),
    warnings,
  };
}
