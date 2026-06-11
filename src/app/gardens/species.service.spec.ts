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
  const maybeSingleMock = vi.fn();
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
          or: vi.fn(() => ({ maybeSingle: maybeSingleMock })),
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
    maybeSingleMock.mockResolvedValue({ data: EXISTING, error: null });

    const result = await service.ensureByIdentification(CANDIDATE);

    expect(result).toEqual(EXISTING);
    expect(perenualMock.searchByScientificName).not.toHaveBeenCalled();
  });

  it('backfills scientific_name on an existing species that lacks it', async () => {
    const unidentified = { ...EXISTING, scientific_name: null };
    const backfilled = { ...EXISTING };
    maybeSingleMock.mockResolvedValue({ data: unidentified, error: null });
    updateSingleMock.mockResolvedValue({ data: backfilled, error: null });

    const result = await service.ensureByIdentification(CANDIDATE);
    expect(result.scientific_name).toBe('Lavandula angustifolia');
  });

  it('creates a Perenual-enriched species when no match exists', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
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
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
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
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue(null);
    insertSingleMock.mockResolvedValue({ data: EXISTING, error: null });

    await service.ensureByIdentification({ ...CANDIDATE, commonNames: [] });

    expect(insertPayloads[0]).toMatchObject({
      common_name: 'Lavandula angustifolia',
    });
  });
});
