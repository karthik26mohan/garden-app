import { inject, Injectable } from '@angular/core';
import { SupabaseService } from '../supabase.service';

/**
 * Shape of a row in the public.plants table.
 *
 * Mirrors the schema in supabase/migrations/20260516000003_plants.sql plus
 * the 20260528000001 migration that swapped PostGIS for relative-feet
 * coordinates. See DECISIONS.md Entry #12.
 *
 * Coordinate convention:
 *   Origin       = top-left corner of the PARENT GARDEN (not the yard)
 *   X axis       = increases rightward (east)
 *   Y axis       = increases downward (south)
 *   Unit         = feet
 *   Diameter     = max width of the plant's canopy, top-down view
 *
 * Pl@ntNet/iNaturalist enrichment fields (common_name, scientific_name,
 * etc.) are nullable because they're populated later — typically after
 * the user uploads a photo and we identify the species. A freshly-added
 * plant might have just position + diameter + a temporary user-supplied
 * name in `common_name`.
 */
export interface Plant {
  id: string;
  garden_id: string;
  added_by_user_id: string;

  common_name: string | null;
  scientific_name: string | null;
  inaturalist_taxon_id: number | null;
  plantnet_score: number | null;

  notes: string | null;
  planted_at: string | null; // date as ISO string

  position_x_ft: number;
  position_y_ft: number;
  diameter_ft: number;

  identified_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Payload for creating a plant. garden_id is required (a plant must
 * belong to a garden); everything else is optional and falls back to
 * schema defaults or null.
 */
export interface NewPlantInput {
  garden_id: string;
  common_name?: string;
  scientific_name?: string;
  notes?: string;
  position_x_ft?: number;
  position_y_ft?: number;
  diameter_ft?: number;
}

/**
 * Data-access layer for the plants table.
 *
 * RLS handles authorization — the plants_*_via_garden policies check
 * that the current user owns the parent garden, so the service doesn't
 * filter by user_id explicitly. Postgres enforces ownership.
 */
@Injectable({ providedIn: 'root' })
export class PlantService {
  private supabase = inject(SupabaseService);

  /**
   * Insert a new plant into a garden. Uses the same key-omission pattern
   * as GardenService — see the long explanation in garden.service.ts —
   * so omitted position/diameter fields fall back to schema defaults.
   *
   * added_by_user_id is set from the current Supabase session so callers
   * never need to thread the user id through.
   */
  async create(input: NewPlantInput): Promise<Plant> {
    const {
      data: { user },
    } = await this.supabase.client.auth.getUser();

    if (!user) {
      throw new Error('Not signed in.');
    }

    const { data, error } = await this.supabase.client
      .from('plants')
      .insert({
        garden_id: input.garden_id,
        added_by_user_id: user.id,
        common_name: input.common_name ?? null,
        scientific_name: input.scientific_name ?? null,
        notes: input.notes ?? null,
        ...(input.position_x_ft !== undefined && {
          position_x_ft: input.position_x_ft,
        }),
        ...(input.position_y_ft !== undefined && {
          position_y_ft: input.position_y_ft,
        }),
        ...(input.diameter_ft !== undefined && {
          diameter_ft: input.diameter_ft,
        }),
      })
      .select()
      .single();

    if (error) throw error;
    return data as Plant;
  }

  /**
   * Delete a plant by id. No-op if the row doesn't exist or RLS hides it.
   * Same privacy semantics as gardens — caller can't distinguish "I
   * deleted it" from "it was never visible to me."
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('plants')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}
