/**
 * Feature switches shared with the performance workstream.
 * Pipe networks and survey stay off until that work enables them.
 */
export interface FeatureFlags {
  pipeNetworks: boolean;
  survey: boolean;
}

export const featureFlags: FeatureFlags = {
  pipeNetworks: false,
  survey: false,
};

export function featureEnabled(name: keyof FeatureFlags): boolean {
  return featureFlags[name];
}
