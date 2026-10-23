import { useEffect, useMemo, useState } from 'react';
import { applyAssembly, civilCommand, type CommandArgs } from '../engine';
import { useProject } from '../state/store';

const SAMPLE_BOOK = `100,50120,10090,103.2,CL1 B
101,50128,10140,103.6,CL1
102,50120,10190,103.1,CL1 E
103,50112,10090,103.0,EP1 B
104,50112,10190,102.8,EP1 E`;

const DEFAULTS: Record<string, Record<string, string>> = {
  CREATEPOINTS: { mode: 'grid', description: 'GS', columns: '6', rows: '4', interval: '20', offset: '0', segments: '4' },
  CREATEPOINTGROUP: { name: 'All points', description: '*', addToSurface: '' },
  TRAVERSEEDITOR: { method: 'compass', courses: '90,100\n180,100\n270,100\n0,100.2' },
  IMPORTSURVEYDATA: { text: SAMPLE_BOOK },
  CREATEPARCELFROMOBJECTS: { mode: 'rectangle', name: 'Lot 1' },
  CREATEFEATURELINES: { mode: 'alignment', name: 'ETW', offset: '0', interval: '10', grade: '-0.02' },
  CREATEGRADING: { side: 'left', cutSlope: '2', fillSlope: '3' },
  CREATEOFFSETALIGNMENT: { offset: '6' },
  CALCULATESUPERELEVATION: { speed: '60', emax: '6', laneWidth: '3.6', crown: '2' },
  CREATEPROFILEFROMCORRIDOR: { code: '' },
  CREATECORRIDOR: { name: '', frequency: '10' },
  CREATEMASSHAULDIAGRAM: { freeHaul: '50' },
  CREATEINTERSECTION: { laneWidth: '3.6', radius: '8', leg: '50' },
  CREATEASSEMBLY: { name: 'Lane-Shoulder-Daylight', laneWidth: '3.6', laneSlope: '-2', shoulderWidth: '1.5', shoulderSlope: '-4', depth: '0.15', cutSlope: '2', fillSlope: '3' },
  CREATEPIPENETWORK: { name: 'Storm', interval: '40', offset: '8', diameter: '0.45', slope: '0.5', manning: '0.013', flow: '0.02', minCover: '1' },
  CREATEPRESSURENETWORK: { name: 'Water', diameter: '0.2', hazenWilliams: '140', demand: '0.01', head: '40' },
  CREATEMULTIPLEPROFILEVIEW: { sheetLength: '80', overlap: '10' },
  SUPERIMPOSEPROFILE: { offset: '6' },
  CREATEQUICKPROFILE: { mode: 'across', interval: '5' },
};

