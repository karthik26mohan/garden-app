import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * Perenual data mapped to the species table's external columns.
 * See supabase/migrations/20260531000001_species_external_cache.sql
 * and DECISIONS.md Entry #14.
 */
export interface PerenualSpeciesData {
  externalId: string;
  heightFtMin: number | null;
  heightFtMax: number | null;
  /** Full API response, cached into species.external_data (jsonb). */
  raw: unknown;
}

interface PerenualListItem {
  id: number;
  common_name?: string;
  scientific_name?: string[];
}

const BASE_URL = 'https://perenual.com/api';
const METERS_TO_FEET = 3.28084;

/**
 * Pick the search result whose scientific_name matches exactly
 * (case-insensitive); otherwise the first result; null if empty.
 * Pure function, exported for testing.
 */
export function pickBestMatch(
  items: PerenualListItem[],
  scientificName: string,
): PerenualListItem | null {
  if (!items.length) return null;
  const wanted = scientificName.trim().toLowerCase();
  const exact = items.find((item) =>
    (item.scientific_name ?? []).some((n) => n.trim().toLowerCase() === wanted),
  );
  return exact ?? items[0];
}

/**
 * Extract min/max mature height in feet from a Perenual details response.
 * Handles both the structured `dimensions` array and the legacy
 * `dimension` string ("3-6 feet"). Pure function, exported for testing.
 */
export function extractHeightFt(details: unknown): {
  min: number | null;
  max: number | null;
} {
  const d = details as {
    dimensions?: { type?: string; min_value?: number; max_value?: number; unit?: string }[];
    dimension?: string;
  } | null;

  const height = d?.dimensions?.find((dim) => dim.type?.toLowerCase() === 'height');
  if (height && typeof height.min_value === 'number' && typeof height.max_value === 'number') {
    const factor = height.unit?.toLowerCase().startsWith('m') ? METERS_TO_FEET : 1;
    const round = (n: number) => Math.round(n * factor * 100) / 100;
    return { min: round(height.min_value), max: round(height.max_value) };
  }

  const text = d?.dimension;
  const match = text?.match(/([\d.]+)\s*-\s*([\d.]+)\s*feet/i);
  if (match) {
    return { min: parseFloat(match[1]), max: parseFloat(match[2]) };
  }

  return { min: null, max: null };
}

/**
 * Best-effort lookup against the Perenual plant database. Every public
 * method resolves to null on failure instead of throwing: Perenual
 * enrichment is a bonus, never a blocker, per the spec's error-handling
 * table. (Same client-side-key tradeoff as DECISIONS.md Entry #14.)
 */
@Injectable({ providedIn: 'root' })
export class PerenualService {
  /**
   * Search Perenual by scientific name and fetch growing details for
   * the best match. Two API calls (one species-list, one details).
   */
  async searchByScientificName(scientificName: string): Promise<PerenualSpeciesData | null> {
    const key = encodeURIComponent(environment.perenual.apiKey);

    try {
      const searchRes = await fetch(
        `${BASE_URL}/species-list?key=${key}&q=${encodeURIComponent(scientificName)}`,
      );
      if (!searchRes.ok) return null;

      const searchJson = (await searchRes.json()) as { data?: PerenualListItem[] };
      const best = pickBestMatch(searchJson.data ?? [], scientificName);
      if (!best) return null;

      // Details call enriches with height; if it fails we still return
      // the id + search payload so the species records its external link.
      const detailsRes = await fetch(`${BASE_URL}/species/details/${best.id}?key=${key}`);
      if (!detailsRes.ok) {
        return {
          externalId: String(best.id),
          heightFtMin: null,
          heightFtMax: null,
          raw: best,
        };
      }

      const details = await detailsRes.json();
      const height = extractHeightFt(details);
      return {
        externalId: String(best.id),
        heightFtMin: height.min,
        heightFtMax: height.max,
        raw: details,
      };
    } catch {
      return null; // network failure → best-effort null
    }
  }
}
