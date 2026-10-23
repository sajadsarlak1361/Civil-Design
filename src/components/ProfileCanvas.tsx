import { useEffect, useRef } from 'react';
import { bindView } from '../commands/runtime';
import { clipProfile, formatStation, geometryBand, profileSheets, type ProfileVertex, type SolvedAlignment } from '../engine';
import { formatElevation } from '../lib/format';
import { useProject } from '../state/store';
import { fitCamera, worldToScreen, niceStep, type PlanCamera } from '../view/camera';
import { attachSheetGestures } from '../view/gestureDom';

export function ProfileCanvas({ active = true }: { active?: boolean }) {
  const project = useProject();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<PlanCamera>({ cx: 0, cy: 0, scale: 1 });
  const fitted = useRef(-1);
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    const draw = () => {
      const current = projectRef.current;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (width < 2 || height < 2) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#0b0d11';
      ctx.fillRect(0, 0, width, height);
      const haul = current.state.civil.massHaul;
      if (current.state.diagram === 'masshaul' && haul && haul.stations.length > 1) {
        drawMassHaul(ctx, cameraRef, fitted, current.state.fitToken, width, height, haul);
        return;
      }
      const alignment = current.activeAlignment;
      const band = current.state.profileBands ? 86 : 0;
      const graphHeight = height - band;
      const sheets =
        alignment && current.state.profileSheetLength
          ? profileSheets(
              alignment.record.startStation,
              alignment.record.startStation + alignment.solved.length,
              current.state.profileSheetLength,
              current.state.profileSheetOverlap,
            )
          : [];
      const sheet = sheets[Math.min(current.state.profileSheetIndex, Math.max(0, sheets.length - 1))] ?? null;
      const clip = (vertices: ProfileVertex[]) => (sheet ? clipProfile(vertices, sheet.start, sheet.end) : vertices);
      const profiles = (alignment?.profiles ?? []).map((profile) => ({ ...profile, vertices: clip(profile.vertices) }));
      const design = clip(alignment?.designSamples ?? []);
      const superimposed = current.state.superimposed ? clip(current.state.superimposed.samples) : [];
      const stations = [
        ...profiles.flatMap((profile) => profile.vertices.map((vertex) => vertex.station)),
        ...design.map((sample) => sample.station),
        ...superimposed.map((sample) => sample.station),
      ];
      const elevations = [
        ...profiles.flatMap((profile) => profile.vertices.map((vertex) => vertex.elevation).filter((value): value is number => value !== null)),
        ...design.map((sample) => sample.elevation).filter((value): value is number => value !== null),
        ...superimposed.map((sample) => sample.elevation).filter((value): value is number => value !== null),
      ];
      if (!alignment || stations.length === 0 || elevations.length === 0) {
        ctx.fillStyle = '#9aa3b5';
        ctx.font = '14px "IBM Plex Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(alignment ? 'This sheet does not cross a visible surface.' : 'Create an alignment, then create a surface profile.', width / 2, graphHeight / 2);
        return;
      }
      const minStation = Math.min(...stations);
      const maxStation = Math.max(...stations);
      const minZ = Math.min(...elevations);
      const maxZ = Math.max(...elevations);
      const padZ = Math.max((maxZ - minZ) * 0.12, 0.5);
      const stationSpan = Math.max(maxStation - minStation, 1);
      const elevationSpan = Math.max(maxZ - minZ, 1);
      const exaggeration = Math.min(40, Math.max(1, (stationSpan / elevationSpan) * 0.45));
      if (fitted.current !== current.state.fitToken) {
        cameraRef.current = fitCamera(
          {
            minX: minStation,
            maxX: maxStation,
            minY: (minZ - padZ) * exaggeration,
            maxY: (maxZ + padZ) * exaggeration,
          },
          width,
          graphHeight,
          0.12,
        );
        fitted.current = current.state.fitToken;
      }
      const camera = cameraRef.current;
      const unit = current.state.unit;
      drawAxes(ctx, camera, width, graphHeight, unit, exaggeration);
      const stroke = (vertices: { station: number; elevation: number | null }[], color: string, widthPx: number) => {
        ctx.beginPath();
        ctx.lineWidth = widthPx;
        ctx.strokeStyle = color;
        let open = false;
        for (const vertex of vertices) {
          if (vertex.elevation === null) {
            open = false;
            continue;
          }
          const screen = worldToScreen(camera, vertex.station, vertex.elevation * exaggeration, width, graphHeight);
          if (!open) {
            ctx.moveTo(screen.x, screen.y);
            open = true;
          } else ctx.lineTo(screen.x, screen.y);
        }
        ctx.stroke();
      };
      for (const profile of profiles) stroke(profile.vertices, profile.color, 2);
      if (design.length > 1) stroke(design, '#f2d48a', 2.4);
      if (superimposed.length > 1 && current.state.superimposed) stroke(superimposed, current.state.superimposed.color, 2);
      const legend = [
        ...profiles.map((profile) => ({ name: profile.name, color: profile.color })),
        ...(design.length > 1 ? [{ name: 'Design profile', color: '#f2d48a' }] : []),
        ...(superimposed.length > 1 && current.state.superimposed ? [{ name: current.state.superimposed.name, color: current.state.superimposed.color }] : []),
      ];
      ctx.font = '12px "IBM Plex Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const legendWidth = 188;
      const legendHeight = 16 + legend.length * 18;
      ctx.fillStyle = 'rgba(16, 18, 22, 0.88)';
      ctx.fillRect(width - legendWidth - 12, 12, legendWidth, legendHeight);
      legend.forEach((row, index) => {
        const y = 28 + index * 18;
        ctx.fillStyle = row.color;
        ctx.fillRect(width - legendWidth, y - 2, 18, 3);
        ctx.fillStyle = '#e7e9ee';
        ctx.fillText(row.name, width - legendWidth + 24, y);
      });
      if (current.state.profileBands) {
        drawBands(ctx, alignment.solved, alignment.record.startStation, sheet?.start ?? minStation, sheet?.end ?? maxStation, design, width, height);
      }
    };

    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(parent);
    const zoomExtents = () => {
      fitted.current = -1;
      draw();
    };
    let original: PlanCamera | null = null;
    if (active) {
      bindView({
        zoomExtents,
        zoomWindow: (a, b) => {
          cameraRef.current = fitCamera(
            { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) },
            parent.clientWidth,
            parent.clientHeight,
            0.08,
          );
          draw();
        },
        zoomScale: (factor) => {
          if (!(factor > 0)) return;
          cameraRef.current = { ...cameraRef.current, scale: cameraRef.current.scale * factor };
          draw();
        },
        zoomPrevious: () => undefined,
        panBy: (a, b) => {
          cameraRef.current = { ...cameraRef.current, cx: cameraRef.current.cx + (a.x - b.x), cy: cameraRef.current.cy + (a.y - b.y) };
          draw();
        },
        panDisplacement: (x, y) => {
          cameraRef.current = { ...cameraRef.current, cx: cameraRef.current.cx - x, cy: cameraRef.current.cy - y };
          draw();
        },
        markOriginal: () => {
          original = { ...cameraRef.current };
        },
        zoomOriginal: () => {
          if (!original) return;
          cameraRef.current = { ...original };
          draw();
        },
        redraw: () => draw(),
      });
    }
    const detach = attachSheetGestures(canvas, {
      getCamera: () => cameraRef.current,
      setCamera: (camera) => {
        cameraRef.current = camera;
      },
      redraw: draw,
      zoomExtents,
    });
    return () => {
      observer.disconnect();
      detach();
      if (active) bindView(null);
    };
  }, [
    active,
    project.activeAlignment,
    project.state.fitToken,
    project.state.unit,
    project.state.view,
    project.state.diagram,
    project.state.profileBands,
    project.state.profileSheetIndex,
    project.state.profileSheetLength,
    project.state.profileSheetOverlap,
    project.state.superimposed,
    project.state.civil.massHaul,
  ]);

  const alignment = project.activeAlignment;
  const sheets =
    alignment && project.state.profileSheetLength
      ? profileSheets(
          alignment.record.startStation,
          alignment.record.startStation + alignment.solved.length,
          project.state.profileSheetLength,
          project.state.profileSheetOverlap,
        )
      : [];
  const sheetIndex = Math.min(project.state.profileSheetIndex, Math.max(0, sheets.length - 1));
  const massHaul = project.state.diagram === 'masshaul' && project.state.civil.massHaul;
  return (
    <div className="graph-pane">
      <canvas ref={canvasRef} className="plan-canvas" aria-label={massHaul ? 'Mass haul diagram' : 'Profile view'} />
      <div className="view-title">
        <strong>{massHaul ? 'Mass haul' : 'Profile'}</strong>
        <span>
          {massHaul
            ? `Free haul ${project.state.civil.massHaul?.freeHaulDistance ?? 0} · ordinate is cumulative volume`
            : alignment
              ? `${alignment.record.name} · station / elevation${sheets[sheetIndex] ? ` · ${formatStation(sheets[sheetIndex].start, project.state.unit)} to ${formatStation(sheets[sheetIndex].end, project.state.unit)}` : ''}`
              : 'No alignment'}
        </span>
        {massHaul && (
          <button type="button" onClick={() => project.setDiagram('profile')}>
            Profile
          </button>
        )}
        {!massHaul && sheets.length > 1 && (
          <>
            <button type="button" onClick={() => project.stepProfileSheet(-1)} disabled={sheetIndex <= 0} aria-label="Previous profile sheet">
              Prev
            </button>
            <span>
              {sheetIndex + 1} / {sheets.length}
            </span>
            <button type="button" onClick={() => project.stepProfileSheet(1)} disabled={sheetIndex >= sheets.length - 1} aria-label="Next profile sheet">
              Next
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function drawMassHaul(
  ctx: CanvasRenderingContext2D,
  cameraRef: { current: PlanCamera },
  fitted: { current: number },
  fitToken: number,
  width: number,
  height: number,
  haul: { stations: number[]; cumulative: number[]; lobes: { start: number; end: number; chord: number }[]; balanceStations: number[] },
): void {
  const minStation = haul.stations[0];
  const maxStation = haul.stations[haul.stations.length - 1];
  const minVolume = Math.min(0, ...haul.cumulative);
  const maxVolume = Math.max(0, ...haul.cumulative);
  const stationSpan = Math.max(maxStation - minStation, 1);
  const volumeSpan = Math.max(maxVolume - minVolume, 1);
  const exaggeration = (stationSpan / volumeSpan) * 0.55;
  if (fitted.current !== fitToken) {
    cameraRef.current = fitCamera(
      {
        minX: minStation,
        maxX: maxStation,
        minY: (minVolume - volumeSpan * 0.08) * exaggeration,
        maxY: (maxVolume + volumeSpan * 0.08) * exaggeration,
      },
      width,
      height,
      0.12,
    );
    fitted.current = fitToken;
  }
  const camera = cameraRef.current;
  const zero = worldToScreen(camera, minStation, 0, width, height).y;
  ctx.beginPath();
  ctx.moveTo(worldToScreen(camera, minStation, 0, width, height).x, zero);
  ctx.lineTo(worldToScreen(camera, maxStation, 0, width, height).x, zero);
  ctx.strokeStyle = '#3c4658';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  haul.stations.forEach((station, index) => {
    const screen = worldToScreen(camera, station, haul.cumulative[index] * exaggeration, width, height);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.strokeStyle = '#e0b15a';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#8fd0b3';
  ctx.lineWidth = 1.4;
  for (const lobe of haul.lobes) {
    ctx.beginPath();
    const a = worldToScreen(camera, lobe.start, lobe.chord * exaggeration, width, height);
    const b = worldToScreen(camera, lobe.end, lobe.chord * exaggeration, width, height);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = '11px "IBM Plex Sans", sans-serif';
  ctx.fillStyle = '#8b95a8';
  ctx.textAlign = 'left';
  ctx.fillText('Cut is positive · fill is negative · dashed line is the free-haul chord', 16, height - 18);
}

function drawBands(
  ctx: CanvasRenderingContext2D,
  solved: SolvedAlignment,
  startStation: number,
  from: number,
  to: number,
  design: { station: number; elevation: number | null }[],
  width: number,
  height: number,
): void {
  const top = height - 78;
  const rows = [
    { label: 'Station', y: top + 8 },
    { label: 'Elevation', y: top + 30 },
    { label: 'Geometry', y: top + 52 },
  ];
  ctx.fillStyle = 'rgba(16, 18, 22, 0.94)';
  ctx.fillRect(0, top - 6, width, height - top + 6);
  ctx.strokeStyle = '#2a3548';
  ctx.strokeRect(48, top - 4, width - 60, 70);
  ctx.font = '11px "IBM Plex Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#8b95a8';
  for (const row of rows) ctx.fillText(row.label, 8, row.y);
  const xAt = (station: number) => 56 + ((station - from) / Math.max(to - from, 1)) * (width - 76);
  const cells = geometryBand(solved, startStation).filter(
    (cell) => cell.to > from && cell.from < to,
  );
  ctx.textAlign = 'center';
  ctx.fillStyle = '#d5dbe6';
  for (const cell of cells) {
    const left = Math.max(from, cell.from);
    const right = Math.min(to, cell.to);
    const mid = (left + right) / 2;
    ctx.fillText(cell.label, xAt(mid), rows[2].y);
    ctx.fillText(formatStation(left, 'm'), xAt(left), rows[0].y);
  }
  const known = design.filter((sample) => sample.elevation !== null && sample.station >= from && sample.station <= to);
  if (known.length > 0) {
    const mid = known[Math.floor(known.length / 2)];
    ctx.fillText(mid.elevation === null ? '' : formatElevation(mid.elevation), xAt(mid.station), rows[1].y);
  }
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  camera: PlanCamera,
  width: number,
  height: number,
  unit: 'm' | 'ft',
  exaggeration: number,
): void {
  const minX = camera.cx - width / 2 / camera.scale;
  const maxX = camera.cx + width / 2 / camera.scale;
  const minY = camera.cy - height / 2 / camera.scale;
  const maxY = camera.cy + height / 2 / camera.scale;
  const stationStep = niceStep((maxX - minX) / 8);
  const elevationStep = niceStep((maxY - minY) / exaggeration / 6);
  ctx.lineWidth = 1;
  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let station = Math.ceil(minX / stationStep) * stationStep; station <= maxX; station += stationStep) {
    const x = worldToScreen(camera, station, 0, width, height).x;
    ctx.beginPath();
    ctx.moveTo(x, 28);
    ctx.lineTo(x, height - 22);
    ctx.strokeStyle = '#1e2736';
    ctx.stroke();
    ctx.fillStyle = '#8b95a8';
    ctx.fillText(formatStation(station, unit), x, height - 18);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const minElevation = minY / exaggeration;
  const maxElevation = maxY / exaggeration;
  for (let elevation = Math.ceil(minElevation / elevationStep) * elevationStep; elevation <= maxElevation; elevation += elevationStep) {
    const y = worldToScreen(camera, 0, elevation * exaggeration, width, height).y;
    if (y < 24 || y > height - 24) continue;
    ctx.beginPath();
    ctx.moveTo(58, y);
    ctx.lineTo(width - 12, y);
    ctx.strokeStyle = '#2a3548';
    ctx.stroke();
    ctx.fillStyle = '#8b95a8';
    ctx.fillText(formatElevation(elevation), 8, y);
  }
}
