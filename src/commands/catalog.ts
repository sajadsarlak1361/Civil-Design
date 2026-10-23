import { isRetired } from '../features';
import classicPgp from './classic.pgp?raw';
import { HOME_COMMANDS, HOME_COMMAND_HELP } from './homeCatalog';

/** Commands Civil Design actually runs. A known name with no handler reports that it is not in this build. */
export const IMPLEMENTED_COMMANDS = [
  'LINE', 'PLINE', 'CIRCLE', 'ARC', 'RECTANG', 'POLYGON', 'POINT', 'TEXT', 'MTEXT',
  'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'OFFSET', 'TRIM', 'EXTEND', 'FILLET', 'CHAMFER',
  'ERASE', 'EXPLODE', 'JOIN', 'STRETCH',
  'LIST', 'DIST', 'ID', 'AREA', 'PROPERTIES', 'PROPERTIESCLOSE', 'QSELECT', 'QUICKPROPERTIES', 'MATCHPROP',
  'CHPROP', '-CHPROP', 'LOCKOBJECT', 'UNLOCKOBJECT',
  'ZOOM', 'ZOOMEXTENTS', 'PAN', '-PAN', 'REGEN', 'REGENALL', 'REDRAW', 'REDRAWALL',
  'UNDO', 'U', 'REDO',
  'LAYER', '-LAYER', 'LINETYPE', '-LINETYPE', 'LTSCALE', 'COLOR', 'LWDISPLAY',
  'LAYISO', 'LAYUNISO', 'LAYOFF', 'LAYON', 'LAYFRZ', 'LAYTHW', 'LAYLCK', 'LAYULK', 'LAYMCUR', 'LAYCUR', 'LAYMCH', 'LAYMRG', 'LAYDEL', 'LAYERP', 'LAYP',
  'OSNAP', '-OSNAP', 'DSETTINGS', 'SNAP', 'UNITS', '-UNITS',
  'HELP', 'ALIASEDIT', 'NEW', 'OPEN', 'SAVE', 'QSAVE', 'SAVEAS', 'EXPORT', 'QUIT',
  'COPYCLIP', 'CUTCLIP', 'COPYBASE', 'COPYLINK', 'PASTECLIP', 'PASTEBLOCK', 'PASTEORIG', 'PASTESPEC',
  'AI_SELALL', 'FIND', 'SELECTSIMILAR',
  'ORTHO', 'POLAR', 'OTRACK', 'DYNMODE',
  '3DORBIT', '3DFORBIT', '3DCORBIT', 'PLAN', 'CLEANSCREENON', 'CLEANSCREENOFF',
  'VPORTS', 'VIEW', 'UCSICON', 'NAVBARDISPLAY', 'VIEWCUBE', 'VSCURRENT',
  'CAMERA', '3DWALK', '3DFLY', 'RENDER', 'OLELINKS', 'LASZIP', 'AUDIT', 'CREATESURFACECOMPOSITE',
  'XREF', 'XATTACH', 'IMAGEATTACH', 'XBIND', 'XCLIP',
  'CREATESURFACE', 'CREATE3DMESH', 'MESHSECTION', 'ADDPOINTFILE', 'LANDXMLIN', 'IMPORTPOINTS',
  'ADDSURFACEBOUNDARIES', 'ADDSURFACEBREAKLINES', 'CONTOURS', 'EDITSURFACEPROPERTIES',
  'CREATEALIGNMENTLAYOUT', 'CREATEALIGNMENTENTITIES',
  'CREATEPROFILEFROMSURFACE', 'CREATEPROFILELAYOUT', 'CREATEPROFILEVIEW',
  'CREATESAMPLELINES', 'CREATESECTIONVIEW', 'CREATEMULTIPLESECTIONVIEW',
  'CREATEPOINTS', 'CREATEPOINTGROUP', 'IMPORTSURVEYDATA', 'TRAVERSEEDITOR', 'CREATESURVEYFIGURE',
  'CREATEFEATURELINES', 'CREATEPARCELFROMOBJECTS', 'CREATEGRADING', 'CREATEOFFSETALIGNMENT',
  'CALCULATESUPERELEVATION', 'CREATEPROFILEFROMCORRIDOR', 'CREATECORRIDOR', 'CREATEMASSHAULDIAGRAM',
  'CREATEINTERSECTION', 'CREATEASSEMBLY', 'CREATEPIPENETWORK', 'CREATEPRESSURENETWORK',
  'CREATEMULTIPLEPROFILEVIEW', 'SUPERIMPOSEPROFILE', 'CREATEQUICKPROFILE', 'ADDPROFILEVIEWBANDS',
  ...HOME_COMMANDS,
] as const;

