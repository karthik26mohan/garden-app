import { inject, Injectable } from '@angular/core';
import { SupabaseService } from '../supabase.service';

/** Mature plant dimensions in feet; any field null when unknown. */
export interface PlantDimensions {
  heightFtMin: number | null;
  heightFtMax: number | null;
  spreadFtMin: number | null;
  spreadFtMax: number | null;
}

const NULLS: PlantDimensions = {
  heightFtMin: null,
  heightFtMax: null,
  spreadFtMin: null,
  spreadFtMax: null,
};

/** A finite number passes through; anything else becomes null. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Looks up a species' mature dimensions via the `plant-dimensions` Supabase
 * Edge Function, which proxies a Claude (Haiku) call so the Anthropic key
 * stays server-side (see DECISIONS.md Entry #16 / the LLM-dimensions spec).
 *
 * Best-effort, exactly like PerenualService: any failure resolves to
 * all-nulls rather than throwing, so the add-plant flow is never blocked by
 * a dimension lookup.
 */
@Injectable({ providedIn: 'root' })
export class PlantDimensionService {
  private supabase = inject(SupabaseService);

  async lookup(scientificName: string, commonName?: string): Promise<PlantDimensions> {
    const body: { scientificName: string; commonName?: string } = {
      scientificName,
    };
    if (commonName) body.commonName = commonName;

    try {
      const { data, error } = await this.supabase.client.functions.invoke('plant-dimensions', {
        body,
      });
      if (error || !data) return { ...NULLS };
      const d = data as Record<string, unknown>;
      return {
        heightFtMin: num(d['heightFtMin']),
        heightFtMax: num(d['heightFtMax']),
        spreadFtMin: num(d['spreadFtMin']),
        spreadFtMax: num(d['spreadFtMax']),
      };
    } catch {
      return { ...NULLS };
    }
  }
}
