import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * One species candidate from a Pl@ntNet identification, in app shape.
 * The raw API response is mapped through mapPlantNetResponse() so the
 * rest of the app never touches Pl@ntNet's nested JSON.
 */
export interface PlantIdCandidate {
  scientificName: string;
  commonNames: string[];
  /** Pl@ntNet confidence, 0..1. Stored on the plant row as plantnet_score. */
  score: number;
  /** Medium-size reference image of the candidate species, if provided. */
  thumbnailUrl: string | null;
}

/** Thrown when Pl@ntNet returns a non-OK status, with a user-facing message. */
export class PlantIdError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const IDENTIFY_URL = 'https://my-api.plantnet.org/v2/identify/all';
const MAX_CANDIDATES = 3;

/**
 * Map a raw Pl@ntNet /v2/identify response to the top candidates.
 * Pure function, exported for testing. Defensive about shape: any
 * missing/malformed pieces produce an empty array rather than a throw,
 * because a "we couldn't identify this" UI state is the desired
 * behavior for all garbage-in cases.
 */
export function mapPlantNetResponse(json: unknown): PlantIdCandidate[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];

  return results.slice(0, MAX_CANDIDATES).flatMap((r) => {
    const result = r as {
      score?: number;
      species?: {
        scientificNameWithoutAuthor?: string;
        commonNames?: string[];
      };
      images?: { url?: { m?: string } }[];
    };
    const scientificName = result.species?.scientificNameWithoutAuthor;
    if (!scientificName || typeof result.score !== 'number') return [];

    return [
      {
        scientificName,
        commonNames: result.species?.commonNames ?? [],
        score: result.score,
        thumbnailUrl: result.images?.[0]?.url?.m ?? null,
      },
    ];
  });
}

/**
 * Calls Pl@ntNet's identification API directly from the browser.
 *
 * Client-direct architecture per the spec: the API key ships in the
 * bundle (same accepted tradeoff as the Perenual key, DECISIONS.md
 * Entry #14) and the app's origins must be registered under
 * "Authorized domains" in the Pl@ntNet account for CORS to pass.
 */
@Injectable({ providedIn: 'root' })
export class PlantIdService {
  /**
   * Identify a plant photo. Returns the top 3 candidates, possibly
   * empty (= "couldn't identify"). Throws PlantIdError on HTTP errors
   * so the UI can show a reason and fall back to typed names.
   */
  async identify(photo: Blob): Promise<PlantIdCandidate[]> {
    const form = new FormData();
    form.append('images', photo, 'photo.jpg');
    form.append('organs', 'auto');

    const url = `${IDENTIFY_URL}?api-key=${encodeURIComponent(environment.plantnet.apiKey)}`;
    const res = await fetch(url, { method: 'POST', body: form });

    if (!res.ok) {
      // 404 = "species not found" for identify — treat as no candidates.
      if (res.status === 404) return [];
      const message =
        res.status === 429
          ? 'Daily identification limit reached — try again tomorrow, or type the name.'
          : `Plant identification failed (HTTP ${res.status}).`;
      throw new PlantIdError(message, res.status);
    }

    return mapPlantNetResponse(await res.json());
  }
}
