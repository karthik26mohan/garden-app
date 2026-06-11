import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { extractHeightFt, PerenualService, pickBestMatch } from './perenual.service';

describe('pickBestMatch', () => {
  const items = [
    { id: 1, common_name: 'Lavender hybrid', scientific_name: ['Lavandula x intermedia'] },
    { id: 2, common_name: 'English lavender', scientific_name: ['Lavandula angustifolia'] },
  ];

  it('prefers an exact scientific-name match (case-insensitive)', () => {
    expect(pickBestMatch(items, 'lavandula ANGUSTIFOLIA')?.id).toBe(2);
  });

  it('falls back to the first result when nothing matches exactly', () => {
    expect(pickBestMatch(items, 'Lavandula somethingelse')?.id).toBe(1);
  });

  it('returns null for an empty list', () => {
    expect(pickBestMatch([], 'Lavandula angustifolia')).toBeNull();
  });
});

describe('extractHeightFt', () => {
  it('reads a dimensions array in feet', () => {
    const details = {
      dimensions: [{ type: 'Height', min_value: 1, max_value: 3, unit: 'feet' }],
    };
    expect(extractHeightFt(details)).toEqual({ min: 1, max: 3 });
  });

  it('converts meters to feet (2 decimal places)', () => {
    const details = {
      dimensions: [{ type: 'Height', min_value: 1, max_value: 2, unit: 'meters' }],
    };
    expect(extractHeightFt(details)).toEqual({ min: 3.28, max: 6.56 });
  });

  it('parses a legacy dimension string like "3-6 feet"', () => {
    expect(extractHeightFt({ dimension: '3-6 feet' })).toEqual({ min: 3, max: 6 });
  });

  it('returns nulls when no height data exists', () => {
    expect(extractHeightFt({})).toEqual({ min: null, max: null });
    expect(extractHeightFt({ dimensions: [] })).toEqual({ min: null, max: null });
    expect(extractHeightFt({ dimension: 'tall-ish' })).toEqual({ min: null, max: null });
  });
});

describe('PerenualService.searchByScientificName', () => {
  let service: PerenualService;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    TestBed.configureTestingModule({});
    service = TestBed.inject(PerenualService);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('searches, picks the best match, fetches details, returns mapped data', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 2,
                common_name: 'English lavender',
                scientific_name: ['Lavandula angustifolia'],
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 2,
            dimensions: [{ type: 'Height', min_value: 1, max_value: 3, unit: 'feet' }],
            watering: 'Average',
          }),
          { status: 200 },
        ),
      );

    const result = await service.searchByScientificName('Lavandula angustifolia');

    expect(result).not.toBeNull();
    expect(result!.externalId).toBe('2');
    expect(result!.heightFtMin).toBe(1);
    expect(result!.heightFtMax).toBe(3);
    expect(result!.raw).toMatchObject({ watering: 'Average' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('species-list');
    expect(String(fetchMock.mock.calls[1][0])).toContain('species/details/2');
  });

  it('returns null when the search has no results', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(service.searchByScientificName('Nonexistus plantus')).resolves.toBeNull();
  });

  it('returns null (not throw) on HTTP errors — Perenual is best-effort', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(service.searchByScientificName('Lavandula angustifolia')).resolves.toBeNull();
  });

  it('still returns search-derived data when the details call fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: 2, scientific_name: ['Lavandula angustifolia'] }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('nope', { status: 500 }));

    const result = await service.searchByScientificName('Lavandula angustifolia');
    expect(result).toEqual({
      externalId: '2',
      heightFtMin: null,
      heightFtMax: null,
      raw: { id: 2, scientific_name: ['Lavandula angustifolia'] },
    });
  });

  it('still returns search-derived data when the details body is malformed', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: 2, scientific_name: ['Lavandula angustifolia'] }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('not json', { status: 200 }));

    const result = await service.searchByScientificName('Lavandula angustifolia');
    expect(result).toEqual({
      externalId: '2',
      heightFtMin: null,
      heightFtMax: null,
      raw: { id: 2, scientific_name: ['Lavandula angustifolia'] },
    });
  });
});
