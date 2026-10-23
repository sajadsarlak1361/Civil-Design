import { startZoom } from '../commands/runtime';
import { panDirection, applyOrbit } from '../view/viewCommands';

/** Zoom and pan buttons call the same commands as the View menu. */
export function NavBar() {
  return (
    <div className="navbar" role="toolbar" aria-label="Navigation bar">
      <button type="button" onClick={() => startZoom('2x')} title="Zoom in">
        +
      </button>
      <button type="button" onClick={() => startZoom('0.5x')} title="Zoom out">
        −
      </button>
      <button type="button" onClick={() => panDirection('left')} title="Pan left">
        ←
      </button>
      <button type="button" onClick={() => panDirection('right')} title="Pan right">
        →
      </button>
      <button type="button" onClick={() => panDirection('up')} title="Pan up">
        ↑
      </button>
      <button type="button" onClick={() => panDirection('down')} title="Pan down">
        ↓
      </button>
      <button type="button" onClick={() => applyOrbit('constrained')} title="Constrained orbit">
        Orbit
      </button>
    </div>
  );
}
