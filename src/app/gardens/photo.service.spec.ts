import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PhotoService, scaledDimensions } from './photo.service';
import { SupabaseService } from '../supabase.service';

describe('scaledDimensions', () => {
  it('scales the long edge down to max, preserving aspect ratio', () => {
    expect(scaledDimensions(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(scaledDimensions(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('never upscales smaller images', () => {
    expect(scaledDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('rounds to whole pixels', () => {
    expect(scaledDimensions(3001, 2000, 1600)).toEqual({ width: 1600, height: 1066 });
  });
});

describe('PhotoService', () => {
  let service: PhotoService;

  // Chainable mock of the slice of SupabaseClient that PhotoService uses.
  const uploadMock = vi.fn();
  const createSignedUrlsMock = vi.fn();
  const insertMock = vi.fn();
  const inMock = vi.fn();
  const supabaseMock = {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      storage: {
        from: vi.fn(() => ({
          upload: uploadMock,
          createSignedUrls: createSignedUrlsMock,
        })),
      },
      from: vi.fn(() => ({
        insert: insertMock,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ in: inMock })),
        })),
      })),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.client.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: supabaseMock }],
    });
    service = TestBed.inject(PhotoService);
  });

  describe('uploadPlantPhoto', () => {
    it('uploads under the user/plant path and inserts a primary plant_photos row', async () => {
      uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null });
      insertMock.mockResolvedValue({ error: null });

      await service.uploadPlantPhoto('plant-9', new Blob(['img']));

      const [path, blob, opts] = uploadMock.mock.calls[0];
      expect(path).toMatch(/^user-1\/plant-9\/[0-9a-f-]+\.jpg$/);
      expect(blob).toBeInstanceOf(Blob);
      expect(opts).toMatchObject({ contentType: 'image/jpeg' });
      expect(insertMock).toHaveBeenCalledWith({
        plant_id: 'plant-9',
        storage_path: path,
        is_primary: true,
      });
    });

    it('throws when the storage upload fails', async () => {
      uploadMock.mockResolvedValue({ data: null, error: new Error('storage down') });
      await expect(service.uploadPlantPhoto('plant-9', new Blob(['img']))).rejects.toThrow(
        'storage down',
      );
      expect(insertMock).not.toHaveBeenCalled();
    });

    it('throws when not signed in', async () => {
      supabaseMock.client.auth.getUser.mockResolvedValue({ data: { user: null } });
      await expect(service.uploadPlantPhoto('plant-9', new Blob(['img']))).rejects.toThrow(
        'Not signed in.',
      );
    });
  });

  describe('getPrimaryPhotoUrls', () => {
    it('returns a plant_id → signed URL map', async () => {
      inMock.mockResolvedValue({
        data: [
          { plant_id: 'p1', storage_path: 'user-1/p1/a.jpg' },
          { plant_id: 'p2', storage_path: 'user-1/p2/b.jpg' },
        ],
        error: null,
      });
      createSignedUrlsMock.mockResolvedValue({
        data: [
          { path: 'user-1/p1/a.jpg', signedUrl: 'https://signed/a' },
          { path: 'user-1/p2/b.jpg', signedUrl: 'https://signed/b' },
        ],
        error: null,
      });

      const map = await service.getPrimaryPhotoUrls(['p1', 'p2']);
      expect(map).toEqual({ p1: 'https://signed/a', p2: 'https://signed/b' });
    });

    it('returns {} for an empty input without calling Supabase', async () => {
      await expect(service.getPrimaryPhotoUrls([])).resolves.toEqual({});
      expect(inMock).not.toHaveBeenCalled();
    });

    it('returns {} when the photo query errors (thumbnails are best-effort)', async () => {
      inMock.mockResolvedValue({ data: null, error: new Error('rls says no') });
      await expect(service.getPrimaryPhotoUrls(['p1'])).resolves.toEqual({});
    });
  });
});