const IMPLEMENTED = new Set<string>(IMPLEMENTED_COMMANDS);

export interface PgpAlias {
  alias: string;
  command: string;
}

export interface PgpExternal {
  name: string;
}

/**
 * Parse a classic CAD alias file.
 * Alias lines are `ALIAS,*COMMAND`. Later duplicates win, matching the
 * "User Defined Command Aliases take precedence" rule.
 * External-command lines (`NAME, shell, flag, prompt,`) are recorded separately.
 */
export function parsePgp(text: string): { aliases: PgpAlias[]; externals: PgpExternal[] } {
  const commands = new Map<string, string>();
  const externals: PgpExternal[] = [];
  const seenExternal = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const alias = /^([^,\s]+)\s*,\s*\*(\S+)\s*$/.exec(line);
    if (alias) {
      commands.set(alias[1].toUpperCase(), alias[2].toUpperCase());
      continue;
    }
    const external = /^([^,\s]+)\s*,\s*([^,]*),\s*\d+\s*,/.exec(line);
    if (external) {
      const name = external[1].toUpperCase();
      if (!seenExternal.has(name)) {
        seenExternal.add(name);
        externals.push({ name });
      }
    }
  }
  return {
    aliases: [...commands.entries()].map(([alias, command]) => ({ alias, command })),
    externals,
  };
}

export interface CivilCommand {
  name: string;
  description: string;
  /** Optional side panel opened with the command. */
  soon?: { name: string; panel: string };
}

/** Design command names. Listed first in help and autocomplete. */
export const CIVIL_COMMANDS: CivilCommand[] = [
  { name: 'CREATESURFACE', description: 'Create a TIN surface from points or LandXML' },
  { name: 'ADDPOINTFILE', description: 'Import a point file as a surface' },
  { name: 'LANDXMLIN', description: 'Import a LandXML TIN or CgPoints' },
  { name: 'ADDSURFACEBOUNDARIES', description: 'Add an outer boundary to the active surface' },
  { name: 'ADDSURFACEBREAKLINES', description: 'Add breaklines to the active surface' },
  { name: 'EDITSURFACEPROPERTIES', description: 'Edit the active surface style and rebuild settings' },
  { name: 'CREATEALIGNMENTLAYOUT', description: 'Draw an alignment from tangent PIs, curves, and spirals' },
  { name: 'CREATEALIGNMENTENTITIES', description: 'Create an alignment from a polyline or the surface boundary' },
  { name: 'CREATEPROFILEFROMSURFACE', description: 'Sample the active surface along the alignment' },
  { name: 'CREATEPROFILELAYOUT', description: 'Add a parabolic vertical curve above the surface' },
  { name: 'CREATEPROFILEVIEW', description: 'Open the profile view' },
  { name: 'CREATESAMPLELINES', description: 'Place sample lines along the alignment' },
  { name: 'CREATESECTIONVIEW', description: 'Open one section view' },
  { name: 'CREATEMULTIPLESECTIONVIEW', description: 'Open every sample line on one section sheet' },
  { name: 'CREATEPOINTS', description: 'Create COGO points' },
  { name: 'CREATEPOINTGROUP', description: 'Create a point group' },
  { name: 'IMPORTSURVEYDATA', description: 'Import a survey database' },
  { name: 'TRAVERSEEDITOR', description: 'Adjust a survey traverse' },
  { name: 'CREATESURVEYFIGURE', description: 'Create a survey figure' },
  { name: 'CREATEFEATURELINES', description: 'Create feature lines' },
  { name: 'CREATEPARCELFROMOBJECTS', description: 'Create parcels from objects' },
  { name: 'CREATEGRADING', description: 'Create a grading' },
  { name: 'CREATEOFFSETALIGNMENT', description: 'Create an offset alignment' },
  { name: 'CALCULATESUPERELEVATION', description: 'Calculate AASHTO superelevation' },
  { name: 'CREATEPROFILEFROMCORRIDOR', description: 'Create a profile from a corridor' },
  { name: 'CREATECORRIDOR', description: 'Create a corridor' },
  { name: 'CREATEMASSHAULDIAGRAM', description: 'Create a mass haul diagram' },
  { name: 'CREATEINTERSECTION', description: 'Create an intersection' },
  { name: 'CREATEASSEMBLY', description: 'Create an assembly' },
  { name: 'CREATEPIPENETWORK', description: 'Create a pipe network' },
  { name: 'CREATEPRESSURENETWORK', description: 'Create a pressure network' },
  { name: 'CREATEMULTIPLEPROFILEVIEW', description: 'Create multiple profile views' },
  { name: 'SUPERIMPOSEPROFILE', description: 'Superimpose a profile' },
  { name: 'CREATEQUICKPROFILE', description: 'Create a quick profile' },
  { name: 'ADDPROFILEVIEWBANDS', description: 'Add profile view data bands' },
  { name: 'ADDSURFACECONTOURS', description: 'Add contour data to a surface' },
  { name: 'ADDSURFACEPOINT', description: 'Add a point to a surface' },
  { name: 'ADDSURFACELINE', description: 'Add a TIN line' },
  { name: 'CREATESURFACECOMPOSITE', description: 'Create a TIN volume surface' },
  { name: 'EDITSURFACEPASTE', description: 'Paste a surface into another' },
  { name: 'EDITSURFACESWAPEDGE', description: 'Swap a TIN edge' },
  { name: 'CREATEALIGNMENTREFERENCE', description: 'Create an alignment reference' },
  { name: 'CREATEALIGNFROMEXISTING', description: 'Create an alignment from an existing alignment' },
  { name: 'EDITALIGNMENT', description: 'Edit alignment layout' },
  { name: 'CREATEPROFILEFROMFILE', description: 'Create a profile from a file' },
  { name: 'EDITPROFILELAYOUT', description: 'Edit a layout profile' },
  { name: 'ADDPROFILEPVI', description: 'Add a PVI' },
  { name: 'DELETEPROFILEPVI', description: 'Delete a PVI' },
];

