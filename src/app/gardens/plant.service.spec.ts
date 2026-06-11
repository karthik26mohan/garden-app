import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PlantService } from './plant.service';
import { SupabaseService } from '../supabase.service';

describe('PlantService.create', () => {
  let service: PlantService;
  const singleMock = vi.fn();
  const insertPayloads: unknown[] = [];

  const supabaseMock = {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(() => ({
        insert: vi.fn((payload: unknown) => {
          insertPayloads.push(payload);
          return { select: vi.fn(() => ({ single: singleMock })) };
        }),
      })),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    insertPayloads.length = 0;
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: supabaseMock }],
    });
    service = TestBed.inject(PlantService);
  });

  it('includes plantnet_score when provided', async () => {
    singleMock.mockResolvedValue({ data: { id: 'p1' }, error: null });

    await service.create({
      garden_id: 'g1',
      species_id: 'sp1',
      plantnet_score: 0.87,
    });

    expect(insertPayloads[0]).toMatchObject({ plantnet_score: 0.87 });
  });

  it('omits plantnet_score when absent (typed-name path unchanged)', async () => {
    singleMock.mockResolvedValue({ data: { id: 'p1' }, error: null });

    await service.create({ garden_id: 'g1', species_id: 'sp1' });

    expect(Object.keys(insertPayloads[0] as Record<string, unknown>)).not.toContain(
      'plantnet_score',
    );
  });
});
