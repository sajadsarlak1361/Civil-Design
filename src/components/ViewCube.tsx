import type { ViewPreset } from '../view/workspace';

const FACES: { preset: ViewPreset; label: string }[] = [
  { preset: 'nw', label: 'NW' },
  { preset: 'back', label: 'N' },
  { preset: 'ne', label: 'NE' },
  { preset: 'left', label: 'W' },
  { preset: 'top', label: 'Top' },
  { preset: 'right', label: 'E' },
  { preset: 'sw', label: 'SW' },
  { preset: 'front', label: 'S' },
  { preset: 'se', label: 'SE' },
];

export function ViewCube({ onPreset }: { onPreset: (preset: ViewPreset) => void }) {
  return (
    <div className="viewcube" role="group" aria-label="ViewCube">
      {FACES.map((face) => (
        <button key={face.preset} type="button" title={face.preset} onClick={() => onPreset(face.preset)}>
          {face.label}
        </button>
      ))}
    </div>
  );
}
