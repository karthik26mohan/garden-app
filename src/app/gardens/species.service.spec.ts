import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Species, SpeciesService } from './species.service';
import { SupabaseService } from '../supabase.service';
import { PerenualService } from './perenual.service';
import { PlantIdCandidate } from './plant-id.service';

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

  beforeEach(() => {
    vi.clearAllMocks();
    insertPayloads.length = 0;
    findResults.length = 0;
    maybeSingleMock.mockImplementation(() =>
      Promise.resolve({ data: findResults.shift() ?? null, error: null }),
    );
    supabaseMock.client.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: PerenualService, useValue: perenualMock },
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
});
