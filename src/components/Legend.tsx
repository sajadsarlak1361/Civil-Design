import { surfaceStats, volumeColorScale, ELEVATION_RAMP, rampRgb, rgbCss } from '../engine';
import { formatNumber } from '../lib/format';
import { useProject } from '../state/store';

export function Legend() {
  const project = useProject();
  const elevationSurface = project.state.surfaces.find((surface) => surface.visible && surface.style.showElevation);
  const slopeOn = project.state.surfaces.some((surface) => surface.visible && surface.style.showSlope);
  const showVolume = project.state.showVolumeMap && project.state.volumeResult;
  const stats = elevationSurface ? surfaceStats(elevationSurface.points, elevationSurface.triangles) : null;
  const contours = project.state.surfaces.filter((surface) => surface.visible && surface.style.showContours);

  if (!showVolume && !stats && !slopeOn && contours.length === 0) return null;

  return (
    <div className="legend">
      {showVolume && project.state.volumeResult && (
        <Scale
          title="Cut / fill"
          minLabel={`−${formatNumber(volumeColorScale(project.state.volumeResult), 1)}`}
          maxLabel={`+${formatNumber(volumeColorScale(project.state.volumeResult), 1)}`}
          gradient="linear-gradient(90deg, #b0241c, #ffc4b8, #d5deea, #b0d0ff, #184ed2)"
        />
      )}
      {stats && !showVolume && (
        <Scale
          title="Elevation"
          minLabel={formatNumber(stats.minZ, 1)}
          maxLabel={formatNumber(stats.maxZ, 1)}
          gradient={rampGradient()}
        />
      )}
      {slopeOn && !showVolume && (
        <Scale title="Slope" minLabel="0%" maxLabel="50%+" gradient="linear-gradient(90deg, #207a4e, #9abe48, #e0ba46, #d6703a, #b03028)" />
      )}
      {contours.map((surface) => (
        <div className="legend-lines" key={surface.id}>
          <span style={{ background: surface.style.majorColor }} />
          <em>Major {surface.style.majorInterval}</em>
          <span className="thin" style={{ background: surface.style.minorColor }} />
          <em>Minor {surface.style.minorInterval}</em>
        </div>
      ))}
    </div>
  );
}

function Scale({ title, minLabel, maxLabel, gradient }: { title: string; minLabel: string; maxLabel: string; gradient: string }) {
  return (
    <div className="scale">
      <div className="scale-title">
        <span>{title}</span>
        <span>
          {minLabel} – {maxLabel}
        </span>
      </div>
      <div className="scale-bar" style={{ background: gradient }} />
    </div>
  );
}

function rampGradient(): string {
  const stops = ELEVATION_RAMP.map((stop) => `${rgbCss(rampRgb(stop[0], ELEVATION_RAMP))} ${stop[0] * 100}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
