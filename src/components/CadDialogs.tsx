import { useEffect, useRef, useState } from 'react';
import { ensureLibrary, standardDimStyle, type DimStyle } from '../engine/cadLibrary';
import type { DrawDimension } from '../engine/cadShapes';
import { dimensionGeometry, formatDimension } from '../engine/dimension';
import {
  closeDialog,
  currentDialog,
  getDrawingModel,
  submitDialogText,
  subscribeCommandUi,
} from '../commands/runtime';

const TABS = ['Lines', 'Symbols and Arrows', 'Text', 'Fit', 'Primary Units', 'Alternate Units', 'Tolerances'] as const;

const FIELDS: Record<(typeof TABS)[number], (keyof DimStyle)[]> = {
  Lines: ['dimclrd', 'dimclre', 'dimlwd', 'dimlwe', 'dimdli', 'dimexo', 'dimexe', 'dimsd1', 'dimsd2', 'dimse1', 'dimse2', 'dimdle'],
  'Symbols and Arrows': ['dimasz', 'dimblk', 'dimcen'],
  Text: ['dimtxt', 'dimclrt', 'dimtad', 'dimjust', 'dimgap', 'dimtih', 'dimtoh', 'dimtxsty'],
  Fit: ['dimatfit', 'dimtix', 'dimtofl', 'dimscale', 'dimtmove', 'annotative'],
  'Primary Units': ['dimlunit', 'dimdec', 'dimdsep', 'dimpost', 'dimzin', 'dimlfac'],
  'Alternate Units': ['dimalt', 'dimaltf', 'dimaltd', 'dimapost', 'dimaltu'],
  Tolerances: ['dimtol', 'dimlim', 'dimtp', 'dimtm', 'dimtfac', 'dimtolj', 'dimtdec'],
};

export function CadDialogs() {
  const [dialog, setDialog] = useState(currentDialog());
  const [rev, setRev] = useState(0);
  useEffect(() => subscribeCommandUi(() => setDialog(currentDialog())), []);
  if (!dialog) return null;
  const bump = () => setRev((value) => value + 1);
  return (
    <div className="cad-modal" role="presentation">
      {dialog === 'dimstyle' ? <DimStyleManager rev={rev} bump={bump} /> : <SimpleDialog kind={dialog} bump={bump} />}
    </div>
  );
}

