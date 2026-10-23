import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ensureLibrary } from '../engine/cadLibrary';
import { primeCommand } from '../commands/prime';
import { getDrawingModel, runCommand, subscribeDrawing } from '../commands/runtime';
import { RibbonIcon } from './RibbonIcon';
import { ribbonSlots } from './ribbonSlots';

interface Tool {
  label: string;
  hint: string;
  command: string;
  prime?: string;
}

export function DraftPanels({ names }: { names: readonly string[] }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeDrawing(() => bump((value) => value + 1)), []);
  const library = ensureLibrary(getDrawingModel().doc);
  const layers = getDrawingModel().doc.layers.map((layer) => layer.name);
  const show = (title: string) => names.includes(title);
  return (
    <>
      <HomePanels names={names} />
      {show('Dimensions') && (
        <DimensionPanel libraryName={library.currentDimStyle} styles={library.dimStyles.map((style) => style.name)} dimLayer={library.dimLayer} layers={layers} />
      )}
      {show('Text') && <TextPanel />}
      {show('Leaders') && <LeaderPanel />}
      {show('Tables') && <TablePanel />}
      {show('Markup') && <MarkupPanel />}
      {ribbonSlots(show('Dimensions') ? 'annotate' : 'home').map((slot) => (
        <section key={slot.id} className="ribbon-panel" aria-label={slot.title} data-panel={slot.title} ref={(node) => { if (node && node.childElementCount === 0) node.appendChild(slot.render()); }} />
      ))}
    </>
  );
}

