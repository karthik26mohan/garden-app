import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Gardens } from './gardens';
import { SupabaseService } from '../supabase.service';
import { GardenService, Garden } from './garden.service';
import { PlantService } from './plant.service';
import { SpeciesService, Species } from './species.service';

function species(overrides: Partial<Species>): Species {
  return {
    id: 'sp-1',
    user_id: 'user-1',
    common_name: 'Oak sapling',
    scientific_name: 'Quercus rubra',
    display_number: 1,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    external_source: 'plantnet',
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

function gardenWithSpecies(plantSpecies: Species): Garden {
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
    plants: [
      {
        id: 'p-1',
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
        species_id: plantSpecies.id,
        species: plantSpecies,
        identified_at: '2026-06-01T00:00:00Z',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-01T00:00:00Z',
      },
    ],
  };
}

describe('Gardens.speciesNeedingHeight / onBackfillHeights', () => {
  let component: Gardens;

  const backfillMock = vi.fn();
  const supabaseMock = {
    client: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } },
  };
  const gardenServiceMock = { list: vi.fn() };
  const plantServiceMock = {};
  const speciesServiceMock = { backfillDimensions: backfillMock };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        Gardens,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: GardenService, useValue: gardenServiceMock },
        { provide: PlantService, useValue: plantServiceMock },
        { provide: SpeciesService, useValue: speciesServiceMock },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
      ],
    });
    component = TestBed.inject(Gardens);
  });

  it('lists species with a scientific name but no height data', () => {
    const noHeight = species({ id: 'sp-1', height_ft_min: null, height_ft_max: null });
    const hasHeight = species({ id: 'sp-2', height_ft_max: 6 });
    const unidentified = species({ id: 'sp-3', scientific_name: null });
    component.gardens.set([
      gardenWithSpecies(noHeight),
      gardenWithSpecies(hasHeight),
      gardenWithSpecies(unidentified),
    ]);

    expect(component.speciesNeedingHeight().map((s) => s.id)).toEqual(['sp-1']);
  });

  it('backfills dimensions and updates the embedded species on affected plants', async () => {
    const noHeight = species({ id: 'sp-1', height_ft_min: null, height_ft_max: null });
    component.gardens.set([gardenWithSpecies(noHeight)]);
    const updated = { ...noHeight, height_ft_max: 40 };
    backfillMock.mockResolvedValue(updated);

    await component.onBackfillHeights();

    expect(backfillMock).toHaveBeenCalledWith(noHeight);
    expect(component.gardens()[0].plants![0].species).toEqual(updated);
    expect(component.speciesNeedingHeight()).toEqual([]);
  });

  it('does nothing when no species need a height lookup', async () => {
    const hasHeight = species({ id: 'sp-2', height_ft_max: 6 });
    component.gardens.set([gardenWithSpecies(hasHeight)]);

    await component.onBackfillHeights();

    expect(backfillMock).not.toHaveBeenCalled();
  });

  it('sets backfillingHeights while the lookup is in flight', async () => {
    const noHeight = species({ id: 'sp-1', height_ft_min: null, height_ft_max: null });
    component.gardens.set([gardenWithSpecies(noHeight)]);
    let resolveBackfill!: (value: Species) => void;
    backfillMock.mockReturnValue(
      new Promise<Species>((resolve) => {
        resolveBackfill = resolve;
      }),
    );

    const pending = component.onBackfillHeights();
    expect(component.backfillingHeights()).toBe(true);

    resolveBackfill({ ...noHeight, height_ft_max: 40 });
    await pending;

    expect(component.backfillingHeights()).toBe(false);
  });
});
