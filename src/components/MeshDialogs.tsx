import { useMemo, useState } from 'react';
import { getDrawingModel } from '../commands/runtime';
import {
  circleDesign,
  filterPointGroup,
  horseshoeDesign,
  parsePointFile,
  stationsInRange,
  type DesignPoint,
  type SurveyPoint,
} from '../engine';
import { useProject } from '../state/store';

export function MeshCreateDialog({ onClose }: { onClose: () => void }) {
  const project = useProject();
  const [name, setName] = useState('Tunnel mesh');
  const [description, setDescription] = useState('');
  const [layer, setLayer] = useState('MESH');
  const [color, setColor] = useState('#79b8ff');
  const [locked, setLocked] = useState(false);
  const [source, setSource] = useState('file');
  const [groupId, setGroupId] = useState(project.state.civil.pointGroups[0]?.id ?? '');
  const [radiiText, setRadiiText] = useState('auto');
  const [orient, setOrient] = useState<'auto' | 'outward' | 'toward-axis'>('auto');
  const [maxEdge, setMaxEdge] = useState('');
  const [fillHoles, setFillHoles] = useState('0');
  const [filePoints, setFilePoints] = useState<SurveyPoint[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  const points = useMemo(() => collectPoints(source, project, groupId, filePoints), [source, project, groupId, filePoints]);

  const build = () => {
    if (!points || points.length < 3) {
      setError('Choose at least three points.');
      return;
    }
    const radii = parseRadii(radiiText);
    if (radii === 'invalid') {
      setError('Radii must be “auto” or a list of positive lengths.');
      return;
    }
    const edge = maxEdge.trim() === '' ? null : Number(maxEdge);
    if (edge !== null && !(edge > 0)) {
      setError('Max edge length must be a positive number.');
      return;
    }
    const holes = Number(fillHoles);
    if (!Number.isFinite(holes) || holes < 0) {
      setError('Hole fill must be zero, or the longest loop to close.');
      return;
    }
    project.addMesh({
      name,
      description,
      layer,
      color,
      locked,
      points,
      radii,
      orient,
      maxEdgeLength: edge,
      fillHoles: Math.round(holes),
    });
    onClose();
  };

  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-labelledby="mesh-create-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2 id="mesh-create-title">3D mesh</h2>
          <p>Ball pivoting. Points stay where the scan put them.</p>
        </header>
        <div className="modal-body">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Description
            <input value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="pair">
            <label>
              Layer
              <input value={layer} onChange={(event) => setLayer(event.target.value)} />
            </label>
            <label>
              Color
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            </label>
          </div>
          <label>
            <input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} /> Lock
          </label>
          <label>
            Points
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="file">Point file (XYZ, CSV)</option>
              <option value="cogo">COGO points</option>
              <option value="group">Point group</option>
              <option value="drawing">Selected drawing points</option>
              <option value="surface">Active surface points</option>
            </select>
          </label>
          {source === 'group' && (
            <label>
              Point group
              <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                {project.state.civil.pointGroups.length === 0 && <option value="">No point groups</option>}
                {project.state.civil.pointGroups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
          )}
          {source === 'file' && (
            <label>
              File
              <input
                type="file"
                accept=".csv,.txt,.xyz,.las,.laz"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  const lower = file.name.toLowerCase();
                  if (lower.endsWith('.las') || lower.endsWith('.laz')) {
                    setFilePoints(null);
                    setFileName(file.name);
                    setError('LAS and LAZ are not supported. Export the scan to XYZ or CSV.');
                    return;
                  }
                  void file.text().then((text) => {
                    const parsed = parsePointFile(text);
                    setFileName(file.name);
                    setFilePoints(parsed.points);
                    setError(parsed.points.length < 3 ? 'That file did not contain enough points.' : '');
                  });
                }}
              />
            </label>
          )}
          <p className="hint">{fileName ? `${fileName} · ` : ''}{points ? `${points.length.toLocaleString()} points` : 'No points yet'}</p>
          <label>
            Ball radii
            <input value={radiiText} onChange={(event) => setRadiiText(event.target.value)} placeholder="auto or 0.5, 1, 2" />
          </label>
          <label>
            Normals
            <select value={orient} onChange={(event) => setOrient(event.target.value as 'auto' | 'outward' | 'toward-axis')}>
              <option value="auto">Auto (tunnel axis when the cloud is a tube)</option>
              <option value="toward-axis">Toward the tunnel axis</option>
              <option value="outward">Outward from the centroid</option>
            </select>
          </label>
          <div className="pair">
            <label>
              Max edge
              <input value={maxEdge} placeholder="none" onChange={(event) => setMaxEdge(event.target.value)} />
            </label>
            <label>
              Fill holes up to
              <input value={fillHoles} onChange={(event) => setFillHoles(event.target.value)} />
            </label>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={build} disabled={project.state.meshBusy}>Build mesh</button>
        </footer>
      </div>
    </div>
  );
}

