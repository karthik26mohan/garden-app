import { inject, Injectable } from '@angular/core';
import { SupabaseService } from '../supabase.service';
import { Species } from './species.service';

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

  /**
   * Legacy free-text name. After the V1 species migration, plants point
   * at a `species_id` instead; this column is kept temporarily as a
   * fallback so the UI doesn't break during the V2/V3 transition. A
   * future migration will drop it once the app fully reads via species.
   */
  common_name: string | null;
  scientific_name: string | null;
  inaturalist_taxon_id: number | null;
  plantnet_score: number | null;

  notes: string | null;
  planted_at: string | null; // date as ISO string

  position_x_ft: number;
  position_y_ft: number;
  diameter_ft: number;

  /**
   * FK to the parent species row. Source of truth for the plant's name
   * (canonical common_name + display_number live on the species). Optional
   * because legacy rows from before V1 may still have NULL here.
   */
  species_id: string | null;

  /**
   * Eager-loaded species data when queries use the nested-select pattern
   * (e.g. GardenService.list eager-loads gardens → plants → species).
   * Absent when the query didn't ask for it.
   */
  species?: Species;

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
   * Update only the position fields of a plant. Used by the yard-map
   * editor when the user drags a plant circle and releases. Separate
   * from a full update method (which doesn't exist yet) so we don't
   * need to thread the whole NewPlantInput through the drag handler.
   *
   * Coordinates are GARDEN-LOCAL (relative to the parent garden's
   * top-left corner) — see DECISIONS.md Entry #12.
   */
  async updatePosition(
    id: string,
    positionX: number,
    positionY: number,
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('plants')
      .update({ position_x_ft: positionX, position_y_ft: positionY })
      .eq('id', id);

    if (error) throw error;
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