/** Civil Design additions that are not in the classic CAD alias file. */
export const FIELDLINE_ALIASES: PgpAlias[] = [
  { alias: 'ZE', command: 'ZOOMEXTENTS' },
  { alias: '?', command: 'HELP' },
  { alias: 'MREDO', command: 'REDO' },
];

export const FIELDLINE_COMMANDS: { name: string; description: string }[] = [
  { name: 'CONTOURS', description: 'Toggle contours on the active TIN surface' },
  { name: 'CREATE3DMESH', description: 'Create a 3D mesh from points with ball pivoting' },
  { name: 'MESHSECTION', description: 'Cut tunnel sections through a 3D mesh' },
  { name: 'IMPORTPOINTS', description: 'Import points or LandXML' },
  { name: 'ZOOMEXTENTS', description: 'Zoom to the extents of the model' },
  { name: '-PAN', description: 'Pan by two points or a displacement' },
  { name: 'HELP', description: 'List Civil Design commands' },
  { name: 'ALIASEDIT', description: 'Edit user command aliases' },
  { name: 'NEW', description: 'Start a new project' },
  { name: 'OPEN', description: 'Open a Civil Design project' },
  { name: 'SAVE', description: 'Save the project JSON' },
  { name: 'QSAVE', description: 'Save the project JSON' },
  { name: 'SAVEAS', description: 'Save the project JSON' },
  { name: 'EXPORT', description: 'Export contours, triangles, LandXML, a volume report, a mesh, or section report' },
  { name: 'QUIT', description: 'Leave Civil Design' },
  { name: 'UNDO', description: 'Undo the last drawing command' },
  { name: 'U', description: 'Undo the last drawing command' },
  { name: 'REDO', description: 'Redo the last undone drawing command' },
  { name: 'COPYCLIP', description: 'Copy the selection to the clipboard' },
  { name: 'CUTCLIP', description: 'Cut the selection to the clipboard' },
  { name: 'COPYBASE', description: 'Copy the selection with a base point' },
  { name: 'COPYLINK', description: 'Copy the selection and a Civil Design link' },
  { name: 'PASTECLIP', description: 'Paste the clipboard into the drawing' },
  { name: 'PASTEBLOCK', description: 'Paste the clipboard as a block' },
  { name: 'PASTEORIG', description: 'Paste the clipboard at its original coordinates' },
  { name: 'PASTESPEC', description: 'Paste Civil Design entities or plain text' },
  { name: 'AI_SELALL', description: 'Select every object' },
  { name: 'FIND', description: 'Find and replace text' },
  { name: 'SELECTSIMILAR', description: 'Select objects with the same type and layer' },
  { name: '3DORBIT', description: 'Constrained 3D orbit' },
  { name: '3DFORBIT', description: 'Free 3D orbit' },
  { name: '3DCORBIT', description: 'Continuous 3D orbit' },
  { name: 'PLAN', description: 'Plan view of the current UCS' },
  { name: 'CLEANSCREENON', description: 'Hide the ribbon, panels, and status bar' },
  { name: 'CLEANSCREENOFF', description: 'Show the ribbon, panels, and status bar' },
  { name: 'VPORTS', description: 'Tile model-space viewports' },
  { name: 'VIEW', description: 'Save or restore a named view' },
  { name: 'UCSICON', description: 'Toggle the UCS icon' },
  { name: 'NAVBARDISPLAY', description: 'Toggle the navigation bar' },
  { name: 'VIEWCUBE', description: 'Toggle the ViewCube' },
  { name: 'VSCURRENT', description: 'Set the visual style' },
  { name: 'CAMERA', description: 'Save the current 3D camera as a named view' },
  { name: '3DWALK', description: 'Walk the 3D camera with the arrow keys' },
  { name: '3DFLY', description: 'Fly the 3D camera, including up and down' },
  { name: 'RENDER', description: 'Shade the view and save a PNG' },
  { name: 'OLELINKS', description: 'List, reload, or detach linked drawings and images' },
  { name: 'LASZIP', description: 'Explain the LAZ limit and open a LAS file' },
  { name: 'AUDIT', description: 'Check the drawing for zero-length objects, duplicate ids, and missing layers' },
  { name: 'ORTHO', description: 'Toggle ortho mode (F8)' },
  { name: 'POLAR', description: 'Toggle polar tracking (F10)' },
  { name: 'OTRACK', description: 'Toggle object-snap tracking (F11)' },
  { name: 'DYNMODE', description: 'Toggle dynamic input (F12)' },
  { name: 'XREF', description: 'Open the External References palette' },
  { name: 'XATTACH', description: 'Attach a DXF, DWG, or Civil Design drawing' },
  { name: 'IMAGEATTACH', description: 'Attach a PNG or JPEG' },
  { name: 'XBIND', description: 'Bind individual xref layers into the drawing' },
  { name: 'XCLIP', description: 'Clip an external reference with a rectangle' },
  ...HOME_COMMAND_HELP,
  { name: 'LAYER', description: 'Open the Layer Properties Manager' },
  { name: 'PROPERTIES', description: 'Open the Properties palette' },
  { name: 'PROPERTIESCLOSE', description: 'Close the Properties palette' },
  { name: 'QUICKPROPERTIES', description: 'Toggle the Quick Properties hover panel' },
  { name: 'QSELECT', description: 'Quick select objects by property' },
  { name: 'MATCHPROP', description: 'Copy properties from one object to others' },
  { name: 'LOCKOBJECT', description: 'Lock selected objects so they cannot be edited' },
  { name: 'UNLOCKOBJECT', description: 'Unlock selected objects' },
  { name: 'LWDISPLAY', description: 'Toggle lineweight display' },
  { name: 'LAYISO', description: 'Isolate the layers of selected objects' },
  { name: 'LAYUNISO', description: 'Restore layers after LAYISO' },
  { name: 'LAYOFF', description: 'Turn off the layer of a selected object' },
  { name: 'LAYON', description: 'Turn all layers on' },
  { name: 'LAYFRZ', description: 'Freeze the layer of a selected object' },
  { name: 'LAYTHW', description: 'Thaw all layers' },
  { name: 'LAYLCK', description: 'Lock the layer of a selected object' },
  { name: 'LAYULK', description: 'Unlock the layer of a selected object' },
  { name: 'LAYMCUR', description: 'Make the selected object’s layer current' },
  { name: 'LAYCUR', description: 'Move selected objects to the current layer' },
  { name: 'LAYMCH', description: 'Change selected objects to another object’s layer' },
  { name: 'LAYMRG', description: 'Merge one layer into another' },
  { name: 'LAYDEL', description: 'Delete a layer and the objects on it' },
  { name: 'LAYERP', description: 'Restore the previous layer state' },
  { name: 'LAYP', description: 'Restore the previous layer state' },
];

