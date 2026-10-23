export interface RecallState {
  /** Commands typed at the idle prompt, oldest first. */
  items: string[];
  /** -1 is the live input. 0 is the newest recalled command. */
  cursor: number;
  draft: string;
}

export function emptyRecall(): RecallState {
  return { items: [], cursor: -1, draft: '' };
}

export function pushRecall(state: RecallState, command: string, limit = 200): RecallState {
  const text = command.trim();
  if (!text) return { ...state, cursor: -1, draft: '' };
  const items = [...state.items];
  if (items[items.length - 1] !== text) items.push(text);
  if (items.length > limit) items.splice(0, items.length - limit);
  return { items, cursor: -1, draft: '' };
}

export function recallStep(state: RecallState, direction: 'up' | 'down', live: string): { state: RecallState; value: string } {
  if (state.items.length === 0) return { state, value: live };
  if (direction === 'up') {
    const draft = state.cursor === -1 ? live : state.draft;
    const cursor = Math.min(state.items.length - 1, state.cursor + 1);
    return { state: { ...state, cursor, draft }, value: state.items[state.items.length - 1 - cursor] };
  }
  if (state.cursor <= 0) return { state: { ...state, cursor: -1, draft: '' }, value: state.draft };
  const cursor = state.cursor - 1;
  return { state: { ...state, cursor }, value: state.items[state.items.length - 1 - cursor] };
}

export interface LogLine {
  text: string;
  kind: 'echo' | 'prompt' | 'message' | 'error';
}

export function appendLog(lines: LogLine[], line: LogLine, limit = 400): LogLine[] {
  const next = [...lines, line];
  if (next.length > limit) next.splice(0, next.length - limit);
  return next;
}