function DimStyleManager({ rev, bump }: { rev: number; bump: () => void }) {
  const model = getDrawingModel();
  const library = ensureLibrary(model.doc);
  const [name, setName] = useState(library.currentDimStyle);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Lines');
  const [fresh, setFresh] = useState('');
  const style = library.dimStyles.find((item) => item.name === name) ?? library.dimStyles[0];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!style || !canvasRef.current) return;
    paintDimPreview(canvasRef.current, style, library.annotationScale);
  }, [style, rev, library.annotationScale, tab]);
  if (!style) return null;
  const setField = (key: keyof DimStyle, value: string) => {
    const current = style[key];
    if (!model.doc.library) return;
    model.checkpoint();
    if (typeof current === 'boolean') (style as unknown as Record<string, boolean>)[key] = value === 'true' || value === 'on';
    else if (typeof current === 'number') (style as unknown as Record<string, number>)[key] = Number(value);
    else (style as unknown as Record<string, string>)[key] = value;
    model.emit();
    bump();
  };
  return (
    <section className="cad-dialog dim-manager" role="dialog" aria-label="Dimension Style Manager" data-dialog="dimstyle">
      <header>
        <h2>Dimension Style Manager</h2>
        <button type="button" onClick={() => closeDialog()}>Close</button>
      </header>
      <div className="dim-style-row">
        <label>
          Styles
          <select aria-label="Dimension styles" value={style.name} onChange={(event) => setName(event.target.value)}>
            {library.dimStyles.map((item) => <option key={item.name}>{item.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => { library.currentDimStyle = style.name; model.emit(); bump(); }}>Set Current</button>
        <input aria-label="New style name" value={fresh} placeholder="New style" onChange={(event) => setFresh(event.target.value)} />
        <button
          type="button"
          onClick={() => {
            const nextName = fresh.trim();
            if (!nextName) return;
            model.checkpoint();
            library.dimStyles.push({ ...standardDimStyle(), ...style, name: nextName });
            library.currentDimStyle = nextName;
            setName(nextName);
            setFresh('');
            model.emit();
            bump();
          }}
        >
          New
        </button>
      </div>
      <div className="dim-tabs" role="tablist">
        {TABS.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </div>
      <div className="dim-body">
        <div className="dim-fields">
          {FIELDS[tab].map((key) => (
            <label key={key}>
              {key}
              {typeof style[key] === 'boolean' ? (
                <input type="checkbox" checked={Boolean(style[key])} onChange={(event) => setField(key, event.target.checked ? 'true' : 'false')} />
              ) : (
                <input value={String(style[key])} onChange={(event) => setField(key, event.target.value)} />
              )}
            </label>
          ))}
        </div>
        <canvas ref={canvasRef} className="dim-preview" width={420} height={220} aria-label="Dimension style preview" />
      </div>
    </section>
  );
}

function paintDimPreview(canvas: HTMLCanvasElement, style: DimStyle, annotationScale: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0b0d11';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const sample: DrawDimension = {
    id: 'preview',
    type: 'dimension',
    layer: '0',
    color: 'bylayer',
    kind: 'linear',
    style: style.name,
    p1: { x: 8, y: 18, z: 0 },
    p2: { x: 72, y: 18, z: 0 },
    p3: { x: 8, y: 18, z: 0 },
    loc: { x: 40, y: 42, z: 0 },
    text: '',
    textAngle: 0,
    oblique: 0,
    measurement: 64,
    horizontal: true,
    jog: false,
    inspection: null,
    breaks: [],
    overrides: {},
    assoc: [],
    offset: 24,
    justify: 'center',
    civil: '',
    textShift: null,
  };
  const geom = dimensionGeometry(sample, style, annotationScale);
  const mapX = (x: number) => 36 + x * 4.4;
  const mapY = (y: number) => 180 - y * 2.4;
  ctx.strokeStyle = '#d5dbe6';
  ctx.fillStyle = '#d5dbe6';
  ctx.lineWidth = 1.25;
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    ctx.beginPath();
    ctx.moveTo(mapX(a.x), mapY(a.y));
    ctx.lineTo(mapX(b.x), mapY(b.y));
    ctx.stroke();
  };
  if (!style.dimse1) line(geom.ext1[0], geom.ext1[1]);
  if (!style.dimse2) line(geom.ext2[0], geom.ext2[1]);
  line(geom.dim[0], geom.dim[1]);
  for (const arrow of geom.arrows) {
    ctx.beginPath();
    ctx.moveTo(mapX(arrow[0].x), mapY(arrow[0].y));
    ctx.lineTo(mapX(arrow[1].x), mapY(arrow[1].y));
    ctx.lineTo(mapX(arrow[2].x), mapY(arrow[2].y));
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#f2d48a';
  ctx.font = '13px IBM Plex Sans, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(formatDimension(sample, style), mapX(geom.textPoint.x), mapY(geom.textPoint.y));
  ctx.fillStyle = '#8b93a7';
  ctx.font = '11px IBM Plex Sans, sans-serif';
  ctx.fillText(`${style.name}  DIMSCALE ${style.dimscale}  DIMDEC ${style.dimdec}`, canvas.width / 2, 18);
}

function SimpleDialog({ kind, bump }: { kind: NonNullable<ReturnType<typeof currentDialog>>; bump: () => void }) {
  const model = getDrawingModel();
  const library = ensureLibrary(model.doc);
  const [text, setText] = useState('');
  const title: Record<typeof kind, string> = {
    dimstyle: 'Dimension Style',
    insert: 'Insert',
    groups: 'Group Manager',
    mtext: 'Multiline Text',
    table: 'Table',
    battman: 'Block Attribute Manager',
    style: 'Text Style',
    mleaderstyle: 'Multileader Style',
    block: 'Block Definition',
  };
  return (
    <section className="cad-dialog" role="dialog" aria-label={title[kind]} data-dialog={kind}>
      <header>
        <h2>{title[kind]}</h2>
        <button type="button" onClick={() => closeDialog()}>Close</button>
      </header>
      {kind === 'mtext' && (
        <textarea aria-label="Multiline text" value={text} placeholder={'Use \\P for a new paragraph, \\B1; bold, \\I1; italic'} onChange={(event) => setText(event.target.value)} />
      )}
      {(kind === 'block' || kind === 'style' || kind === 'insert') && (
        <input aria-label="Name" value={text} placeholder="Name" onChange={(event) => setText(event.target.value)} />
      )}
      {kind === 'insert' && (
        <ul className="cad-list">
          {library.blocks.map((block) => <li key={block.name}>{block.name}</li>)}
          {library.blocks.length === 0 && <li>No blocks defined.</li>}
        </ul>
      )}
      {kind === 'groups' && (
        <ul className="cad-list">
          {library.groups.map((group) => <li key={group.name}>{group.name} · {group.ids.length} objects · {group.selectable ? 'selectable' : 'not selectable'}</li>)}
          {library.groups.length === 0 && <li>No groups.</li>}
        </ul>
      )}
      {kind === 'battman' && (
        <ul className="cad-list">
          {library.blocks.flatMap((block) => block.entities.filter((entity) => (entity as { type?: string }).type === 'attdef').map((entity) => {
            const def = entity as { tag?: string; prompt?: string };
            return <li key={`${block.name}-${def.tag}`}>{block.name} · {def.tag} · {def.prompt}</li>;
          }))}
        </ul>
      )}
      {kind === 'mleaderstyle' && (
        <label>
          Arrow size
          <input
            type="number"
            value={library.leaderStyles[0]?.arrowSize ?? 2.5}
            onChange={(event) => {
              if (!library.leaderStyles[0]) return;
              model.checkpoint();
              library.leaderStyles[0].arrowSize = Number(event.target.value);
              model.emit();
              bump();
            }}
          />
        </label>
      )}
      {kind === 'table' && <p>Enter rows and columns at the command line, or use Import to paste CSV.</p>}
      {kind === 'style' && (
        <ul className="cad-list">
          {library.textStyles.map((item) => <li key={item.name}>{item.name} · {item.font}</li>)}
        </ul>
      )}
      <footer>
        <button
          type="button"
          onClick={() => {
            if (text.trim()) submitDialogText(text.trim());
            else closeDialog();
          }}
        >
          OK
        </button>
      </footer>
    </section>
  );
}
