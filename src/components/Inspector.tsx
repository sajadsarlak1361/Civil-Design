import { useEffect, useState } from 'react';
import { isMeshSurface, meshStatistics, meshToBinaryStl, meshToObj, meshToPly, meshToStl, surfaceStats } from '../engine';
import { downloadBytes, downloadText } from '../lib/download';
import { fileSlug } from '../lib/format';
import { formatNumber, formatSlope, unitLabels } from '../lib/format';
import { useProject } from '../state/store';

export function Inspector() {
  const project = useProject();
  const surface = project.active;
  const units = unitLabels(project.state.unit);
  const mesh = surface ? isMeshSurface(surface) : false;
  const stats = surface && !mesh ? surfaceStats(surface.points, surface.triangles) : null;
  const meshStats = surface && mesh ? meshStatistics(surface.points, surface.triangles) : null;
  const [maxEdge, setMaxEdge] = useState('');

  useEffect(() => {
    setMaxEdge(surface?.maxEdgeLength ? String(surface.maxEdgeLength) : '');
  }, [surface?.id, surface?.maxEdgeLength]);

  const result = project.state.volumeResult;
  const setup = project.state.volumeSetup;

  return (
    <aside className="panel right">
      <div className="panel-head">
        <span>{surface ? surface.name : 'Surface'}</span>
      </div>
      <div className="inspector">
        {surface && (
          <>
            {mesh && surface && (
              <section>
                <h2>3D mesh</h2>
                <label>
                  Description
                  <input
                    value={surface.description ?? ''}
                    onChange={(event) => project.setSurfaceMeta(surface.id, { description: event.target.value })}
                  />
                </label>
                <label>
                  Layer
                  <input value={surface.layer ?? 'MESH'} onChange={(event) => project.setSurfaceMeta(surface.id, { layer: event.target.value })} />
                </label>
                <label>
                  <input type="checkbox" checked={surface.locked === true} onChange={(event) => project.setSurfaceMeta(surface.id, { locked: event.target.checked })} /> Lock
                </label>
                <p className="hint">
                  {surface.layer ? `Layer ${surface.layer}` : 'Layer MESH'}
                  {surface.locked ? ' · locked' : ''}
                  {surface.meshOrient ? ` · normals ${surface.meshOrient}` : ''}
                  {surface.meshRadii && surface.meshRadii.length > 0 ? ` · radii ${surface.meshRadii.map((value) => value.toFixed(3)).join(', ')}` : ''}
                </p>
                <div className="button-row">
                  <button type="button" onClick={() => downloadText(`${fileSlug(surface.name)}.obj`, meshToObj(surface.name, surface.points, surface.triangles), 'model/obj')}>OBJ</button>
                  <button type="button" onClick={() => downloadText(`${fileSlug(surface.name)}.stl`, meshToStl(surface.name, surface.points, surface.triangles), 'model/stl')}>STL</button>
                  <button type="button" onClick={() => downloadBytes(`${fileSlug(surface.name)}.stl`, meshToBinaryStl(surface.points, surface.triangles), 'model/stl')}>STL binary</button>
                  <button type="button" onClick={() => downloadText(`${fileSlug(surface.name)}.ply`, meshToPly(surface.points, surface.triangles), 'model/ply')}>PLY</button>
                </div>
              </section>
            )}
            {!mesh && (
            <section>
              <h2>Build</h2>
              <label>
                Max triangle edge ({units.linear})
                <span className="inline">
                  <input
                    inputMode="decimal"
                    placeholder="none"
                    value={maxEdge}
                    onChange={(event) => setMaxEdge(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const value = maxEdge.trim() === '' ? null : Number(maxEdge);
                      if (value !== null && (!(value > 0) || !Number.isFinite(value))) return;
                      project.applyBuild(surface.id, { maxEdgeLength: value });
                    }}
                  >
                    Apply
                  </button>
                </span>
              </label>
              <div className="button-row">
                <button type="button" className={project.state.tool === 'boundary' ? 'active' : ''} onClick={() => project.setTool('boundary')}>
                  Draw boundary
                </button>
                <button type="button" disabled={!surface.boundary} onClick={() => project.applyBuild(surface.id, { boundary: null })}>
                  Clear
                </button>
              </div>
              <div className="button-row">
                <button type="button" className={project.state.tool === 'breakline' ? 'active' : ''} onClick={() => project.setTool('breakline')}>
                  Draw breakline
                </button>
                <button
                  type="button"
                  disabled={surface.breaklines.length === 0}
                  onClick={() => project.applyBuild(surface.id, { breaklines: [] })}
                >
                  Clear
                </button>
              </div>
              {project.state.tool === 'breakline' && (
                <label>
                  Breakline elevation
                  <input
                    inputMode="decimal"
                    placeholder="From surface"
                    value={project.state.breaklineElevation}
                    onChange={(event) => project.setBreaklineElevation(event.target.value)}
                  />
                </label>
              )}
              <p className="hint">
                Boundary vertices are draped on the current TIN, then enforced as edges. Exterior triangles are removed. A typed breakline elevation holds the whole line level.
              </p>
            </section>
            )}
            <section>
              <h2>Display</h2>
              <div className="checks">
                <label><input type="checkbox" checked={surface.style.showPoints} onChange={(event) => project.updateStyle(surface.id, { showPoints: event.target.checked })} /> Points</label>
                <label><input type="checkbox" checked={surface.style.showTriangles} onChange={(event) => project.updateStyle(surface.id, { showTriangles: event.target.checked })} /> {mesh ? 'Wireframe' : 'Triangles'}</label>
                {!mesh && <label><input type="checkbox" checked={surface.style.showContours} onChange={(event) => project.updateStyle(surface.id, { showContours: event.target.checked })} /> Contours</label>}
                {!mesh && <label><input type="checkbox" checked={surface.style.contourLabels} onChange={(event) => project.updateStyle(surface.id, { contourLabels: event.target.checked })} /> Labels</label>}
              </div>
              <div className="segmented" role="radiogroup" aria-label="Surface coloring">
                <button type="button" className={!surface.style.showElevation && !surface.style.showSlope ? 'active' : ''} onClick={() => project.updateStyle(surface.id, { showElevation: false, showSlope: false })}>Solid</button>
                <button type="button" className={surface.style.showElevation ? 'active' : ''} onClick={() => project.updateStyle(surface.id, { showElevation: true, showSlope: false })}>Elevation</button>
                {!mesh && <button type="button" className={surface.style.showSlope ? 'active' : ''} onClick={() => project.updateStyle(surface.id, { showElevation: false, showSlope: true })}>Slope</button>}
              </div>
              <label>
                Edge color
                <input type="color" value={surface.style.color} onChange={(event) => project.updateStyle(surface.id, { color: event.target.value })} />
              </label>
              {!mesh && <div className="pair">
                <label>
                  Minor ({units.linear})
                  <input
                    inputMode="decimal"
                    value={surface.style.minorInterval}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (value > 0) project.updateStyle(surface.id, { minorInterval: value });
                    }}
                  />
                </label>
                <label>
                  Major ({units.linear})
                  <input
                    inputMode="decimal"
                    value={surface.style.majorInterval}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (value > 0) project.updateStyle(surface.id, { majorInterval: value });
                    }}
                  />
                </label>
              </div>}
              {!mesh && <div className="pair colors">
                <label>
                  Minor color
                  <input type="color" value={surface.style.minorColor} onChange={(event) => project.updateStyle(surface.id, { minorColor: event.target.value })} />
                </label>
                <label>
                  Major color
                  <input type="color" value={surface.style.majorColor} onChange={(event) => project.updateStyle(surface.id, { majorColor: event.target.value })} />
                </label>
              </div>}
            </section>
            {meshStats && (
              <section>
                <h2>Statistics</h2>
                <dl className="stats">
                  <div><dt>Vertices</dt><dd>{meshStats.vertices.toLocaleString()}</dd></div>
                  <div><dt>Triangles</dt><dd>{meshStats.triangles.toLocaleString()}</dd></div>
                  <div><dt>Area 3D</dt><dd>{formatNumber(meshStats.area3D, 1)} {units.area}</dd></div>
                  <div><dt>Boundary edges</dt><dd>{meshStats.boundaryEdges.toLocaleString()}</dd></div>
                  <div><dt>Bounding box</dt><dd>{formatNumber(meshStats.bbox.maxX - meshStats.bbox.minX, 2)} × {formatNumber(meshStats.bbox.maxY - meshStats.bbox.minY, 2)} × {formatNumber(meshStats.bbox.maxZ - meshStats.bbox.minZ, 2)} {units.linear}</dd></div>
                </dl>
              </section>
            )}
            {stats && (
              <section>
                <h2>Statistics</h2>
                <dl className="stats">
                  <div><dt>Points</dt><dd>{stats.pointCount.toLocaleString()}</dd></div>
                  <div><dt>Triangles</dt><dd>{stats.triangleCount.toLocaleString()}</dd></div>
                  <div><dt>Min elevation</dt><dd>{formatNumber(stats.minZ, 3)} {units.linear}</dd></div>
                  <div><dt>Max elevation</dt><dd>{formatNumber(stats.maxZ, 3)} {units.linear}</dd></div>
                  <div><dt>Mean elevation</dt><dd>{formatNumber(stats.meanZ, 3)} {units.linear}</dd></div>
                  <div><dt>Area 2D</dt><dd>{formatNumber(stats.area2D, 1)} {units.area}</dd></div>
                  <div><dt>Area 3D</dt><dd>{formatNumber(stats.area3D, 1)} {units.area}</dd></div>
                  <div><dt>Slope</dt><dd>{formatSlope(stats.minSlope)} – {formatSlope(stats.maxSlope)}</dd></div>
                  <div><dt>Mean slope</dt><dd>{formatSlope(stats.meanSlope)}</dd></div>
                </dl>
              </section>
            )}
          </>
        )}
        <section>
          <h2>Volume</h2>
          <p className="hint">Cut is where the base is above the comparison. Fill is where the comparison is higher. Net = fill − cut.</p>
          <label>
            Base surface
            <select
              value={setup.baseId ?? ''}
              onChange={(event) => project.setVolumeSetup({ baseId: event.target.value || null })}
            >
              <option value="">Select</option>
              {project.state.surfaces.filter((item) => !isMeshSurface(item)).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <div className="segmented" role="radiogroup" aria-label="Volume method">
            <button type="button" className={setup.mode === 'surface' ? 'active' : ''} onClick={() => project.setVolumeSetup({ mode: 'surface' })}>Surface</button>
            <button type="button" className={setup.mode === 'datum' ? 'active' : ''} onClick={() => project.setVolumeSetup({ mode: 'datum' })}>Datum</button>
          </div>
          {setup.mode === 'surface' ? (
            <label>
              Comparison surface
              <select
                value={setup.comparisonId ?? ''}
                onChange={(event) => project.setVolumeSetup({ comparisonId: event.target.value || null })}
              >
                <option value="">Select</option>
                {project.state.surfaces.filter((item) => !isMeshSurface(item)).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Datum elevation ({units.linear})
              <input
                inputMode="decimal"
                value={setup.datum}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) project.setVolumeSetup({ datum: value });
                }}
              />
            </label>
          )}
          <button type="button" className="primary wide" disabled={project.state.volumeBusy} onClick={() => project.runVolume()}>
            {project.state.volumeBusy ? 'Computing…' : 'Compute volume'}
          </button>
          {result && (
            <>
              <dl className="stats">
                <div><dt>Cut</dt><dd className="cut">{formatNumber(result.cut, 1)} {units.volume}</dd></div>
                <div><dt>Fill</dt><dd className="fill">{formatNumber(result.fill, 1)} {units.volume}</dd></div>
                <div><dt>Net (fill − cut)</dt><dd>{formatNumber(result.net, 1)} {units.volume}</dd></div>
                <div><dt></dt><dd>{result.net >= 0 ? 'Net fill' : 'Net cut'} {formatNumber(Math.abs(result.net), 1)}</dd></div>
                <div><dt>Cut area</dt><dd>{formatNumber(result.cutArea, 1)} {units.area}</dd></div>
                <div><dt>Fill area</dt><dd>{formatNumber(result.fillArea, 1)} {units.area}</dd></div>
                {units.yards && (
                  <>
                    <div><dt>Cut</dt><dd>{formatNumber(result.cut / 27, 1)} {units.yards}</dd></div>
                    <div><dt>Fill</dt><dd>{formatNumber(result.fill / 27, 1)} {units.yards}</dd></div>
                  </>
                )}
              </dl>
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={project.state.showVolumeMap}
                  onChange={(event) => project.setShowVolumeMap(event.target.checked)}
                />
                Show cut/fill map
              </label>
              <p className="hint">TIN-to-TIN volume covers only the plan overlap. The map saturates at the 90th percentile depth.</p>
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
