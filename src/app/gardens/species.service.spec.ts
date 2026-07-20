import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Species, SpeciesService } from './species.service';
import { SupabaseService } from '../supabase.service';
import { PerenualService } from './perenual.service';
import { PlantIdCandidate } from './plant-id.service';
import { PlantDimensionService } from './plant-dimension.service';

const CANDIDATE: PlantIdCandidate = {
  scientificName: 'Lavandula angustifolia',
  commonNames: ['English lavender', 'True lavender'],
  score: 0.87,
  thumbnailUrl: null,
};

const EXISTING: Species = {
  id: 'sp-1',
  user_id: 'user-1',
  common_name: 'Lavender',
  scientific_name: 'Lavandula angustifolia',
  display_number: 3,
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
};

describe('SpeciesService.ensureByIdentification', () => {
  let service: SpeciesService;

  // One vi.fn() per terminal Supabase call; the chain methods in between
  // are recreated per `from()` call so different queries don't collide.
  //
  // Name lookups go through .select().ilike(col, val).limit(1).maybeSingle().
  // Each maybeSingle() shifts the next result off `findResults` (empty
  // queue = miss), and `ilikeMock` records which column/value pairs were
  // queried so tests can assert the search priority order.
  const findResults: Array<Species | null> = [];
  const maybeSingleMock = vi.fn();
  const ilikeMock = vi.fn(() => ({
    limit: vi.fn(() => ({ maybeSingle: maybeSingleMock })),
  }));
  const updateSingleMock = vi.fn();
  const insertSingleMock = vi.fn();
  const maxMaybeSingleMock = vi.fn();
  const insertPayloads: unknown[] = [];

  const supabaseMock = {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          ilike: ilikeMock,
          order: vi.fn(() => ({
            limit: vi.fn(() => ({ maybeSingle: maxMaybeSingleMock })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({ single: updateSingleMock })),
          })),
        })),
        insert: vi.fn((payload: unknown) => {
          insertPayloads.push(payload);
          return { select: vi.fn(() => ({ single: insertSingleMock })) };
        }),
      })),
    },
  };

  const perenualMock = { searchByScientificName: vi.fn() };
  const dimensionMock = { lookup: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    insertPayloads.length = 0;
    findResults.length = 0;
    maybeSingleMock.mockImplementation(() =>
      Promise.resolve({ data: findResults.shift() ?? null, error: null }),
    );
    // Default: dimension lookup returns nothing, so existing tests that don't
    // care about dimensions are unaffected.
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: null,
      heightFtMax: null,
      spreadFtMin: null,
      spreadFtMax: null,
    });
    supabaseMock.client.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: PerenualService, useValue: perenualMock },
        { provide: PlantDimensionService, useValue: dimensionMock },
      ],
    });
    service = TestBed.inject(SpeciesService);
  });

  it('returns an existing species without calling Perenual', async () => {
    findResults.push(EXISTING); // first lookup (scientific_name) hits

    const result = await service.ensureByIdentification(CANDIDATE);

    expect(result).toEqual(EXISTING);
    expect(ilikeMock).toHaveBeenCalledWith('scientific_name', 'Lavandula angustifolia');
    expect(perenualMock.searchByScientificName).not.toHaveBeenCalled();
  });

  it('backfills scientific_name on an existing species that lacks it', async () => {
    const unidentified = { ...EXISTING, scientific_name: null };
    const backfilled = { ...EXISTING };
    findResults.push(unidentified);
    updateSingleMock.mockResolvedValue({ data: backfilled, error: null });

    const result = await service.ensureByIdentification(CANDIDATE);
    expect(result.scientific_name).toBe('Lavandula angustifolia');
  });

  it('finds a species typed by common name when photo-identifying it', async () => {
    // scientific_name miss, common_name(scientificName) miss, then the
    // candidate's common name hits a row that predates identification.
    const typedFirst = { ...EXISTING, common_name: 'English lavender', scientific_name: null };
    findResults.push(null, null, typedFirst);
    updateSingleMock.mockResolvedValue({ data: { ...EXISTING }, error: null });

    const result = await service.ensureByIdentification(CANDIDATE);

    expect(ilikeMock.mock.calls).toEqual([
      ['scientific_name', 'Lavandula angustifolia'],
      ['common_name', 'Lavandula angustifolia'],
      ['common_name', 'English lavender'],
    ]);
    expect(updateSingleMock).toHaveBeenCalled();
    expect(result.scientific_name).toBe('Lavandula angustifolia');
    expect(perenualMock.searchByScientificName).not.toHaveBeenCalled();
  });

  it('recovers from a unique-violation race by re-reading', async () => {
    // All three pre-insert lookups miss; the insert collides with the
    // per-user unique name index; the re-read then finds the winner.
    findResults.push(null, null, null, EXISTING);
    maxMaybeSingleMock.mockResolvedValue({ data: { display_number: 7 }, error: null });
    perenualMock.searchByScientificName.mockResolvedValue(null);
    insertSingleMock.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    const result = await service.ensureByIdentification(CANDIDATE);

    expect(result).toEqual(EXISTING);
  });

  it('creates a Perenual-enriched species when no match exists', async () => {
    maxMaybeSingleMock.mockResolvedValue({ data: { display_number: 7 }, error: null });
    perenualMock.searchByScientificName.mockResolvedValue({
      externalId: '2',
      heightFtMin: 1,
      heightFtMax: 3,
      raw: { id: 2 },
    });
    insertSingleMock.mockResolvedValue({
      data: { ...EXISTING, id: 'sp-new', display_number: 8 },
      error: null,
    });

    await service.ensureByIdentification(CANDIDATE);

    expect(insertPayloads[0]).toEqual({
      user_id: 'user-1',
      common_name: 'English lavender',
      scientific_name: 'Lavandula angustifolia',
      display_number: 8,
      external_source: 'perenual',
      external_id: '2',
      height_ft_min: 1,
      height_ft_max: 3,
      external_data: { id: 2 },
      dimensions_source: 'perenual',
    });
  });

  it('creates a plantnet-only species when Perenual finds nothing', async () => {
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue(null);
    insertSingleMock.mockResolvedValue({
      data: { ...EXISTING, id: 'sp-new', display_number: 1 },
      error: null,
    });

    await service.ensureByIdentification(CANDIDATE);

    expect(insertPayloads[0]).toMatchObject({
      common_name: 'English lavender',
      scientific_name: 'Lavandula angustifolia',
      display_number: 1,
      external_source: 'plantnet',
    });
    const payload = insertPayloads[0] as Record<string, unknown>;
    expect(payload['external_id']).toBeUndefined();
    expect(payload['height_ft_min']).toBeUndefined();
  });

  it('falls back to the scientific name when the candidate has no common names', async () => {
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue(null);
    insertSingleMock.mockResolvedValue({ data: EXISTING, error: null });

    await service.ensureByIdentification({ ...CANDIDATE, commonNames: [] });

    expect(insertPayloads[0]).toMatchObject({
      common_name: 'Lavandula angustifolia',
    });
  });

  it('fills height + spread from the LLM when Perenual has no dimensions', async () => {
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue({
      externalId: '2',
      heightFtMin: null,
      heightFtMax: null,
      raw: { id: 2 },
    });
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: 1,
      heightFtMax: 3,
      spreadFtMin: 1,
      spreadFtMax: 2,
    });
    insertSingleMock.mockResolvedValue({ data: { ...EXISTING, id: 'sp-new' }, error: null });

    await service.ensureByIdentification(CANDIDATE);

    expect(dimensionMock.lookup).toHaveBeenCalledWith('Lavandula angustifolia', 'English lavender');
    expect(insertPayloads[0]).toMatchObject({
      height_ft_min: 1,
      height_ft_max: 3,
      spread_ft_min: 1,
      spread_ft_max: 2,
      dimensions_source: 'llm',
    });
  });

  it('prefers Perenual height over the LLM but takes spread from the LLM', async () => {
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue({
      externalId: '2',
      heightFtMin: 2,
      heightFtMax: 5,
      raw: { id: 2 },
    });
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: 1,
      heightFtMax: 3,
      spreadFtMin: 1,
      spreadFtMax: 2,
    });
    insertSingleMock.mockResolvedValue({ data: { ...EXISTING, id: 'sp-new' }, error: null });

    await service.ensureByIdentification(CANDIDATE);

    expect(insertPayloads[0]).toMatchObject({
      height_ft_min: 2,
      height_ft_max: 5,
      spread_ft_min: 1,
      spread_ft_max: 2,
      dimensions_source: 'perenual',
    });
  });

  it('leaves dimensions_source null when neither source has dimensions', async () => {
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue(null);
    // dimensionMock default returns all-nulls.
    insertSingleMock.mockResolvedValue({ data: { ...EXISTING, id: 'sp-new' }, error: null });

    await service.ensureByIdentification(CANDIDATE);

    const payload = insertPayloads[0] as Record<string, unknown>;
    expect(payload['dimensions_source']).toBeUndefined();
    expect(payload['spread_ft_min']).toBeUndefined();
  });

  it('does not call the dimension lookup when an existing species is found', async () => {
    findResults.push(EXISTING); // first lookup hits

    await service.ensureByIdentification(CANDIDATE);

    expect(dimensionMock.lookup).not.toHaveBeenCalled();
  });
});