export function MeshSectionDialog({ onClose }: { onClose: () => void }) {
  const project = useProject();
  const meshes = project.state.surfaces.filter((surface) => surface.kind === 'mesh');
  const [surfaceId, setSurfaceId] = useState(meshes.find((surface) => surface.id === project.state.activeId)?.id ?? meshes[0]?.id ?? '');
  const [alignmentId, setAlignmentId] = useState(project.state.activeAlignmentId ?? project.state.alignments[0]?.id ?? '');
  const [mode, setMode] = useState<'single' | 'interval' | 'line'>('single');
  const [station, setStation] = useState('0');
  const [from, setFrom] = useState('0');
  const [to, setTo] = useState('20');
  const [interval, setInterval] = useState('5');
  const [designMode, setDesignMode] = useState<'none' | 'circle' | 'horseshoe' | 'text' | 'polyline'>('none');
  const [radius, setRadius] = useState('2');
  const [centerOffset, setCenterOffset] = useState('0');
  const [centerZ, setCenterZ] = useState('0');
  const [width, setWidth] = useState('4');
  const [wall, setWall] = useState('1.5');
  const [designText, setDesignText] = useState('');
  const [place3d, setPlace3d] = useState(true);
  const [error, setError] = useState('');

  const run = () => {
    if (!surfaceId) {
      setError('Create a 3D mesh first.');
      return;
    }
    const design = resolveDesign(designMode, radius, centerOffset, centerZ, width, wall, designText);
    if (design === 'invalid') {
      setError('The design section needs a closed ring of offset, elevation pairs.');
      return;
    }
    const polyline = designMode === 'polyline' ? selectedPolyline() : null;
    if (designMode === 'polyline' && !polyline) {
      setError('Select a closed polyline to use as the design section.');
      return;
    }
    const common = {
      surfaceId,
      alignmentId: alignmentId || null,
      design: designMode === 'polyline' ? null : design,
      designPolyline: polyline,
      place3d,
    };
    if (mode === 'line') {
      project.beginSectionLine(common);
      onClose();
      return;
    }
    if (!alignmentId) {
      setError('Select an alignment, or pick a section line.');
      return;
    }
    let stations: number[] = [];
    if (mode === 'single') {
      const value = Number(station);
      if (!Number.isFinite(value)) {
        setError('Station must be a number.');
        return;
      }
      stations = [value];
    } else {
      const start = Number(from);
      const end = Number(to);
      const step = Number(interval);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !(step > 0)) {
        setError('Station range needs a start, an end, and a positive interval.');
        return;
      }
      stations = stationsInRange(start, end, step);
    }
    project.runMeshSections({ ...common, stations, line: null });
    onClose();
  };

  return (
    <div className="modal-back" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-labelledby="mesh-section-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2 id="mesh-section-title">Mesh section</h2>
          <p>A plane perpendicular to the alignment, or a picked section line.</p>
        </header>
        <div className="modal-body">
          <label>
            3D mesh
            <select value={surfaceId} onChange={(event) => setSurfaceId(event.target.value)}>
              {meshes.length === 0 && <option value="">No 3D mesh</option>}
              {meshes.map((surface) => (
                <option key={surface.id} value={surface.id}>{surface.name}</option>
              ))}
            </select>
          </label>
          <label>
            Alignment
            <select value={alignmentId} onChange={(event) => setAlignmentId(event.target.value)}>
              <option value="">None</option>
              {project.state.alignments.map((alignment) => (
                <option key={alignment.id} value={alignment.id}>{alignment.name}</option>
              ))}
            </select>
          </label>
          <div className="segmented" role="radiogroup" aria-label="Section mode">
            <button type="button" className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}>Station</button>
            <button type="button" className={mode === 'interval' ? 'active' : ''} onClick={() => setMode('interval')}>Interval</button>
            <button type="button" className={mode === 'line' ? 'active' : ''} onClick={() => setMode('line')}>Pick line</button>
          </div>
          {mode === 'single' && (
            <label>
              Station
              <input value={station} onChange={(event) => setStation(event.target.value)} />
            </label>
          )}
          {mode === 'interval' && (
            <div className="pair">
              <label>
                From
                <input value={from} onChange={(event) => setFrom(event.target.value)} />
              </label>
              <label>
                To
                <input value={to} onChange={(event) => setTo(event.target.value)} />
              </label>
              <label>
                Interval
                <input value={interval} onChange={(event) => setInterval(event.target.value)} />
              </label>
            </div>
          )}
          <label>
            Design section
            <select value={designMode} onChange={(event) => setDesignMode(event.target.value as typeof designMode)}>
              <option value="none">None</option>
              <option value="circle">Circle</option>
              <option value="horseshoe">Horseshoe</option>
              <option value="text">Offset, elevation list</option>
              <option value="polyline">Selected closed polyline</option>
            </select>
          </label>
          {designMode === 'circle' && (
            <div className="pair">
              <label>Radius<input value={radius} onChange={(event) => setRadius(event.target.value)} /></label>
              <label>Offset<input value={centerOffset} onChange={(event) => setCenterOffset(event.target.value)} /></label>
              <label>Elevation<input value={centerZ} onChange={(event) => setCenterZ(event.target.value)} /></label>
            </div>
          )}
          {designMode === 'horseshoe' && (
            <div className="pair">
              <label>Width<input value={width} onChange={(event) => setWidth(event.target.value)} /></label>
              <label>Wall height<input value={wall} onChange={(event) => setWall(event.target.value)} /></label>
              <label>Invert elevation<input value={centerZ} onChange={(event) => setCenterZ(event.target.value)} /></label>
            </div>
          )}
          {designMode === 'text' && (
            <label>
              One offset, elevation pair per line
              <textarea rows={5} value={designText} onChange={(event) => setDesignText(event.target.value)} placeholder={'-2, 100\n0, 102\n2, 100'} />
            </label>
          )}
          <label>
            <input type="checkbox" checked={place3d} onChange={(event) => setPlace3d(event.target.checked)} /> Draw 3D polylines in the model
          </label>
          {error && <p className="error">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={run}>Cut sections</button>
        </footer>
      </div>
    </div>
  );
}

