export interface Preset {
  width: number;
  height: number;
}

// All standard flag sizes are 3:2 (fly:hoist), rendered at 150 DPI.
export const PRESETS: Record<string, Preset> = {
  "12x18in": { width: 2700, height: 1800 },
  "2x3ft": { width: 5400, height: 3600 },
};

export const DEFAULT_PRESET = "12x18in";

export function resolvePreset(name: string | undefined): Preset {
  const key = name ?? DEFAULT_PRESET;
  const preset = PRESETS[key];
  if (!preset) {
    throw new Error(`Unknown preset "${name}". Valid presets: ${Object.keys(PRESETS).join(", ")}`);
  }
  return preset;
}