export function CommandPanel() {
  const project = useProject();
  const command = project.state.command;
  const spec = command ? civilCommand(command) : undefined;
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    setFields(command ? { ...(DEFAULTS[command] ?? {}) } : {});
  }, [command]);

  const assemblyPreview = useMemo(() => {
    if (command !== 'CREATEASSEMBLY') return null;
    const laneWidth = numberOf(fields.laneWidth, 3.6);
    const shoulderWidth = numberOf(fields.shoulderWidth, 1.5);
    return applyAssembly(
      {
        id: 'preview',
        name: 'preview',
        left: [],
        right: [
          { kind: 'lane', name: 'Lane', width: laneWidth, slope: numberOf(fields.laneSlope, -2) / 100, depth: numberOf(fields.depth, 0.15) },
          { kind: 'shoulder', name: 'Shoulder', width: shoulderWidth, slope: numberOf(fields.shoulderSlope, -4) / 100, depth: numberOf(fields.depth, 0.15) },
          { kind: 'daylight', name: 'Daylight', cutSlope: numberOf(fields.cutSlope, 2), fillSlope: numberOf(fields.fillSlope, 3), maxWidth: 12 },
        ],
      },
      { centerElevation: 2, egAt: () => 0 },
    );
  }, [command, fields]);

  if (!command || !spec) return null;

  const set = (key: string, value: string) => setFields((current) => ({ ...current, [key]: value }));

  const run = (extra: CommandArgs = {}) => {
    const args: CommandArgs = { ...extra };
    for (const [key, value] of Object.entries(fields)) {
      if (value === '' || key in extra) continue;
      if (key === 'addToSurface') {
        args[key] = value === 'yes';
        continue;
      }
      if (key === 'emax' || key === 'crown') {
        args[key] = numberOf(value, 0) / 100;
        continue;
      }
      if (key === 'slope' && command === 'CREATEPIPENETWORK') {
        args[key] = numberOf(value, 0.5) / 100;
        continue;
      }
      const numeric = Number(value);
      args[key] = value.trim() !== '' && Number.isFinite(numeric) && !/^[A-Za-z]/.test(value) && key !== 'name' && key !== 'description' && key !== 'text' && key !== 'courses' && key !== 'code' && key !== 'mode' && key !== 'method' && key !== 'side' ? numeric : value;
    }
    project.runCommand(command, args);
  };

  return (
    <aside className="command-panel" role="dialog" aria-labelledby="command-title">
      <header>
        <div>
          <p>{spec.command}</p>
          <h2 id="command-title">{spec.label}</h2>
        </div>
        <button type="button" onClick={() => project.dismissCommand()} aria-label="Close command">
          Close
        </button>
      </header>
      <p className="command-hint">{spec.hint}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        {command === 'CREATEPOINTS' && (
          <>
            <Select label="Method" value={fields.mode ?? 'grid'} onChange={(value) => set('mode', value)} options={[['grid', 'Grid on the surface'], ['alignment', 'Along the alignment'], ['interpolate', 'Interpolate between two points'], ['manual', 'Type one point']]} />
            <Field label="Description" value={fields.description ?? ''} onChange={(value) => set('description', value)} />
            {fields.mode === 'grid' && (
              <div className="command-row">
                <Field label="Columns" value={fields.columns ?? ''} onChange={(value) => set('columns', value)} />
                <Field label="Rows" value={fields.rows ?? ''} onChange={(value) => set('rows', value)} />
              </div>
            )}
            {fields.mode === 'alignment' && (
              <div className="command-row">
                <Field label="Interval" value={fields.interval ?? ''} onChange={(value) => set('interval', value)} />
                <Field label="Offset, + right" value={fields.offset ?? ''} onChange={(value) => set('offset', value)} />
              </div>
            )}
            {fields.mode === 'interpolate' && <Field label="Segments" value={fields.segments ?? ''} onChange={(value) => set('segments', value)} />}
            {fields.mode === 'manual' && (
              <div className="command-row">
                <Field label="Easting" value={fields.easting ?? ''} onChange={(value) => set('easting', value)} />
                <Field label="Northing" value={fields.northing ?? ''} onChange={(value) => set('northing', value)} />
                <Field label="Elevation" value={fields.elevation ?? ''} onChange={(value) => set('elevation', value)} />
              </div>
            )}
          </>
        )}
        {command === 'CREATEPOINTGROUP' && (
          <>
            <Field label="Name" value={fields.name ?? ''} onChange={(value) => set('name', value)} />
            <Field label="Description (* and ?)" value={fields.description ?? ''} onChange={(value) => set('description', value)} />
            <div className="command-row">
              <Field label="Min elevation" value={fields.minElevation ?? ''} onChange={(value) => set('minElevation', value)} />
              <Field label="Max elevation" value={fields.maxElevation ?? ''} onChange={(value) => set('maxElevation', value)} />
            </div>
            <label className="command-check">
              <input type="checkbox" checked={fields.addToSurface === 'yes'} onChange={(event) => set('addToSurface', event.target.checked ? 'yes' : '')} />
              Add the group to a new surface
            </label>
          </>
        )}
        {command === 'TRAVERSEEDITOR' && (
          <>
            <Select label="Adjustment" value={fields.method ?? 'compass'} onChange={(value) => set('method', value)} options={[['compass', 'Compass (Bowditch)'], ['transit', 'Transit'], ['none', 'Unadjusted']]} />
            <Area label="Azimuth, distance" value={fields.courses ?? ''} onChange={(value) => set('courses', value)} />
          </>
        )}
        {command === 'IMPORTSURVEYDATA' && <Area label="Field book" value={fields.text ?? ''} onChange={(value) => set('text', value)} />}
        {command === 'CREATEPARCELFROMOBJECTS' && (
          <>
            <Field label="Name" value={fields.name ?? ''} onChange={(value) => set('name', value)} />
            <Select label="From" value={fields.mode ?? 'rectangle'} onChange={(value) => set('mode', value)} options={[['rectangle', 'Rectangle inside the surface'], ['boundary', 'Active surface boundary'], ['feature', 'Closed feature line'], ['draw', 'Click the corners']]} />
          </>
        )}
        {command === 'CREATEFEATURELINES' && (
          <>
            <Select label="From" value={fields.mode ?? 'alignment'} onChange={(value) => set('mode', value)} options={[['alignment', 'Along the alignment'], ['grade', 'Set a grade on the last line'], ['draw', 'Click the vertices']]} />
            {fields.mode !== 'grade' && <Field label="Name" value={fields.name ?? ''} onChange={(value) => set('name', value)} />}
            {fields.mode === 'alignment' && (
              <div className="command-row">
                <Field label="Offset, + right" value={fields.offset ?? ''} onChange={(value) => set('offset', value)} />
                <Field label="Interval" value={fields.interval ?? ''} onChange={(value) => set('interval', value)} />
              </div>
            )}
            {fields.mode === 'grade' && <Field label="Grade, rise/run" value={fields.grade ?? ''} onChange={(value) => set('grade', value)} />}
          </>
        )}
        {command === 'CREATEGRADING' && (
          <>
            <Select label="Side" value={fields.side ?? 'left'} onChange={(value) => set('side', value)} options={[['left', 'Left'], ['right', 'Right'], ['both', 'Both']]} />
            <div className="command-row">
              <Field label="Cut slope H:V" value={fields.cutSlope ?? ''} onChange={(value) => set('cutSlope', value)} />
              <Field label="Fill slope H:V" value={fields.fillSlope ?? ''} onChange={(value) => set('fillSlope', value)} />
            </div>
          </>
        )}
        {command === 'CREATEOFFSETALIGNMENT' && <Field label="Offset, + right" value={fields.offset ?? ''} onChange={(value) => set('offset', value)} />}
        {command === 'CALCULATESUPERELEVATION' && (
          <>
            <div className="command-row">
              <Field label="Design speed, km/h" value={fields.speed ?? ''} onChange={(value) => set('speed', value)} />
              <Field label="e max %" value={fields.emax ?? ''} onChange={(value) => set('emax', value)} />
            </div>
            <div className="command-row">
              <Field label="Lane width" value={fields.laneWidth ?? ''} onChange={(value) => set('laneWidth', value)} />
              <Field label="Normal crown %" value={fields.crown ?? ''} onChange={(value) => set('crown', value)} />
            </div>
          </>
        )}
        {command === 'CREATEPROFILEFROMCORRIDOR' && <Field label="Feature code" value={fields.code ?? ''} onChange={(value) => set('code', value)} />}
        {command === 'CREATECORRIDOR' && (
          <div className="command-row">
            <Field label="Name" value={fields.name ?? ''} onChange={(value) => set('name', value)} />
            <Field label="Frequency" value={fields.frequency ?? ''} onChange={(value) => set('frequency', value)} />
          </div>
        )}
        {command === 'CREATEMASSHAULDIAGRAM' && <Field label="Free haul distance" value={fields.freeHaul ?? ''} onChange={(value) => set('freeHaul', value)} />}
        {command === 'CREATEINTERSECTION' && (
          <div className="command-row">
            <Field label="Lane width" value={fields.laneWidth ?? ''} onChange={(value) => set('laneWidth', value)} />
            <Field label="Curb return radius" value={fields.radius ?? ''} onChange={(value) => set('radius', value)} />
          </div>
        )}
        {command === 'CREATEASSEMBLY' && (
          <>
            <Field label="Name" value={fields.name ?? ''} onChange={(value) => set('name', value)} />
            <div className="command-row">
              <Field label="Lane width" value={fields.laneWidth ?? ''} onChange={(value) => set('laneWidth', value)} />
              <Field label="Lane slope %" value={fields.laneSlope ?? ''} onChange={(value) => set('laneSlope', value)} />
            </div>
            <div className="command-row">
              <Field label="Shoulder width" value={fields.shoulderWidth ?? ''} onChange={(value) => set('shoulderWidth', value)} />
              <Field label="Shoulder slope %" value={fields.shoulderSlope ?? ''} onChange={(value) => set('shoulderSlope', value)} />
            </div>
            <div className="command-row">
              <Field label="Depth" value={fields.depth ?? ''} onChange={(value) => set('depth', value)} />
              <Field label="Cut H:V" value={fields.cutSlope ?? ''} onChange={(value) => set('cutSlope', value)} />
              <Field label="Fill H:V" value={fields.fillSlope ?? ''} onChange={(value) => set('fillSlope', value)} />
            </div>
            {assemblyPreview && <AssemblySketch links={assemblyPreview.links.filter((link) => link.code === 'Top' || link.code === 'Daylight')} />}
          </>
        )}
        {command === 'CREATEPIPENETWORK' && (
          <>
            <Field label="Name" value={fields.name ?? ''} onChange={(value) => set('name', value)} />
            <div className="command-row">
              <Field label="Structure interval" value={fields.interval ?? ''} onChange={(value) => set('interval', value)} />
              <Field label="Offset, + right" value={fields.offset ?? ''} onChange={(value) => set('offset', value)} />
            </div>
            <div className="command-row">
              <Field label="Diameter" value={fields.diameter ?? ''} onChange={(value) => set('diameter', value)} />
              <Field label="Slope %" value={fields.slope ?? ''} onChange={(value) => set('slope', value)} />
              <Field label="Manning n" value={fields.manning ?? ''} onChange={(value) => set('manning', value)} />
            </div>
            <div className="command-row">
              <Field label="Design flow" value={fields.flow ?? ''} onChange={(value) => set('flow', value)} />
              <Field label="Minimum cover" value={fields.minCover ?? ''} onChange={(value) => set('minCover', value)} />
            </div>
          </>
        )}
        {command === 'CREATEPRESSURENETWORK' && (
          <>
            <Field label="Name" value={fields.name ?? ''} onChange={(value) => set('name', value)} />
            <div className="command-row">
              <Field label="Diameter" value={fields.diameter ?? ''} onChange={(value) => set('diameter', value)} />
              <Field label="Hazen-Williams C" value={fields.hazenWilliams ?? ''} onChange={(value) => set('hazenWilliams', value)} />
            </div>
            <div className="command-row">
              <Field label="Total demand" value={fields.demand ?? ''} onChange={(value) => set('demand', value)} />
              <Field label="Reservoir head" value={fields.head ?? ''} onChange={(value) => set('head', value)} />
            </div>
          </>
        )}
        {command === 'CREATEMULTIPLEPROFILEVIEW' && (
          <div className="command-row">
            <Field label="Sheet length" value={fields.sheetLength ?? ''} onChange={(value) => set('sheetLength', value)} />
            <Field label="Overlap" value={fields.overlap ?? ''} onChange={(value) => set('overlap', value)} />
          </div>
        )}
        {command === 'SUPERIMPOSEPROFILE' && <Field label="Offset to project, + right" value={fields.offset ?? ''} onChange={(value) => set('offset', value)} />}
        {command === 'CREATEQUICKPROFILE' && (
          <>
            <Select label="Line" value={fields.mode ?? 'across'} onChange={(value) => set('mode', value)} options={[['across', 'West to east through the surface'], ['draw', 'Click a line']]} />
            <Field label="Sample interval" value={fields.interval ?? ''} onChange={(value) => set('interval', value)} />
          </>
        )}
        <div className="command-actions">
          <button type="submit" className="primary" data-command-run>
            {fields.mode === 'draw' ? 'Start drawing' : 'Run'}
          </button>
          {command === 'CREATEPOINTS' && (
            <button
              type="button"
              onClick={() => {
                project.setTool('point');
                project.dismissCommand();
              }}
            >
              Click on the plan
            </button>
          )}
        </div>
      </form>
      {project.state.commandSummary && <pre className="command-summary">{project.state.commandSummary}</pre>}
    </aside>
  );
}

