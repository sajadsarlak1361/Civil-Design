import { useEffect, useState } from 'react';
import { getWorkspace, subscribeWorkspace, type WorkspaceState } from './workspace';

export function useWorkspace(): WorkspaceState {
  const [state, setState] = useState(getWorkspace);
  useEffect(() => subscribeWorkspace(() => setState({ ...getWorkspace(), slots: getWorkspace().slots.map((slot) => ({ ...slot })) })), []);
  return state;
}