describe('SpeciesService.backfillDimensions', () => {
  let service: SpeciesService;

  const NO_HEIGHT: Species = {
    id: 'sp-2',
    user_id: 'user-1',
    common_name: 'Oak sapling',
    scientific_name: 'Quercus rubra',
    display_number: 4,
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
  };

  const updateSingleMock = vi.fn();
  const eqMock = vi.fn(() => ({ select: vi.fn(() => ({ single: updateSingleMock })) }));
  const updateMock = vi.fn(() => ({ eq: eqMock }));
  const dimensionMock = { lookup: vi.fn() };

  const supabaseMock = {
    client: {
      from: vi.fn(() => ({ update: updateMock })),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: PerenualService, useValue: { searchByScientificName: vi.fn() } },
        { provide: PlantDimensionService, useValue: dimensionMock },
      ],
    });
    service = TestBed.inject(SpeciesService);
  });

  it('looks up dimensions and persists them when found', async () => {
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: 20,
      heightFtMax: 60,
      spreadFtMin: 15,
      spreadFtMax: 40,
    });
    const updated = { ...NO_HEIGHT, height_ft_min: 20, height_ft_max: 60 };
    updateSingleMock.mockResolvedValue({ data: updated, error: null });

    const result = await service.backfillDimensions(NO_HEIGHT);

    expect(dimensionMock.lookup).toHaveBeenCalledWith('Quercus rubra', 'Oak sapling');
    expect(updateMock).toHaveBeenCalledWith({
      height_ft_min: 20,
      height_ft_max: 60,
      spread_ft_min: 15,
      spread_ft_max: 40,
      dimensions_source: 'llm',
    });
    expect(eqMock).toHaveBeenCalledWith('id', 'sp-2');
    expect(result).toEqual(updated);
  });

  it('returns the species unchanged when the lookup finds nothing', async () => {
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: null,
      heightFtMax: null,
      spreadFtMin: null,
      spreadFtMax: null,
    });

    const result = await service.backfillDimensions(NO_HEIGHT);

    expect(updateMock).not.toHaveBeenCalled();
    expect(result).toEqual(NO_HEIGHT);
  });

  it('returns the species unchanged without calling the lookup when it has no scientific name', async () => {
    const unidentified = { ...NO_HEIGHT, scientific_name: null };

    const result = await service.backfillDimensions(unidentified);

    expect(dimensionMock.lookup).not.toHaveBeenCalled();
    expect(result).toEqual(unidentified);
  });

  it('returns the species unchanged when the update fails', async () => {
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: 20,
      heightFtMax: 60,
      spreadFtMin: null,
      spreadFtMax: null,
    });
    updateSingleMock.mockResolvedValue({ data: null, error: new Error('boom') });

    const result = await service.backfillDimensions(NO_HEIGHT);

    expect(result).toEqual(NO_HEIGHT);
  });
});
