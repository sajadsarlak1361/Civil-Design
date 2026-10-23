import { useEffect, useRef } from 'react';
import { bindView } from '../commands/runtime';
import { formatStation, meshSectionCsv, type MeshCrossSection } from '../engine';
import { downloadText } from '../lib/download';
import { formatElevation, formatNumber } from '../lib/format';
import { useProject, type SectionSheet } from '../state/store';
import { fitCamera, panBy, type PlanCamera } from '../view/camera';
import { attachSheetGestures } from '../view/gestureDom';

export function SectionCanvas({ active = true }: { active?: boolean }) {
  const project = useProject();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<PlanCamera>({ cx: 0, cy: 0, scale: 1 });
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
      const camera = cameraRef.current;
      if (camera.cx === 0 && camera.cy === 0) {
        camera.cx = width / 2;
        camera.cy = height / 2;
      }
      ctx.setTransform(
        dpr * camera.scale,
        0,
        0,
        dpr * camera.scale,
        dpr * (width / 2 - camera.cx * camera.scale),
        dpr * (height / 2 - camera.cy * camera.scale),
      );
      ctx.clearRect(camera.cx - width / 2 / camera.scale, camera.cy - height / 2 / camera.scale, width / camera.scale, height / camera.scale);
      ctx.fillStyle = '#0b0d11';
      ctx.fillRect(0, 0, width, height);
      const unit = current.state.unit;
      const mesh = current.state.meshSections;
      if (mesh && mesh.sections.length > 0) {
        const shown =
          current.state.sectionLayout === 'multiple'
            ? mesh.sections
            : [mesh.sections[Math.min(current.state.sectionIndex, mesh.sections.length - 1)]];
        const columns = shown.length === 1 ? 1 : shown.length <= 2 ? shown.length : shown.length <= 4 ? 2 : 4;
        const rows = Math.ceil(shown.length / columns);
        const cellW = width / columns;
        const cellH = height / rows;
        shown.forEach((section, index) => {
          const column = index % columns;
          const row = Math.floor(index / columns);
          drawMeshCell(ctx, section, mesh.design, column * cellW, row * cellH, cellW, cellH, unit, shown.length === 1);
        });
        return;
      }
      const alignment = current.activeAlignment;
      const sections = alignment?.sections ?? [];
      if (!alignment || sections.length === 0) {
        ctx.fillStyle = '#9aa3b5';
        ctx.font = '14px "IBM Plex Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Create sample lines on an alignment that crosses a surface.', width / 2, height / 2);
        return;
      }
      const shown =
        current.state.sectionLayout === 'multiple'
          ? sections
          : [sections[Math.min(current.state.sectionIndex, sections.length - 1)]];
      const columns = shown.length === 1 ? 1 : shown.length <= 2 ? shown.length : shown.length <= 4 ? 2 : 4;
      const rows = Math.ceil(shown.length / columns);
      const cellW = width / columns;
      const cellH = height / rows;
      shown.forEach((section, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        drawCell(ctx, section, column * cellW, row * cellH, cellW, cellH, unit, shown.length === 1);
      });
    };
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(parent);
    const zoomExtents = () => {
      cameraRef.current = { cx: parent.clientWidth / 2, cy: parent.clientHeight / 2, scale: 1 };
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
        panScreen: (direction) => {
          const width = parent.clientWidth;
          const height = parent.clientHeight;
          const dx = direction === 'left' ? width * 0.2 : direction === 'right' ? -width * 0.2 : 0;
          const dy = direction === 'up' ? height * 0.2 : direction === 'down' ? -height * 0.2 : 0;
          cameraRef.current = panBy(cameraRef.current, dx, dy, true);
          draw();
        },
        redraw: () => draw(),
      });
    }
    const detach = attachSheetGestures(canvas, {
      yDown: true,
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
  }, [active, project.activeAlignment, project.state.meshSections, project.state.sectionIndex, project.state.sectionLayout, project.state.unit, project.state.view]);

  const mesh = project.state.meshSections;
  const meshCount = mesh?.sections.length ?? 0;
  const alignment = project.activeAlignment;
  const count = meshCount > 0 ? meshCount : alignment?.sections.length ?? 0;
  const index = Math.min(project.state.sectionIndex, Math.max(0, count - 1));
  const station = meshCount > 0 ? mesh?.sections[index]?.station : alignment?.sections[index]?.station;
  const multiple = project.state.sectionLayout === 'multiple';

  return (
    <div className="graph-pane">
      <canvas ref={canvasRef} className="plan-canvas" aria-label="Section view" />
      <div className="view-title">
        <strong>{multiple ? 'Section views' : 'Section'}</strong>
        <span>
          {meshCount > 0
            ? multiple
              ? `${meshCount} mesh sections`
              : `Mesh section · ${station === undefined ? '—' : formatStation(station, project.state.unit)}`
            : alignment
              ? multiple
                ? `${alignment.record.name} · ${count} sample lines`
                : `${alignment.record.name} · ${station === undefined ? '—' : formatStation(station, project.state.unit)}`
              : 'No alignment'}
        </span>
        {meshCount > 0 && mesh && (
          <button
            type="button"
            onClick={() => downloadText('mesh-sections.csv', meshSectionCsv(mesh.sections), 'text/csv')}
          >
            CSV
          </button>
        )}
        {meshCount > 0 && (
          <button type="button" onClick={() => project.clearMeshSections()}>
            Clear
          </button>
        )}
        {alignment?.sections[0]?.surfaces.map((surface) => (
          <i key={surface.surfaceId} className="swatch-label">
            <b style={{ background: surface.color }} />
            {surface.name}
          </i>
        ))}
      </div>
      {!multiple && count > 0 && (
        <div className="section-nav">
          <button type="button" onClick={() => project.stepSection(-1)} disabled={index <= 0}>
            Previous
          </button>
          <span>
            {index + 1} / {count}
          </span>
          <button type="button" onClick={() => project.stepSection(1)} disabled={index >= count - 1}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function drawMeshCell(
  ctx: CanvasRenderingContext2D,
  section: MeshCrossSection,
  design: { offset: number; z: number }[] | null,
  x: number,
  y: number,
  width: number,
  height: number,
  unit: 'm' | 'ft',
  large: boolean,
): void {
  const padL = large ? 64 : 36;
  const padR = large ? 150 : 12;
  const padT = large ? 28 : 22;
  const padB = large ? 28 : 18;
  const plotW = Math.max(10, width - padL - padR);
  const plotH = Math.max(10, height - padT - padB);
  const offsets: number[] = [];
  const elevations: number[] = [];
  for (const loop of section.loops) {
    for (const point of loop.points) {
      offsets.push(point.offset);
      elevations.push(point.z);
    }
  }
  if (design) {
    for (const point of design) {
      offsets.push(point.offset);
      elevations.push(point.z);
    }
  }
  ctx.save();
  ctx.strokeStyle = '#243044';
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = '#e7e9ee';
  ctx.font = `${large ? 13 : 11}px "IBM Plex Sans", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(formatStation(section.station, unit), x + 8, y + 6);
  if (offsets.length === 0) {
    ctx.fillStyle = '#9aa3b5';
    ctx.fillText('No intersection', x + 8, y + 24);
    ctx.restore();
    return;
  }
  const minOffset = Math.min(...offsets);
  const maxOffset = Math.max(...offsets);
  const minZ = Math.min(...elevations);
  const maxZ = Math.max(...elevations);
  const spanX = Math.max(maxOffset - minOffset, 1e-6);
  const spanZ = Math.max(maxZ - minZ, 1e-6);
  const mapX = (offset: number) => x + padL + ((offset - minOffset) / spanX) * plotW;
  const mapY = (elevation: number) => y + padT + ((maxZ + spanZ * 0.08 - elevation) / (spanZ * 1.16)) * plotH;
  const fillRing = (points: { offset: number; z: number }[], color: string) => {
    if (points.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(mapX(points[0].offset), mapY(points[0].z));
    for (let i = 1; i < points.length; i++) ctx.lineTo(mapX(points[i].offset), mapY(points[i].z));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  if (section.comparison) {
    for (const region of section.comparison.overbreak) fillRing(region.points, 'rgba(224, 122, 61, 0.55)');
    for (const region of section.comparison.underbreak) fillRing(region.points, 'rgba(61, 125, 214, 0.55)');
  }
  ctx.lineWidth = large ? 1.6 : 1;
  ctx.strokeStyle = '#e7e9ee';
  ctx.setLineDash([]);
  for (const loop of section.loops) {
    if (loop.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(mapX(loop.points[0].offset), mapY(loop.points[0].z));
    for (let i = 1; i < loop.points.length; i++) ctx.lineTo(mapX(loop.points[i].offset), mapY(loop.points[i].z));
    if (loop.closed) ctx.closePath();
    ctx.stroke();
  }
  if (design && design.length >= 2) {
    ctx.strokeStyle = '#f0d78c';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(mapX(design[0].offset), mapY(design[0].z));
    for (let i = 1; i < design.length; i++) ctx.lineTo(mapX(design[i].offset), mapY(design[i].z));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (large) {
    const comparison = section.comparison;
    const lines = [
      `Area ${formatNumber(section.area, 2)}`,
      `Perimeter ${formatNumber(section.perimeter, 2)}`,
      `Centroid ${formatNumber(section.centroid.offset, 2)}, ${formatNumber(section.centroid.z, 2)}`,
      comparison ? `Overbreak ${formatNumber(comparison.overbreakArea, 2)}  max ${formatNumber(comparison.maxOverbreak, 3)}` : 'As-built only',
      comparison ? `Underbreak ${formatNumber(comparison.underbreakArea, 2)}  max ${formatNumber(comparison.maxUnderbreak, 3)}` : `${section.loops.length} loop${section.loops.length === 1 ? '' : 's'}`,
    ];
    ctx.fillStyle = '#c5cedd';
    ctx.font = '12px "IBM Plex Sans", sans-serif';
    lines.forEach((line, lineIndex) => ctx.fillText(line, x + width - padR + 8, y + padT + lineIndex * 16));
  }
  ctx.restore();
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  section: SectionSheet,
  x: number,
  y: number,
  width: number,
  height: number,
  unit: 'm' | 'ft',
  large: boolean,
): void {
  const padL = large ? 64 : 36;
  const padR = 12;
  const padT = large ? 36 : 22;
  const padB = large ? 28 : 18;
  const plotW = Math.max(10, width - padL - padR);
  const plotH = Math.max(10, height - padT - padB);
  const samples = section.surfaces.flatMap((surface) => surface.samples);
  const offsets = samples.map((sample) => sample.offset);
  const elevations = samples.map((sample) => sample.elevation).filter((value): value is number => value !== null);
  ctx.save();
  ctx.strokeStyle = '#243044';
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.fillStyle = '#e7e9ee';
  ctx.font = `${large ? 13 : 11}px "IBM Plex Sans", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(formatStation(section.station, unit), x + 8, y + 6);
  if (elevations.length === 0 || offsets.length === 0) {
    ctx.fillStyle = '#9aa3b5';
    ctx.fillText('Outside the surface', x + 8, y + 24);
    ctx.restore();
    return;
  }
  const minOffset = Math.min(...offsets);
  const maxOffset = Math.max(...offsets);
  const minZ = Math.min(...elevations);
  const maxZ = Math.max(...elevations);
  const spanZ = Math.max(maxZ - minZ, 1);
  const spanX = Math.max(maxOffset - minOffset, 1);
  const mapX = (offset: number) => x + padL + ((offset - minOffset) / spanX) * plotW;
  const mapY = (elevation: number) => y + padT + ((maxZ + spanZ * 0.15 - elevation) / (spanZ * 1.3)) * plotH;
  ctx.strokeStyle = '#2a3548';
  ctx.beginPath();
  ctx.moveTo(mapX(0), y + padT);
  ctx.lineTo(mapX(0), y + padT + plotH);
  ctx.stroke();
  ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = '#8b95a8';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatElevation(maxZ), x + padL - 6, mapY(maxZ));
  ctx.fillText(formatElevation(minZ), x + padL - 6, mapY(minZ));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${minOffset.toFixed(0)}`, mapX(minOffset), y + height - padB + 4);
  ctx.fillText(`${maxOffset.toFixed(0)}`, mapX(maxOffset), y + height - padB + 4);
  section.surfaces.forEach((surface, surfaceIndex) => {
    ctx.beginPath();
    ctx.strokeStyle = surface.color;
    ctx.lineWidth = large ? 2 : 1.5;
    let open = false;
    for (const sample of surface.samples) {
      if (sample.elevation === null) {
        open = false;
        continue;
      }
      const sx = mapX(sample.offset);
      const sy = mapY(sample.elevation);
      if (!open) {
        ctx.moveTo(sx, sy);
        open = true;
      } else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    if (large) {
      ctx.fillStyle = surface.color;
      ctx.fillRect(x + width - 150, y + 8 + surfaceIndex * 16, 16, 3);
      ctx.font = '12px "IBM Plex Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#e7e9ee';
      ctx.fillText(surface.name, x + width - 128, y + 10 + surfaceIndex * 16);
    }
  });
  ctx.restore();
}