export interface ResolvedCommand {
  token: string;
  command: string;
  known: boolean;
  implemented: boolean;
  retired?: boolean;
  source: 'user' | 'civil' | 'pgp' | 'fieldline' | 'command' | 'external' | 'unknown';
  soon?: { name: string; panel: string };
}

export interface AliasRow {
  alias: string;
  command: string;
  source: 'classic.pgp' | 'fieldline' | 'design';
  implemented: boolean;
}

interface Tables {
  pgp: Map<string, string>;
  field: Map<string, string>;
  civil: Map<string, CivilCommand>;
  descriptions: Map<string, string>;
  externals: Set<string>;
  known: Set<string>;
}

let cached: Tables | null = null;

function tables(): Tables {
  if (cached) return cached;
  const parsed = parsePgp(classicPgp);
  const pgp = new Map(parsed.aliases.map((entry) => [entry.alias, entry.command]));
  const field = new Map<string, string>();
  for (const entry of FIELDLINE_ALIASES) {
    if (!pgp.has(entry.alias)) field.set(entry.alias, entry.command);
  }
  const civil = new Map(CIVIL_COMMANDS.map((entry) => [entry.name, entry]));
  const descriptions = new Map<string, string>();
  for (const entry of CIVIL_COMMANDS) descriptions.set(entry.name, entry.description);
  for (const entry of FIELDLINE_COMMANDS) descriptions.set(entry.name, entry.description);
  const known = new Set<string>([
    ...pgp.values(),
    ...field.values(),
    ...civil.keys(),
    ...FIELDLINE_COMMANDS.map((entry) => entry.name),
    ...IMPLEMENTED,
  ]);
  cached = {
    pgp,
    field,
    civil,
    descriptions,
    externals: new Set(parsed.externals.map((entry) => entry.name)),
    known,
  };
  return cached;
}

