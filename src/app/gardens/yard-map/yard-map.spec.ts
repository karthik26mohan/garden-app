import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { YardMap } from './yard-map';
import { Garden } from '../garden.service';
import { Plant } from '../plant.service';
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

function plant(id: string, overrides: Partial<Plant>): Plant {
  return {
    id,
    garden_id: 'g-1',
    added_by_user_id: 'user-1',
    common_name: null,
    scientific_name: null,
    inaturalist_taxon_id: null,
    plantnet_score: null,
    notes: null,
    planted_at: null,
    position_x_ft: 5,
    position_y_ft: 5,
    diameter_ft: 2,
    species_id: null,
    identified_at: '2026-06-01T00:00:00Z',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function garden(plants: Plant[]): Garden {
  return {
    id: 'g-1',
    user_id: 'user-1',
    name: 'Front yard',
    description: null,
    position_x_ft: 0,
    position_y_ft: 0,
    width_ft: 20,
    height_ft: 20,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    plants,
  };
}

describe('YardMap plant coloring', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [YardMap] }).compileComponents();
  });

  function create(gardens: Garden[]) {
    const fixture = TestBed.createComponent(YardMap);
    fixture.componentRef.setInput('gardens', gardens);
    fixture.detectChanges();
    return fixture;
  }

  it("colors a plant circle by its species' height band", () => {
    const tall = species({ height_ft_max: 12, display_number: 0 });
    const fixture = create([garden([plant('p-1', { species_id: 'sp-1', species: tall })])]);

    const circle = fixture.nativeElement.querySelector('.yard-map__plant') as SVGCircleElement;
    // jsdom's CSSOM normalizes hsl() colors to rgb() when serializing
    // style.fill back out; rgb(111, 71, 42) is the exact conversion of
    // hsl(25, 45%, 30%) — same color, different serialization.
    expect(circle.style.fill).toBe('rgb(111, 71, 42)');
  });

  it('renders the neutral unknown color for a plant with no species', () => {
    const fixture = create([garden([plant('p-1', {})])]);

    const circle = fixture.nativeElement.querySelector('.yard-map__plant') as SVGCircleElement;
    // See note above — jsdom serializes hsl(0, 0%, 30%) back out as rgb.
    expect(circle.style.fill).toBe('rgb(77, 77, 77)');
  });

  it('gives two species in the same height band different shades', () => {
    const a = species({ id: 'sp-a', height_ft_max: 6, display_number: 0 });
    const b = species({ id: 'sp-b', height_ft_max: 6, display_number: 1 });
    const fixture = create([
      garden([
        plant('p-1', { species_id: 'sp-a', species: a }),
        plant('p-2', { species_id: 'sp-b', species: b, position_x_ft: 10 }),
      ]),
    ]);

    const circles = fixture.nativeElement.querySelectorAll('.yard-map__plant');
    expect((circles[0] as SVGCircleElement).style.fill).not.toBe(
      (circles[1] as SVGCircleElement).style.fill,
    );
  });
});
