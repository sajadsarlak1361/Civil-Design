/**
 * Design command names for the Home-ribbon tools.
 * The geometry lives in the engine modules. A command registry can bind these
 * names later without importing React.
 */

export interface CivilCommandSpec {
  /** Command token. */
  command: string;
  label: string;
  panel: string;
  group: string;
  hint: string;
}

export const CIVIL_COMMANDS: CivilCommandSpec[] = [
  { command: 'CREATEPOINTS', label: 'Create Points', panel: 'Create Ground Data', group: 'Points', hint: 'Grid, alignment, interpolate, or type coordinates' },
  { command: 'CREATEPOINTGROUP', label: 'Point Groups', panel: 'Create Ground Data', group: 'Points', hint: 'Filter COGO points and add them to a surface' },
  { command: 'TRAVERSEEDITOR', label: 'Traverse', panel: 'Create Ground Data', group: 'Traverse', hint: 'Compass or transit adjustment' },
  { command: 'CREATESURVEYFIGURE', label: 'Figures / Feature lines from survey', panel: 'Create Ground Data', group: 'Figures', hint: 'Build figures from point codes' },
  { command: 'IMPORTSURVEYDATA', label: 'Import Survey Data', panel: 'Create Ground Data', group: 'Survey', hint: 'Field book, PNEZD, or NEZ with figure codes' },
  { command: 'CREATEPARCELFROMOBJECTS', label: 'Parcel', panel: 'Create Design', group: 'Parcel', hint: 'Area, perimeter, and metes and bounds' },
  { command: 'CREATEFEATURELINES', label: 'Feature Line', panel: 'Create Design', group: 'Feature Line', hint: '3D line with grades and surface elevations' },
  { command: 'CREATEGRADING', label: 'Grading', panel: 'Create Design', group: 'Grading', hint: 'Daylight a feature line to a surface' },
  { command: 'CREATEOFFSETALIGNMENT', label: 'Offset Alignment', panel: 'Create Design', group: 'Alignment', hint: 'Constant offset, positive is right' },
  { command: 'CALCULATESUPERELEVATION', label: 'Calculate Superelevation', panel: 'Create Design', group: 'Alignment', hint: 'AASHTO e and runoff along the alignment' },
  { command: 'CREATEPROFILEFROMCORRIDOR', label: 'Profile from Corridor', panel: 'Create Design', group: 'Profile', hint: 'Station and elevation of a corridor code' },
  { command: 'CREATECORRIDOR', label: 'Corridor', panel: 'Create Design', group: 'Corridor', hint: 'Assembly along the alignment and profile' },
  { command: 'CREATEMASSHAULDIAGRAM', label: 'Mass Haul Diagram', panel: 'Create Design', group: 'Corridor', hint: 'Cumulative earthwork and free haul' },
  { command: 'CREATEINTERSECTION', label: 'Intersections', panel: 'Create Design', group: 'Intersections', hint: 'Curb returns where two alignments cross' },
  { command: 'CREATEASSEMBLY', label: 'Assembly', panel: 'Create Design', group: 'Assembly', hint: 'Lane, shoulder, and daylight subassemblies' },
  { command: 'CREATEPIPENETWORK', label: 'Pipe Network', panel: 'Create Design', group: 'Pipe Network', hint: 'Gravity pipes, Manning capacity, cover' },
  { command: 'CREATEPRESSURENETWORK', label: 'Pressure Network', panel: 'Create Design', group: 'Pressure Network', hint: 'Hazen-Williams head loss and pressure' },
  { command: 'CREATEMULTIPLEPROFILEVIEW', label: 'Create Multiple Profile Views', panel: 'Profile & Section Views', group: 'Profile View', hint: 'Split the profile into station sheets, then pick the insertion point' },
  { command: 'ADDPROFILEVIEWBANDS', label: 'Data Bands', panel: 'Profile & Section Views', group: 'Data Bands', hint: 'Station, elevation, and geometry bands, placed at a picked point' },
  { command: 'SUPERIMPOSEPROFILE', label: 'Superimpose Profile', panel: 'Profile & Section Views', group: 'Superimpose', hint: 'Project another alignment onto this profile, then pick the insertion point' },
  { command: 'CREATEQUICKPROFILE', label: 'Quick Profile', panel: 'Profile & Section Views', group: 'Quick Profile', hint: 'Profile along a line, then pick where the view goes' },
];

/** Older tokens kept so a command line or test can still call the same tool. */
const ALIASES: Record<string, string> = {
  TRAVERSE: 'TRAVERSEEDITOR',
  CREATESURVEYFIGURES: 'CREATESURVEYFIGURE',
  CREATEFEATURELINE: 'CREATEFEATURELINES',
  CREATEPARCEL: 'CREATEPARCELFROMOBJECTS',
  CREATEMULTIPLEPROFILEVIEWS: 'CREATEMULTIPLEPROFILEVIEW',
  ADDPROFILEVIEWBAND: 'ADDPROFILEVIEWBANDS',
  QUICKPROFILE: 'CREATEQUICKPROFILE',
};

const BY_COMMAND = new Map(CIVIL_COMMANDS.map((spec) => [spec.command, spec]));

export function canonicalCivilCommand(command: string): string {
  const key = command.trim().toUpperCase();
  return ALIASES[key] ?? key;
}

export function civilCommand(command: string): CivilCommandSpec | undefined {
  return BY_COMMAND.get(canonicalCivilCommand(command));
}