export function bundledPgp(): string {
  return classicPgp;
}

export function pgpAliases(): PgpAlias[] {
  return [...tables().pgp.entries()].map(([alias, command]) => ({ alias, command }));
}

export function isImplemented(command: string): boolean {
  return IMPLEMENTED.has(command.toUpperCase());
}

export function commandDescription(command: string): string {
  return tables().descriptions.get(command.toUpperCase()) ?? command;
}

export function soonFor(command: string): { name: string; panel: string } | undefined {
  return tables().civil.get(command.toUpperCase())?.soon;
}

export function unavailableMessage(command: string): string {
  return `${command}: that command is not in this build.`;
}

export function unknownMessage(token: string): string {
  return `Unknown command "${token}". Press F1 for help.`;
}

export function resolveToken(token: string, userAliases?: ReadonlyMap<string, string>): ResolvedCommand {
  const key = token.trim().toUpperCase();
  const base = { token: key, command: key, known: false, implemented: false, source: 'unknown' as const };
  if (!key) return base;
  if (isRetired(key)) return { token: key, command: key, known: true, implemented: false, retired: true, source: 'civil' };
  const data = tables();
  const user = userAliases?.get(key);
  if (user) {
    const command = user.toUpperCase();
    return { token: key, command, known: data.known.has(command) || IMPLEMENTED.has(command) || isRetired(command), implemented: IMPLEMENTED.has(command), retired: isRetired(command), source: 'user', soon: isRetired(command) ? undefined : soonFor(command) };
  }
  // Design command names win over a same-spelled classic.pgp alias.
  if (data.civil.has(key)) {
    return { token: key, command: key, known: true, implemented: IMPLEMENTED.has(key), source: 'civil', soon: data.civil.get(key)?.soon };
  }
  const pgp = data.pgp.get(key);
  if (pgp) return { token: key, command: pgp, known: true, implemented: IMPLEMENTED.has(pgp), retired: isRetired(pgp), source: 'pgp', soon: isRetired(pgp) ? undefined : soonFor(pgp) };
  const field = data.field.get(key);
  if (field) return { token: key, command: field, known: true, implemented: IMPLEMENTED.has(field), source: 'fieldline', soon: soonFor(field) };
  if (data.known.has(key)) return { token: key, command: key, known: true, implemented: IMPLEMENTED.has(key), source: 'command', soon: soonFor(key) };
  if (data.externals.has(key)) return { token: key, command: key, known: true, implemented: false, source: 'external' };
  return base;
}