function HomePanels({ names }: { names: readonly string[] }) {
  const show = (title: string) => names.includes(title);
  return (
    <>
      {show('Draw') && <Panel title="Draw" extra={[
        { label: 'Boundary', hint: 'BOUNDARY', command: 'BOUNDARY' },
        { label: 'Region', hint: 'REGION', command: 'REGION' },
        { label: 'Divide', hint: 'DIVIDE', command: 'DIVIDE' },
        { label: 'Measure', hint: 'MEASURE', command: 'MEASURE' },
        { label: 'Construction Line', hint: 'XLINE', command: 'XLINE' },
        { label: 'Ray', hint: 'RAY', command: 'RAY' },
        { label: 'Revision Cloud', hint: 'REVCLOUD', command: 'REVCLOUD' },
        { label: 'Donut', hint: 'DONUT', command: 'DONUT' },
        { label: 'Wipeout', hint: 'WIPEOUT', command: 'WIPEOUT' },
      ]}>
        <Split label="Line" command="LINE" hint="Line" items={[{ label: 'Line', hint: 'LINE', command: 'LINE' }]} />
        <Split label="Polyline" command="PLINE" hint="Polyline with arc, width, and length" items={[{ label: 'Polyline', hint: 'Arc, Halfwidth, Length, Width', command: 'PLINE' }]} />
        <Split label="Circle" command="CIRCLE" hint="Center, radius" items={[
          { label: 'Center, Radius', hint: 'CIRCLE', command: 'CIRCLE' },
          { label: 'Center, Diameter', hint: 'CIRCLEDIA', command: 'CIRCLEDIA' },
          { label: '2-Point', hint: 'CIRCLE2P', command: 'CIRCLE2P' },
          { label: '3-Point', hint: 'CIRCLE3P', command: 'CIRCLE3P' },
          { label: 'Tan, Tan, Radius', hint: 'CIRCLETTR', command: 'CIRCLETTR' },
          { label: 'Tan, Tan, Tan', hint: 'CIRCLETTT', command: 'CIRCLETTT' },
        ]} />
        <Split label="Arc" command="ARC" hint="3-point arc" items={[
          { label: '3-Point', hint: 'ARC', command: 'ARC' },
          { label: 'Start, Center, End', hint: 'ARCSCE', command: 'ARCSCE' },
          { label: 'Start, Center, Angle', hint: 'ARCSCA', command: 'ARCSCA' },
          { label: 'Start, Center, Length', hint: 'ARCSCL', command: 'ARCSCL' },
          { label: 'Start, End, Angle', hint: 'ARCSEA', command: 'ARCSEA' },
          { label: 'Start, End, Direction', hint: 'ARCSED', command: 'ARCSED' },
          { label: 'Start, End, Radius', hint: 'ARCSER', command: 'ARCSER' },
          { label: 'Center, Start, End', hint: 'ARCCSE', command: 'ARCCSE' },
          { label: 'Center, Start, Angle', hint: 'ARCCSA', command: 'ARCCSA' },
          { label: 'Center, Start, Length', hint: 'ARCCSL', command: 'ARCCSL' },
          { label: 'Continue', hint: 'ARCCONT', command: 'ARCCONT' },
        ]} />
        <Col>
          <Split size="sm" label="Rectangle" command="RECTANG" hint="Two corners" items={[
            { label: 'Rectangle', hint: 'RECTANG', command: 'RECTANG' },
            { label: 'Chamfer', hint: 'RECTCHAMFER', command: 'RECTCHAMFER' },
            { label: 'Fillet', hint: 'RECTFILLET', command: 'RECTFILLET' },
            { label: 'Area', hint: 'RECTAREA', command: 'RECTAREA' },
            { label: 'Dimensions', hint: 'RECTDIMS', command: 'RECTDIMS' },
            { label: 'Rotation', hint: 'RECTROT', command: 'RECTROT' },
            { label: 'Width', hint: 'RECTWIDTH', command: 'RECTWIDTH' },
          ]} />
          <Split size="sm" label="Polygon" command="POLYGON" hint="Inscribed polygon" items={[{ label: 'Polygon', hint: 'POLYGON', command: 'POLYGON' }]} />
          <Split size="sm" label="Ellipse" command="ELLIPSE" hint="Axis, end" items={[
            { label: 'Axis, End', hint: 'ELLIPSE', command: 'ELLIPSE' },
            { label: 'Center', hint: 'ELLIPSEC', command: 'ELLIPSEC' },
            { label: 'Elliptical Arc', hint: 'ELLIPSEA', command: 'ELLIPSEA' },
          ]} />
        </Col>
        <Col>
          <Split size="sm" label="Spline" command="SPLINE" hint="Fit points" items={[
            { label: 'Fit', hint: 'SPLINE', command: 'SPLINE' },
            { label: 'Control Vertices', hint: 'SPLINECV', command: 'SPLINECV' },
          ]} />
          <Split size="sm" label="Hatch" command="HATCH" hint="Pick a closed boundary" items={[{ label: 'Hatch', hint: 'HATCH', command: 'HATCH' }, { label: 'Hatch Edit', hint: 'HATCHEDIT', command: 'HATCHEDIT' }]} />
          <Split size="sm" label="Point" command="POINT" hint="Single point" items={[{ label: 'Point', hint: 'POINT', command: 'POINT' }, { label: 'Multiple Points', hint: 'POINTM', command: 'POINTM' }]} />
        </Col>
      </Panel>}
      {show('Modify') && <Panel title="Modify" extra={[
        { label: 'Blend Curves', hint: 'BLEND', command: 'BLEND' },
        { label: 'Explode', hint: 'EXPLODE', command: 'EXPLODE' },
        { label: 'Stretch', hint: 'STRETCH', command: 'STRETCH' },
        { label: 'Break', hint: 'BREAK', command: 'BREAK' },
        { label: 'Break at Point', hint: 'BREAKATPOINT', command: 'BREAKATPOINT' },
        { label: 'Join', hint: 'JOIN', command: 'JOIN' },
        { label: 'Lengthen', hint: 'LENGTHEN', command: 'LENGTHEN' },
        { label: 'Align', hint: 'ALIGN', command: 'ALIGN' },
        { label: 'Reverse', hint: 'REVERSE', command: 'REVERSE' },
        { label: 'Edit Polyline', hint: 'PEDIT', command: 'PEDIT' },
        { label: 'Edit Spline', hint: 'SPLINEDIT', command: 'SPLINEDIT' },
        { label: 'Overkill', hint: 'OVERKILL', command: 'OVERKILL' },
        { label: 'Draw Order', hint: 'DRAWORDER', command: 'DRAWORDER' },
        { label: 'Text to Front', hint: 'TEXTTOFRONT', command: 'TEXTTOFRONT' },
        { label: 'Hatch to Back', hint: 'HATCHTOBACK', command: 'HATCHTOBACK' },
      ]}>
        <Split label="Move" command="MOVE" hint="Move" items={[{ label: 'Move', hint: 'MOVE', command: 'MOVE' }]} />
        <Split label="Copy" command="COPY" hint="Copy" items={[{ label: 'Copy', hint: 'COPY', command: 'COPY' }]} />
        <Split label="Rotate" command="ROTATE" hint="Rotate" items={[{ label: 'Rotate', hint: 'ROTATE', command: 'ROTATE' }]} />
        <Col>
          <Split size="sm" label="Trim" command="TRIM" hint="Trim" items={[{ label: 'Trim', hint: 'TRIM', command: 'TRIM' }, { label: 'Quick Trim', hint: 'TRIMQUICK', command: 'TRIMQUICK' }]} />
          <Split size="sm" label="Extend" command="EXTEND" hint="Extend" items={[{ label: 'Extend', hint: 'EXTEND', command: 'EXTEND' }, { label: 'Quick Extend', hint: 'EXTENDQUICK', command: 'EXTENDQUICK' }]} />
          <Split size="sm" label="Erase" command="ERASE" hint="Erase" items={[{ label: 'Erase', hint: 'ERASE', command: 'ERASE' }]} />
        </Col>
        <Col>
          <Split size="sm" label="Mirror" command="MIRROR" hint="Mirror" items={[{ label: 'Mirror', hint: 'MIRROR', command: 'MIRROR' }]} />
          <Split size="sm" label="Scale" command="SCALE" hint="Scale, with Reference" items={[{ label: 'Scale', hint: 'SCALE', command: 'SCALE' }]} />
          <Split size="sm" label="Offset" command="OFFSET" hint="Offset" items={[{ label: 'Offset', hint: 'OFFSET', command: 'OFFSET' }]} />
        </Col>
        <Col>
          <Split size="sm" label="Fillet" command="FILLET" hint="Fillet" items={[{ label: 'Fillet', hint: 'FILLET', command: 'FILLET' }]} />
          <Split size="sm" label="Chamfer" command="CHAMFER" hint="Chamfer" items={[{ label: 'Chamfer', hint: 'CHAMFER', command: 'CHAMFER' }]} />
          <Split size="sm" label="Array" command="ARRAYRECT" hint="Rectangular array" items={[
            { label: 'Rectangular', hint: 'ARRAYRECT', command: 'ARRAYRECT' },
            { label: 'Path', hint: 'ARRAYPATH', command: 'ARRAYPATH' },
            { label: 'Polar', hint: 'ARRAYPOLAR', command: 'ARRAYPOLAR' },
            { label: 'Edit Array', hint: 'ARRAYEDIT', command: 'ARRAYEDIT' },
          ]} />
        </Col>
      </Panel>}
      {show('Annotation') && <Panel title="Annotation" extra={[
        { label: 'Station / Offset', hint: 'STATIONLABEL', command: 'STATIONLABEL' },
        { label: 'Slope %', hint: 'SLOPELABEL', command: 'SLOPELABEL' },
      ]}>
        <Split label="Text" command="TEXT" hint="Single-line text" items={[{ label: 'Single Line', hint: 'TEXT', command: 'TEXT' }, { label: 'Multiline', hint: 'MTEXT', command: 'MTEXT' }]} />
        <Split label="Dimension" command="DIM" hint="Smart dimension" items={[
          { label: 'Dimension', hint: 'DIM', command: 'DIM' },
          { label: 'Linear', hint: 'DIMLINEAR', command: 'DIMLINEAR' },
          { label: 'Aligned', hint: 'DIMALIGNED', command: 'DIMALIGNED' },
          { label: 'Angular', hint: 'DIMANGULAR', command: 'DIMANGULAR' },
          { label: 'Arc Length', hint: 'DIMARC', command: 'DIMARC' },
          { label: 'Radius', hint: 'DIMRADIUS', command: 'DIMRADIUS' },
          { label: 'Diameter', hint: 'DIMDIAMETER', command: 'DIMDIAMETER' },
          { label: 'Jogged', hint: 'DIMJOGGED', command: 'DIMJOGGED' },
          { label: 'Ordinate', hint: 'DIMORDINATE', command: 'DIMORDINATE' },
          { label: 'Continue', hint: 'DIMCONTINUE', command: 'DIMCONTINUE' },
          { label: 'Baseline', hint: 'DIMBASELINE', command: 'DIMBASELINE' },
          { label: 'Quick', hint: 'QDIM', command: 'QDIM' },
        ]} />
        <Col>
          <Split size="sm" label="Leader" command="MLEADER" hint="Multileader" items={[
            { label: 'Multileader', hint: 'MLEADER', command: 'MLEADER' },
            { label: 'Add', hint: 'MLEADERADD', command: 'MLEADERADD' },
            { label: 'Remove', hint: 'MLEADERREMOVE', command: 'MLEADERREMOVE' },
            { label: 'Align', hint: 'MLEADERALIGN', command: 'MLEADERALIGN' },
            { label: 'Collect', hint: 'MLEADERCOLLECT', command: 'MLEADERCOLLECT' },
            { label: 'Style', hint: 'MLEADERSTYLE', command: 'MLEADERSTYLE' },
          ]} />
          <Split size="sm" label="Table" command="TABLE" hint="Table" items={[
            { label: 'Table', hint: 'TABLE', command: 'TABLE' },
            { label: 'Import CSV', hint: 'TABLEIMPORT', command: 'TABLEIMPORT' },
            { label: 'Table Style', hint: 'TABLESTYLE', command: 'TABLESTYLE' },
          ]} />
          <Split size="sm" label="Dim Style" command="DIMSTYLE" hint="Dimension style manager" items={[{ label: 'Dimension Style', hint: 'DIMSTYLE', command: 'DIMSTYLE' }]} />
        </Col>
      </Panel>}
      {show('Block') && <Panel title="Block">
        <Split label="Insert" command="INSERT" hint="Insert a block" items={[{ label: 'Insert', hint: 'INSERT', command: 'INSERT' }]} />
        <Split label="Create" command="BLOCK" hint="Create a block" items={[{ label: 'Create Block', hint: 'BLOCK', command: 'BLOCK' }]} />
        <Col>
          <Split size="sm" label="Edit" command="BEDIT" hint="Edit in place" items={[{ label: 'Block Editor', hint: 'BEDIT', command: 'BEDIT' }, { label: 'Close Editor', hint: 'BCLOSE', command: 'BCLOSE' }, { label: 'Write Block', hint: 'WBLOCK', command: 'WBLOCK' }]} />
          <Split size="sm" label="Attribute" command="ATTDEF" hint="Define an attribute" items={[{ label: 'Define Attribute', hint: 'ATTDEF', command: 'ATTDEF' }, { label: 'Edit Attribute', hint: 'ATTEDIT', command: 'ATTEDIT' }, { label: 'Manage', hint: 'BATTMAN', command: 'BATTMAN' }]} />
          <Split size="sm" label="Purge" command="PURGE" hint="Purge unused blocks" items={[{ label: 'Purge', hint: 'PURGE', command: 'PURGE' }]} />
        </Col>
      </Panel>}
      {show('Groups') && <Panel title="Groups">
        <Col>
          <Split size="sm" label="Group" command="GROUP" hint="Named group" items={[{ label: 'Group', hint: 'GROUP', command: 'GROUP' }, { label: 'Ungroup', hint: 'UNGROUP', command: 'UNGROUP' }, { label: 'Group Edit', hint: 'GROUPEDIT', command: 'GROUPEDIT' }, { label: 'Manager', hint: 'CLASSICGROUP', command: 'CLASSICGROUP' }]} />
          <Split size="sm" label="Pickstyle" command="PICKSTYLE" hint="Select the whole group" items={[{ label: 'Group Selection', hint: 'PICKSTYLE', command: 'PICKSTYLE' }, { label: 'Bounding Box', hint: 'GROUPBBOX', command: 'GROUPBBOX' }]} />
        </Col>
      </Panel>}
    </>
  );
}

