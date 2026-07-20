import { describe, expect, it } from 'vitest';
import { getPlantColor, heightBand } from './plant-color.util';
import { Species } from './species.service';

function species(overrides: Partial<Species>): Species {
  return {
    id: 'sp-1',
    user_id: 'user-1',
    common_name: 'Test plant',
    scientific_name: null,
    display_number: 0,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    external_source: null,
    external_id: null,
    height_ft_min: null,
    height_ft_max: null,
    external_data: null,
    spread_ft_min: null,
    spread_ft_max: null,
    dimensions_source: null,
    ...overrides,
  };
}

describe('heightBand', () => {
  it('returns unknown for null height', () => {
    expect(heightBand(null)).toBe('unknown');
  });

  it('buckets values above 8 as tall', () => {
    expect(heightBand(8.5)).toBe('tall');
    expect(heightBand(20)).toBe('tall');
  });

  it('treats exactly 8 as medium-tall, not tall (boundary goes to the lower band)', () => {
    expect(heightBand(8)).toBe('medium-tall');
  });

  it('buckets 5 to 8 as medium-tall', () => {
    expect(heightBand(6)).toBe('medium-tall');
  });

  it('treats exactly 5 as medium, not medium-tall', () => {
    expect(heightBand(5)).toBe('medium');
  });

  it('buckets 3 to 5 as medium', () => {
    expect(heightBand(4)).toBe('medium');
  });

  it('treats exactly 3 as short, not medium', () => {
    expect(heightBand(3)).toBe('short');
  });

  it('buckets 1 to 3 as short', () => {
    expect(heightBand(2)).toBe('short');
  });

  it('treats exactly 1 and below as ground', () => {
    expect(heightBand(1)).toBe('ground');
    expect(heightBand(0.5)).toBe('ground');
  });
});

describe('getPlantColor', () => {
  it('returns the unknown-band color for a species with no height data', () => {
    const color = getPlantColor(species({ height_ft_min: null, height_ft_max: null }));
    expect(color.fill).toBe('hsl(0, 0%, 30%)');
  });

  it('returns the unknown-band color when species is null', () => {
    expect(getPlantColor(null).fill).toBe('hsl(0, 0%, 30%)');
  });

  it('falls back to height_ft_min when height_ft_max is null', () => {
    const color = getPlantColor(
      species({ height_ft_min: 10, height_ft_max: null, display_number: 0 }),
    );
    expect(color.fill).toBe('hsl(25, 45%, 30%)'); // tall band, shade step 0
  });

  it('prefers height_ft_max over height_ft_min when both are present', () => {
    const color = getPlantColor(
      species({ height_ft_min: 10, height_ft_max: 2, display_number: 0 }),
    );
    expect(color.fill).toBe('hsl(48, 65%, 30%)'); // short band (max=2), not tall
  });

  it('cycles shade by display_number within the same band', () => {
    const base = { height_ft_min: 6, height_ft_max: 6 }; // medium-tall
    expect(getPlantColor(species({ ...base, display_number: 0 })).fill).toBe('hsl(100, 45%, 30%)');
    expect(getPlantColor(species({ ...base, display_number: 1 })).fill).toBe('hsl(100, 45%, 40%)');
    expect(getPlantColor(species({ ...base, display_number: 4 })).fill).toBe('hsl(100, 45%, 70%)');
  });

  it('wraps the shade cycle after 5 species (display_number 5 matches 0)', () => {
    const base = { height_ft_min: 6, height_ft_max: 6 };
    expect(getPlantColor(species({ ...base, display_number: 5 })).fill).toBe(
      getPlantColor(species({ ...base, display_number: 0 })).fill,
    );
  });

  it('uses white text on darker shades and dark text on lighter shades', () => {
    const base = { height_ft_min: 6, height_ft_max: 6 };
    expect(getPlantColor(species({ ...base, display_number: 0 })).textColor).toBe('#ffffff'); // L=30
    expect(getPlantColor(species({ ...base, display_number: 2 })).textColor).toBe('#ffffff'); // L=50
    expect(getPlantColor(species({ ...base, display_number: 3 })).textColor).toBe('#1c1917'); // L=60
  });

  it('gives every shade a stroke darker than its fill, clamped at a 10% floor', () => {
    const color = getPlantColor(species({ height_ft_min: 6, height_ft_max: 6, display_number: 0 }));
    expect(color.fill).toBe('hsl(100, 45%, 30%)');
    expect(color.stroke).toBe('hsl(100, 45%, 10%)');
  });
});
