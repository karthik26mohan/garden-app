import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SpeciesLegend } from './species-legend';
import { Species } from '../species.service';

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

describe('SpeciesLegend swatches', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SpeciesLegend] }).compileComponents();
  });

  it("renders a swatch colored by the species' height band", () => {
    const fixture = TestBed.createComponent(SpeciesLegend);
    fixture.componentRef.setInput('species', [species({ height_ft_max: 12 })]);
    fixture.detectChanges();

    const swatch = fixture.nativeElement.querySelector('.species-legend__swatch') as HTMLElement;
    // jsdom/cssstyle normalizes hsl(...) to its rgb(...) equivalent when
    // read back via element.style — this is hsl(25, 45%, 30%) reflected.
    expect(swatch.style.background).toBe('rgb(111, 71, 42)');
  });
});