function TextPanel() {
  return (
    <Panel title="Text">
      <Split label="Text" command="TEXT" hint="Single-line text" items={[{ label: 'Single Line', hint: 'TEXT', command: 'TEXT' }, { label: 'Multiline', hint: 'MTEXT', command: 'MTEXT' }]} />
      <Col>
        <Split size="sm" label="Style" command="STYLE" hint="Text style" items={[{ label: 'Text Style', hint: 'STYLE', command: 'STYLE' }]} />
        <Split size="sm" label="Find" command="FIND" hint="Find and replace" items={[{ label: 'Find', hint: 'FIND', command: 'FIND' }]} />
      </Col>
    </Panel>
  );
}

function LeaderPanel() {
  return (
    <Panel title="Leaders">
      <Split label="Leader" command="MLEADER" hint="Multileader" items={[{ label: 'Multileader', hint: 'MLEADER', command: 'MLEADER' }, { label: 'Add', hint: 'MLEADERADD', command: 'MLEADERADD' }, { label: 'Remove', hint: 'MLEADERREMOVE', command: 'MLEADERREMOVE' }, { label: 'Align', hint: 'MLEADERALIGN', command: 'MLEADERALIGN' }, { label: 'Collect', hint: 'MLEADERCOLLECT', command: 'MLEADERCOLLECT' }, { label: 'Style', hint: 'MLEADERSTYLE', command: 'MLEADERSTYLE' }]} />
    </Panel>
  );
}

