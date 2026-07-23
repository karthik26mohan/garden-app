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

// yard-map.scss renders plant circles at this opacity over the SVG's
// background — textColor must be legible against the ACTUAL composited
// color the browser paints, not the raw undiluted fill, or a dark shade
// blended toward this near-white backdrop reads as light and picks the
// wrong (white) text color. See yard-map.scss: `&__plant { fill-opacity:
// 0.45; }` and `&__svg { background: #fafaf9; }`.
const MAP_FILL_OPACITY = 0.45;
const MAP_BACKDROP_RGB = { r: 250, g: 250, b: 249 }; // #fafaf9

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

function hslToRgb(
  hue: number,
  saturation: number,
  lightness: number,
): { r: number; g: number; b: number } {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hPrime = hue / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hPrime < 1) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (hPrime < 2) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (hPrime < 3) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (hPrime < 4) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (hPrime < 5) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function relativeLuminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
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

  const rawRgb = hslToRgb(hue, saturation, lightness);
  const compositedRgb = {
    r: rawRgb.r * MAP_FILL_OPACITY + MAP_BACKDROP_RGB.r * (1 - MAP_FILL_OPACITY),
    g: rawRgb.g * MAP_FILL_OPACITY + MAP_BACKDROP_RGB.g * (1 - MAP_FILL_OPACITY),
    b: rawRgb.b * MAP_FILL_OPACITY + MAP_BACKDROP_RGB.b * (1 - MAP_FILL_OPACITY),
  };
  const textColor =
    relativeLuminance(compositedRgb.r, compositedRgb.g, compositedRgb.b) > 0.5
      ? '#1c1917'
      : '#ffffff';

  return {
    fill: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
    stroke: `hsl(${hue}, ${saturation}%, ${strokeLightness}%)`,
    textColor,
  };
}