function collectPoints(
  source: string,
  project: ReturnType<typeof useProject>,
  groupId: string,
  filePoints: SurveyPoint[] | null,
): SurveyPoint[] | null {
  if (source === 'file') return filePoints;
  if (source === 'cogo') return project.state.civil.points.map(asSurvey);
  if (source === 'group') {
    const group = project.state.civil.pointGroups.find((item) => item.id === groupId);
    if (!group) return [];
    return filterPointGroup(project.state.civil.points, group).map(asSurvey);
  }
  if (source === 'drawing') {
    const model = getDrawingModel();
    const selected = new Set(model.doc.selection);
    const picked: SurveyPoint[] = [];
    for (const entity of model.doc.entities) {
      if (entity.type !== 'point') continue;
      if (selected.size > 0 && !selected.has(entity.id)) continue;
      picked.push({ x: entity.p.x, y: entity.p.y, z: entity.p.z, role: 'survey' });
    }
    return picked;
  }
  const surface = project.active ?? project.state.surfaces[0];
  if (!surface) return [];
  const cloud = surface.sourcePoints.length > 0 ? surface.sourcePoints : surface.points;
  return cloud.map((point) => ({ x: point.x, y: point.y, z: point.z, role: 'survey' as const }));
}

function asSurvey(point: { x: number; y: number; z: number; number: number; description: string }): SurveyPoint {
  return { x: point.x, y: point.y, z: point.z, number: String(point.number), description: point.description, role: 'survey' };
}

function parseRadii(text: string): number[] | null | 'invalid' {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed || trimmed === 'auto') return null;
  const values = trimmed.split(/[,;\s]+/).map(Number);
  if (values.length === 0 || values.some((value) => !(value > 0))) return 'invalid';
  return values;
}

function resolveDesign(
  mode: string,
  radius: string,
  offset: string,
  elevation: string,
  width: string,
  wall: string,
  text: string,
): DesignPoint[] | null | 'invalid' {
  if (mode === 'none' || mode === 'polyline') return null;
  if (mode === 'circle') {
    const r = Number(radius);
    const o = Number(offset);
    const z = Number(elevation);
    if (!(r > 0) || !Number.isFinite(o) || !Number.isFinite(z)) return 'invalid';
    return circleDesign(r, o, z);
  }
  if (mode === 'horseshoe') {
    const w = Number(width);
    const h = Number(wall);
    const z = Number(elevation);
    if (!(w > 0) || !(h >= 0) || !Number.isFinite(z)) return 'invalid';
    return horseshoeDesign(w, h).map((point) => ({ offset: point.offset, z: point.z + z }));
  }
  const pairs: DesignPoint[] = [];
  for (const line of text.split(/\r?\n/)) {
    const bits = line.split(/[,;\s]+/).map((bit) => bit.trim()).filter(Boolean);
    if (bits.length === 0) continue;
    if (bits.length < 2) return 'invalid';
    const o = Number(bits[0]);
    const z = Number(bits[1]);
    if (!Number.isFinite(o) || !Number.isFinite(z)) return 'invalid';
    pairs.push({ offset: o, z });
  }
  return pairs.length >= 3 ? pairs : 'invalid';
}

function selectedPolyline(): { x: number; y: number; z: number }[] | null {
  const model = getDrawingModel();
  const selected = new Set(model.doc.selection);
  const poly = model.doc.entities.find((entity) => entity.type === 'polyline' && entity.closed && entity.vertices.length >= 3 && selected.has(entity.id));
  if (!poly || poly.type !== 'polyline') return null;
  return poly.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y, z: vertex.z }));
}
