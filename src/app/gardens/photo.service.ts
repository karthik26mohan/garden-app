import { inject, Injectable } from '@angular/core';
import { SupabaseService } from '../supabase.service';

const BUCKET = 'plant-photos';
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.85;
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Compute target dimensions for a resize: long edge capped at maxEdge,
 * aspect ratio preserved, never upscaled. Pure function, exported for
 * testing (the canvas plumbing around it can't run in jsdom).
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Photo handling: client-side resize, Storage upload, plant_photos rows,
 * signed display URLs.
 *
 * Storage layout: {user_id}/{plant_id}/{uuid}.jpg in the private
 * 'plant-photos' bucket. The user_id prefix is what the storage RLS
 * policies key on (migration 20260610000001).
 *
 * Browser-only (canvas, createImageBitmap): callers are components that
 * already run behind isPlatformBrowser guards.
 */
@Injectable({ providedIn: 'root' })
export class PhotoService {
  private supabase = inject(SupabaseService);

  /**
   * Downscale an image to ≤1600px on the long edge, re-encoded as JPEG.
   * Keeps uploads fast and stays far inside Pl@ntNet's size limits.
   */
  async resizeImage(file: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(file);
    try {
      const { width, height } = scaledDimensions(bitmap.width, bitmap.height, MAX_EDGE_PX);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed.'))),
          'image/jpeg',
          JPEG_QUALITY,
        );
      });
    } finally {
      bitmap.close();
    }
  }

  /**
   * Upload a (already resized) photo for a plant and record it as the
   * plant's primary photo. Throws on failure — the CALLER decides that
   * photo failure is non-fatal (the plant row already exists by then).
   */
  async uploadPlantPhoto(plantId: string, photo: Blob): Promise<void> {
    const {
      data: { user },
    } = await this.supabase.client.auth.getUser();
    if (!user) throw new Error('Not signed in.');

    const path = `${user.id}/${plantId}/${crypto.randomUUID()}.jpg`;

    const { error: uploadError } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(path, photo, { contentType: 'image/jpeg' });
    if (uploadError) throw uploadError;

    const { error: insertError } = await this.supabase.client
      .from('plant_photos')
      .insert({ plant_id: plantId, storage_path: path, is_primary: true });
    if (insertError) throw insertError;
  }

  /**
   * Map plant ids to signed URLs for their primary photos. Best-effort:
   * any failure returns {} (or partial data) rather than throwing,
   * because thumbnails are decoration — the page must render without
   * them. Signed URLs expire after an hour; pages re-fetch on mount.
   */
  async getPrimaryPhotoUrls(plantIds: string[]): Promise<Record<string, string>> {
    if (!plantIds.length) return {};

    const { data, error } = await this.supabase.client
      .from('plant_photos')
      .select('plant_id, storage_path')
      .eq('is_primary', true)
      .in('plant_id', plantIds);
    if (error || !data?.length) return {};

    const { data: signed, error: signError } = await this.supabase.client.storage
      .from(BUCKET)
      .createSignedUrls(
        data.map((row) => row.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    if (signError || !signed) return {};

    const urlByPath = new Map(
      signed.filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl] as const),
    );
    return Object.fromEntries(
      data
        .map((row) => [row.plant_id, urlByPath.get(row.storage_path)] as const)
        .filter((entry): entry is [string, string] => !!entry[1]),
    );
  }
}