function TablePanel() {
  return (
    <Panel title="Tables">
      <Split label="Table" command="TABLE" hint="Table" items={[{ label: 'Table', hint: 'TABLE', command: 'TABLE' }, { label: 'Import CSV', hint: 'TABLEIMPORT', command: 'TABLEIMPORT' }, { label: 'Table Style', hint: 'TABLESTYLE', command: 'TABLESTYLE' }]} />
    </Panel>
  );
}

function MarkupPanel() {
  return (
    <Panel title="Markup">
      <Col>
        <Split size="sm" label="Revcloud" command="REVCLOUD" hint="Revision cloud" items={[{ label: 'Revision Cloud', hint: 'REVCLOUD', command: 'REVCLOUD' }]} />
        <Split size="sm" label="Wipeout" command="WIPEOUT" hint="Mask" items={[{ label: 'Wipeout', hint: 'WIPEOUT', command: 'WIPEOUT' }]} />
        <Split size="sm" label="Station" command="STATIONLABEL" hint="Station and offset" items={[{ label: 'Station / Offset', hint: 'STATIONLABEL', command: 'STATIONLABEL' }, { label: 'Slope %', hint: 'SLOPELABEL', command: 'SLOPELABEL' }]} />
      </Col>
    </Panel>
  );
}

function DimensionPanel({ libraryName, styles, dimLayer, layers }: { libraryName: string; styles: string[]; dimLayer: string; layers: string[] }) {
  const setStyle = (name: string) => {
    const model = getDrawingModel();
    const library = ensureLibrary(model.doc);
    model.checkpoint();
    library.currentDimStyle = name;
    model.emit();
  };
  const setLayer = (name: string) => {
    const model = getDrawingModel();
    const library = ensureLibrary(model.doc);
    model.checkpoint();
    library.dimLayer = name === '.' ? '' : name;
    model.emit();
  };
  return (
    <Panel title="Dimensions">
        <Split label="DIM" command="DIM" hint="Smart dimension" items={[{ label: 'Dimension', hint: 'DIM', command: 'DIM' }]} />
        <Col>
          <Split size="sm" label="Linear" command="DIMLINEAR" hint="Linear" items={[{ label: 'Linear', hint: 'DIMLINEAR', command: 'DIMLINEAR' }]} />
          <Split size="sm" label="Aligned" command="DIMALIGNED" hint="Aligned" items={[{ label: 'Aligned', hint: 'DIMALIGNED', command: 'DIMALIGNED' }]} />
          <Split size="sm" label="Angular" command="DIMANGULAR" hint="Angular" items={[{ label: 'Angular', hint: 'DIMANGULAR', command: 'DIMANGULAR' }]} />
        </Col>
        <Col>
          <Split size="sm" label="Arc Length" command="DIMARC" hint="Arc length" items={[{ label: 'Arc Length', hint: 'DIMARC', command: 'DIMARC' }]} />
          <Split size="sm" label="Radius" command="DIMRADIUS" hint="Radius" items={[{ label: 'Radius', hint: 'DIMRADIUS', command: 'DIMRADIUS' }]} />
          <Split size="sm" label="Diameter" command="DIMDIAMETER" hint="Diameter" items={[{ label: 'Diameter', hint: 'DIMDIAMETER', command: 'DIMDIAMETER' }]} />
        </Col>
        <Col>
          <Split size="sm" label="Jogged" command="DIMJOGGED" hint="Jogged" items={[{ label: 'Jogged', hint: 'DIMJOGGED', command: 'DIMJOGGED' }]} />
          <Split size="sm" label="Ordinate" command="DIMORDINATE" hint="Ordinate" items={[{ label: 'Ordinate', hint: 'DIMORDINATE', command: 'DIMORDINATE' }]} />
          <Split size="sm" label="Continue" command="DIMCONTINUE" hint="Continue" items={[{ label: 'Continue', hint: 'DIMCONTINUE', command: 'DIMCONTINUE' }]} />
        </Col>
        <Col>
          <Split size="sm" label="Baseline" command="DIMBASELINE" hint="Baseline" items={[{ label: 'Baseline', hint: 'DIMBASELINE', command: 'DIMBASELINE' }]} />
          <Split size="sm" label="Quick" command="QDIM" hint="Quick dimension" items={[{ label: 'Quick Dimension', hint: 'QDIM', command: 'QDIM' }]} />
          <Split size="sm" label="Space" command="DIMSPACE" hint="Dimension space" items={[{ label: 'Dimension Space', hint: 'DIMSPACE', command: 'DIMSPACE' }]} />
        </Col>
        <Col>
          <Split size="sm" label="Break" command="DIMBREAK" hint="Dimension break" items={[{ label: 'Dimension Break', hint: 'DIMBREAK', command: 'DIMBREAK' }]} />
          <Split size="sm" label="Inspect" command="DIMINSPECT" hint="Inspection" items={[{ label: 'Inspect', hint: 'DIMINSPECT', command: 'DIMINSPECT' }]} />
          <Split size="sm" label="Jog Line" command="DIMJOGLINE" hint="Jogged linear" items={[{ label: 'Jogged Linear', hint: 'DIMJOGLINE', command: 'DIMJOGLINE' }]} />
        </Col>
        <Col>
          <Split size="sm" label="Center" command="CENTERMARK" hint="Center mark" items={[{ label: 'Center Mark', hint: 'CENTERMARK', command: 'CENTERMARK' }, { label: 'Centerline', hint: 'CENTERLINE', command: 'CENTERLINE' }]} />
          <Split size="sm" label="Oblique" command="DIMEDIT" hint="Oblique" items={[{ label: 'Oblique', hint: 'DIMEDIT', command: 'DIMEDIT' }]} />
          <Split size="sm" label="Text Angle" command="DIMTEDIT" hint="Dimension text" items={[{ label: 'Text Angle', hint: 'DIMTEDIT', command: 'DIMTEDIT' }, { label: 'Left', hint: 'DIMJUSTL', command: 'DIMJUSTL' }, { label: 'Center', hint: 'DIMJUSTC', command: 'DIMJUSTC' }, { label: 'Right', hint: 'DIMJUSTR', command: 'DIMJUSTR' }]} />
        </Col>
        <Col>
          <Split size="sm" label="Override" command="DIMOVERRIDE" hint="Override a variable" items={[{ label: 'Override', hint: 'DIMOVERRIDE', command: 'DIMOVERRIDE' }]} />
          <Split size="sm" label="Update" command="-DIMSTYLE" hint="Apply the current style" items={[{ label: 'Update', hint: '-DIMSTYLE Apply', command: '-DIMSTYLE' }]} />
          <Split size="sm" label="Reassociate" command="DIMREASSOCIATE" hint="Reassociate" items={[{ label: 'Reassociate', hint: 'DIMREASSOCIATE', command: 'DIMREASSOCIATE' }]} />
        </Col>
        <div className="ribbon-col dim-styles">
          <label className="ribbon-select">
            Style
            <select aria-label="Dimension style" value={libraryName} onChange={(event) => setStyle(event.target.value)}>
              {styles.map((style) => <option key={style}>{style}</option>)}
            </select>
          </label>
          <label className="ribbon-select">
            Layer
            <select aria-label="Dimension layer override" data-command="DIMLAYER" value={dimLayer || '.'} onChange={(event) => setLayer(event.target.value)}>
              <option value=".">Use current</option>
              {layers.map((layer) => <option key={layer}>{layer}</option>)}
            </select>
          </label>
          <button type="button" className="ribbon-sm" data-command="DIMSTYLE" title="Dimension Style Manager" onClick={() => runCommand('DIMSTYLE')}>
            <RibbonIcon command="DIMSTYLE" />
            <span>Style Manager</span>
          </button>
        </div>
    </Panel>
  );
}

