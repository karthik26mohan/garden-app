import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  mapPlantNetResponse,
  PlantIdCandidate,
  PlantIdError,
  PlantIdService,
} from './plant-id.service';

/** A realistic trimmed Pl@ntNet /v2/identify response. */
const PLANTNET_RESPONSE = {
  results: [
    {
      score: 0.8721,
      species: {
        scientificNameWithoutAuthor: 'Lavandula angustifolia',
        commonNames: ['English lavender', 'True lavender'],
      },
      images: [{ url: { m: 'https://bs.plantnet.org/image/m/abc123' } }],
    },
    {
      score: 0.0512,
      species: {
        scientificNameWithoutAuthor: 'Lavandula stoechas',
        commonNames: [],
      },
      images: [],
    },
    {
      score: 0.0211,
      species: {
        scientificNameWithoutAuthor: 'Salvia officinalis',
        commonNames: ['Sage'],
      },
    },
    {
      score: 0.0099,
      species: {
        scientificNameWithoutAuthor: 'Rosmarinus officinalis',
        commonNames: ['Rosemary'],
      },
    },
  ],
};

describe('mapPlantNetResponse', () => {
  it('maps results to candidates, capped at top 3', () => {
    const candidates = mapPlantNetResponse(PLANTNET_RESPONSE);
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toEqual<PlantIdCandidate>({
      scientificName: 'Lavandula angustifolia',
      commonNames: ['English lavender', 'True lavender'],
      score: 0.8721,
      thumbnailUrl: 'https://bs.plantnet.org/image/m/abc123',
    });
  });

  it('uses null thumbnail when images are missing or empty', () => {
    const candidates = mapPlantNetResponse(PLANTNET_RESPONSE);
    expect(candidates[1].thumbnailUrl).toBeNull(); // empty images array
    expect(candidates[2].thumbnailUrl).toBeNull(); // no images key
  });

  it('returns [] for an empty or malformed response', () => {
    expect(mapPlantNetResponse({ results: [] })).toEqual([]);
    expect(mapPlantNetResponse({})).toEqual([]);
    expect(mapPlantNetResponse(null)).toEqual([]);
  });

  it('skips entries lacking a scientific name or numeric score', () => {
    const candidates = mapPlantNetResponse({
      results: [
        { score: 0.5, species: {} }, // no scientificNameWithoutAuthor
        { species: { scientificNameWithoutAuthor: 'Salvia officinalis' } }, // no score
        { score: 0.4, species: { scientificNameWithoutAuthor: 'Rosa canina', commonNames: [] } },
      ],
    });
    expect(candidates).toEqual([
      { scientificName: 'Rosa canina', commonNames: [], score: 0.4, thumbnailUrl: null },
    ]);
  });
});

describe('PlantIdService.identify', () => {
  let service: PlantIdService;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    TestBed.configureTestingModule({});
    service = TestBed.inject(PlantIdService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs multipart form data with organs=auto and returns candidates', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(PLANTNET_RESPONSE), { status: 200 }));

    const candidates = await service.identify(new Blob(['x']));

    expect(candidates).toHaveLength(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('my-api.plantnet.org/v2/identify/all');
    expect(String(url)).toContain('api-key=');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('organs')).toBe('auto');
    expect((init.body as FormData).get('images')).toBeInstanceOf(Blob);
  });

  it('returns [] on 404 (species not found)', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(service.identify(new Blob(['x']))).resolves.toEqual([]);
  });

  it('throws a quota message on 429', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('slow down', { status: 429 })));
    await expect(service.identify(new Blob(['x']))).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('limit'),
    });
    await expect(service.identify(new Blob(['x']))).rejects.toBeInstanceOf(PlantIdError);
  });

  it('throws PlantIdError with status on other HTTP errors', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(service.identify(new Blob(['x']))).rejects.toMatchObject({
      status: 500,
    });
  });

  it('throws an unexpected-response error when a 200 body is not JSON', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('<html>maintenance</html>', { status: 200 })),
    );
    await expect(service.identify(new Blob(['x']))).rejects.toBeInstanceOf(PlantIdError);
    await expect(service.identify(new Blob(['x']))).rejects.toMatchObject({
      status: 0,
      message: 'The plant identification service returned an unexpected response.',
    });
  });

  it('wraps network failures in PlantIdError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(service.identify(new Blob(['x']))).rejects.toBeInstanceOf(PlantIdError);
    await expect(service.identify(new Blob(['x']))).rejects.toMatchObject({ status: 0 });
  });
});
