import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PlantDimensionService } from './plant-dimension.service';
import { SupabaseService } from '../supabase.service';

describe('PlantDimensionService.lookup', () => {
  let service: PlantDimensionService;
  const invokeMock = vi.fn();
  const supabaseMock = {
    client: { functions: { invoke: invokeMock } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: supabaseMock }],
    });
    service = TestBed.inject(PlantDimensionService);
  });

  it('invokes the edge function with scientific + common name and maps the result', async () => {
    invokeMock.mockResolvedValue({
      data: { heightFtMin: 1, heightFtMax: 3, spreadFtMin: 1, spreadFtMax: 2 },
      error: null,
    });

    const dims = await service.lookup('Lavandula angustifolia', 'English lavender');

    expect(invokeMock).toHaveBeenCalledWith('plant-dimensions', {
      body: {
        scientificName: 'Lavandula angustifolia',
        commonName: 'English lavender',
      },
    });
    expect(dims).toEqual({
      heightFtMin: 1,
      heightFtMax: 3,
      spreadFtMin: 1,
      spreadFtMax: 2,
    });
  });

  it('omits commonName from the body when not provided', async () => {
    invokeMock.mockResolvedValue({
      data: { heightFtMin: null, heightFtMax: null, spreadFtMin: null, spreadFtMax: null },
      error: null,
    });

    await service.lookup('Lavandula angustifolia');

    expect(invokeMock).toHaveBeenCalledWith('plant-dimensions', {
      body: { scientificName: 'Lavandula angustifolia' },
    });
  });

  it('returns all-nulls when the function returns an error', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('boom') });

    await expect(service.lookup('Rosa canina')).resolves.toEqual({
      heightFtMin: null,
      heightFtMax: null,
      spreadFtMin: null,
      spreadFtMax: null,
    });
  });

  it('returns all-nulls when invoke throws (network failure)', async () => {
    invokeMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(service.lookup('Rosa canina')).resolves.toEqual({
      heightFtMin: null,
      heightFtMax: null,
      spreadFtMin: null,
      spreadFtMax: null,
    });
  });

  it('coerces a missing/partial payload to all-nulls fields', async () => {
    invokeMock.mockResolvedValue({ data: { heightFtMax: 5 }, error: null });

    await expect(service.lookup('Rosa canina')).resolves.toEqual({
      heightFtMin: null,
      heightFtMax: 5,
      spreadFtMin: null,
      spreadFtMax: null,
    });
  });
});