function Panel({ title, children, extra = [] }: { title: string; children: ReactNode; extra?: Tool[] }) {
  const ref = useRef<HTMLElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const [items, setItems] = useState<Tool[]>([]);
  const toggle = () => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.ribbon-lg[data-command], .ribbon-sm[data-command], .ribbon-main[data-command], .ribbon-big[data-command]') ?? [])];
    const seen = new Set<string>();
    const visible = buttons.flatMap((button) => {
      const command = button.dataset.command || '';
      if (!command || seen.has(command)) return [];
      seen.add(command);
      const span = button.querySelector('span')?.textContent?.trim();
      return [{ label: span || button.title || command, hint: button.title || command, command }];
    });
    for (const item of extra) {
      if (seen.has(item.command)) continue;
      seen.add(item.command);
      visible.push(item);
    }
    setItems(visible);
    const rect = dropRef.current?.getBoundingClientRect();
    setBox(rect ? { top: rect.bottom + 2, left: Math.min(rect.left, window.innerWidth - 260) } : null);
    setOpen((value) => !value);
  };
  return (
    <section className="ribbon-panel" aria-label={title} data-panel={title} ref={ref}>
      <div className="ribbon-tools">{children}</div>
      <h2>
        <span>{title}</span>
        <button type="button" className="panel-drop" aria-label={`${title} panel menu`} ref={dropRef} onClick={toggle}>
          ▾
        </button>
      </h2>
      {open && box && (
        <div className="ribbon-menu panel-overflow" role="menu" style={{ top: box.top, left: box.left }}>
          {items.map((item) => (
            <button
              key={item.command}
              type="button"
              role="menuitem"
              data-command={item.command}
              onClick={() => {
                setOpen(false);
                runCommand(item.command);
              }}
            >
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Col({ children }: { children: ReactNode }) {
  return <div className="ribbon-col">{children}</div>;
}

function Split({ label, command, hint, items, size = 'lg' }: { label: string; command: string; hint: string; items: Tool[]; size?: 'lg' | 'sm' }) {
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const menu = items.length > 1;
  const large = size === 'lg';
  return (
    <div className={`ribbon-split ${size}${box ? ' open' : ''}`}>
      <button type="button" className={large ? 'ribbon-lg' : 'ribbon-sm'} title={hint} data-command={command} onClick={() => { setBox(null); runCommand(command); }}>
        <RibbonIcon command={command} large={large} />
        <span>{label}</span>
      </button>
      {menu && (
        <button
          type="button"
          className="ribbon-caret"
          aria-label={`${label} tools`}
          aria-expanded={Boolean(box)}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setBox((current) => (current ? null : { top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 260) }));
          }}
        >
          ▾
        </button>
      )}
      {menu && box && (
        <div className="ribbon-menu" role="menu" style={{ top: box.top, left: box.left }}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              data-command={item.command}
              onClick={() => {
                setBox(null);
                if (item.prime) primeCommand(item.prime);
                runCommand(item.command);
              }}
            >
              <strong>{item.label}</strong>
              <em>{item.hint}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