function numberOf(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <textarea value={value} rows={5} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function AssemblySketch({ links }: { links: { a: { offset: number; elevation: number }; b: { offset: number; elevation: number }; code: string }[] }) {
  if (links.length === 0) return null;
  const points = links.flatMap((link) => [link.a, link.b]);
  const minX = Math.min(...points.map((point) => point.offset));
  const maxX = Math.max(...points.map((point) => point.offset));
  const minY = Math.min(...points.map((point) => point.elevation), 0);
  const maxY = Math.max(...points.map((point) => point.elevation), 2);
  const width = 280;
  const height = 92;
  const pad = 8;
  const sx = (offset: number) => pad + ((offset - minX) / Math.max(maxX - minX, 1)) * (width - pad * 2);
  const sy = (elevation: number) => height - pad - ((elevation - minY) / Math.max(maxY - minY, 0.2)) * (height - pad * 2);
  return (
    <svg className="assembly-sketch" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Assembly section">
      <line x1={pad} y1={sy(0)} x2={width - pad} y2={sy(0)} />
      {links.map((link, index) => (
        <line key={index} x1={sx(link.a.offset)} y1={sy(link.a.elevation)} x2={sx(link.b.offset)} y2={sy(link.b.elevation)} className={link.code === 'Daylight' ? 'daylight' : 'top'} />
      ))}
    </svg>
  );
}
