import { Species } from './species.service';

export type HeightBand = 'tall' | 'medium-tall' | 'medium' | 'short' | 'ground' | 'unknown';

export interface PlantColor {
  fill: string;
  stroke: string;
  textColor: string;
}

interface BandStyle {
  hue: number;
  saturation: number;
}

const BAND_STYLE: Record<HeightBand, BandStyle> = {
  tall: { hue: 25, saturation: 45 }, // brown
  'medium-tall': { hue: 100, saturation: 45 }, // green
  medium: { hue: 210, saturation: 55 }, // blue
  short: { hue: 48, saturation: 65 }, // yellow
  ground: { hue: 210, saturation: 15 }, // slate gray, cool-tinted
  unknown: { hue: 0, saturation: 0 }, // neutral gray
};

// Lightness steps a species' display_number cycles through within its
// band's hue, so neighboring species never render as the same color even
// when they land in the same height band.
const SHADE_LIGHTNESS_STEPS = [30, 40, 50, 60, 70];

/**
 * Boundaries are inclusive on the LOWER band: a value exactly on a
 * boundary (e.g. 8) belongs to the shorter band ("medium-tall"), not the
 * taller one ("tall").
 */
export function heightBand(heightFt: number | null): HeightBand {
  if (heightFt == null) return 'unknown';
  if (heightFt > 8) return 'tall';
  if (heightFt > 5) return 'medium-tall';
  if (heightFt > 3) return 'medium';
  if (heightFt > 1) return 'short';
  return 'ground';
}

function resolveHeightFt(species: Species | null | undefined): number | null {
  return species?.height_ft_max ?? species?.height_ft_min ?? null;
}

/**
 * Deterministic per-plant color: hue/saturation come from the species'
 * height band, lightness cycles by species.display_number. Purely
 * computed — no stored color, so it can never drift out of sync with
 * height data.
 */
export function getPlantColor(species: Species | null | undefined): PlantColor {
  const band = heightBand(resolveHeightFt(species));
  const { hue, saturation } = BAND_STYLE[band];
  const shadeIndex = (species?.display_number ?? 0) % SHADE_LIGHTNESS_STEPS.length;
  const lightness = SHADE_LIGHTNESS_STEPS[shadeIndex];
  const strokeLightness = Math.max(lightness - 20, 10);

  return {
    fill: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
    stroke: `hsl(${hue}, ${saturation}%, ${strokeLightness}%)`,
    textColor: lightness <= 50 ? '#ffffff' : '#1c1917',
  };
}
