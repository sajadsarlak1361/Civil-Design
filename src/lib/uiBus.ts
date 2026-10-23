export type UiRequest =
  | 'find'
  | 'qselect'
  | 'paste-special'
  | 'named-views'
  | 'visual-styles'
  | 'vports'
  | 'xref-attach'
  | 'image-attach'
  | 'export-dxf'
  | 'export-landxml'
  | 'export-csv'
  | 'export-pdf'
  | 'export-png'
  | 'export-svg'
  | 'export-obj'
  | 'export-stl'
  | 'export-gltf'
  | 'export-volume'
  | 'export-dwg'
  | 'dwg-settings';

const listeners = new Set<(request: UiRequest) => void>();

export function requestUi(request: UiRequest): void {
  for (const listener of listeners) listener(request);
}

export function onUi(listener: (request: UiRequest) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