export interface SuggestEntry {
  name: string;
  aliases: string[];
  description: string;
  implemented: boolean;
  rank: number;
}

export function suggestionSources(userAliases?: ReadonlyMap<string, string>): SuggestEntry[] {
  const data = tables();
  const byCommand = new Map<string, SuggestEntry>();
  const ensure = (name: string, rank: number) => {
    const key = name.toUpperCase();
    let entry = byCommand.get(key);
    if (!entry) {
      entry = {
        name: key,
        aliases: [],
        description: data.descriptions.get(key) ?? key,
        implemented: IMPLEMENTED.has(key),
        rank,
      };
      byCommand.set(key, entry);
    } else if (rank > entry.rank) entry.rank = rank;
    return entry;
  };
  for (const civil of CIVIL_COMMANDS) {
    if (isRetired(civil.name)) continue;
    ensure(civil.name, IMPLEMENTED.has(civil.name) ? 80 : 50);
  }
  for (const [alias, command] of data.pgp) {
    if (isRetired(command)) continue;
    const entry = ensure(command, 10);
    entry.aliases.push(alias);
  }
  for (const [alias, command] of data.field) {
    const entry = ensure(command, 20);
    entry.aliases.push(alias);
  }
  for (const command of FIELDLINE_COMMANDS) ensure(command.name, 20);
  if (userAliases) {
    for (const [alias, command] of userAliases) {
      const entry = ensure(command, 30);
      if (!entry.aliases.includes(alias)) entry.aliases.push(alias);
    }
  }
  return [...byCommand.values()];
}

export function aliasRows(): AliasRow[] {
  const data = tables();
  const rows: AliasRow[] = [];
  for (const command of CIVIL_COMMANDS) {
    if (isRetired(command.name)) continue;
    rows.push({
      alias: command.name,
      command: command.name,
      source: 'design',
      implemented: IMPLEMENTED.has(command.name),
    });
  }
  for (const [alias, command] of data.field) {
    rows.push({ alias, command, source: 'fieldline', implemented: IMPLEMENTED.has(command) });
  }
  for (const [alias, command] of data.pgp) {
    if (isRetired(command)) continue;
    rows.push({ alias, command, source: 'classic.pgp', implemented: IMPLEMENTED.has(command) });
  }
  return rows;
}

export function helpText(): string[] {
  const data = tables();
  const lines = ['Civil Design commands. Capital letters show an abbreviation when a command is prompting.', ''];
  lines.push('Design commands');
  for (const command of CIVIL_COMMANDS) {
    if (isRetired(command.name)) continue;
    if (!IMPLEMENTED.has(command.name)) continue;
    lines.push(`  ${command.name}  ${command.description}`);
  }
  lines.push('', 'Drawing and inquiry');
  const draw = ['LINE', 'PLINE', 'CIRCLE', 'ARC', 'RECTANG', 'POLYGON', 'POINT', 'TEXT', 'MOVE', 'COPY', 'ROTATE', 'SCALE', 'MIRROR', 'OFFSET', 'TRIM', 'EXTEND', 'FILLET', 'CHAMFER', 'ERASE', 'EXPLODE', 'JOIN', 'STRETCH', 'ZOOM', 'PAN', 'DIST', 'ID', 'LIST', 'AREA', 'LAYER', 'UNDO', 'REDO'];
  for (const name of draw) {
    const aliases = [...data.pgp.entries(), ...data.field.entries()].filter(([, command]) => command === name).map(([alias]) => alias);
    lines.push(`  ${name}${aliases.length ? `  (${aliases.slice(0, 6).join(', ')})` : ''}`);
  }
  lines.push('', `${data.pgp.size} classic CAD aliases are recognised. An alias whose command is not in this build reports that instead of "Unknown command".`, 'ALIASEDIT stores your own aliases in this browser. F1 opens this list.');
  return lines;
}
