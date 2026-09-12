export interface Preset {
  width: number;
  height: number;
}

export const PRESETS: Record<string, Preset> = {
  small: { width: 1800, height: 1200 },
  medium: { width: 3600, height: 2400 },
  large: { width: 5400, height: 3600 },
};

export const DEFAULT_PRESET = "large";

export function resolvePreset(name: string | undefined): Preset {
  const key = (name ?? DEFAULT_PRESET).toLowerCase();
  const preset = PRESETS[key];
  if (!preset) {
    throw new Error(`Unknown preset "${name}". Valid presets: ${Object.keys(PRESETS).join(", ")}`);
  }
  return preset;
}
