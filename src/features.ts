/**
 * Feature switches. Disabled tools stay out of the ribbon and autocomplete.
 * The command names below are only the strings needed to answer a typed command.
 * Their panels are not built while the flag is false.
 */
export const features = {
  pipeNetworks: false,
  survey: false,
} as const;

const PIPE_COMMANDS = ['CREATEPIPENETWORK', 'CREATEPRESSURENETWORK'] as const;
const SURVEY_COMMANDS = ['IMPORTSURVEYDATA', 'CREATESURVEYFIGURE', 'TRAVERSEEDITOR', 'TRAVERSE'] as const;

const retired = new Set<string>([
  ...(features.pipeNetworks ? [] : PIPE_COMMANDS),
  ...(features.survey ? [] : SURVEY_COMMANDS),
]);

export function isRetired(command: string): boolean {
  return retired.has(command.trim().toUpperCase());
}

export function retiredMessage(command: string): string {
  return `${command.trim().toUpperCase()}: not available in this version`;
}
