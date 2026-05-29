import { inject, Injectable } from '@angular/core';
import { SupabaseService } from '../supabase.service';

/**
 * Shape of a row in the public.gardens table.
 *
 * Mirrors the schema in supabase/migrations/20260516000002_gardens.sql
 * plus the 20260524000001 migration that swapped PostGIS columns for
 * relative-feet coordinates. See DECISIONS.md Entry #11.
 *
 * Coordinate convention:
 *   Origin = top-left corner of the yard
 *   X axis = increases rightward (east)
 *   Y axis = increases downward (south)
 *   Unit   = feet
 */
export interface Garden {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  position_x_ft: number;
  position_y_ft: number;
  width_ft: number;
  height_ft: number;
  created_at: string;
  updated_at: string;
}

/**
 * Payload for creating or updating a garden. user_id is added by the
 * service (pulled from the current Supabase session), not by callers —
 * that way components can stay ignorant of auth state.
 *
 * Position and size fields are optional here because the create form
 * doesn't expose them (users place gardens visually in the editor, not
 * by typing coordinates). When omitted on create, the DB schema defaults
 * (0, 0, 10, 20) fill them in. The editor sets them via update() once
 * the user has dragged things into place.
 */
export interface NewGardenInput {
  name: string;
  description?: string;
  position_x_ft?: number;
  position_y_ft?: number;
  width_ft?: number;
  height_ft?: number;
}

/**
 * Data-access layer for the gardens table.
 *
 * Why a service and not direct Supabase calls in components:
 *   - Components stay thin and focused on UI state.
 *   - One place to change if we ever swap Supabase for another backend.
 *   - One place to centralize error handling, retries, optimistic updates.
 *
 * RLS in Postgres is what actually keeps users from reading each other's
 * rows — this service doesn't add user_id filters to selects because the
 * database silently filters them via the "gardens_select_own" policy.
 */
@Injectable({ providedIn: 'root' })
export class GardenService {
  private supabase = inject(SupabaseService);

  /**
   * Fetch every garden the current user can see. Sorted newest-first so
   * a freshly-created garden appears at the top of the list.
   */
  async list(): Promise<Garden[]> {
    const { data, error } = await this.supabase.client
      .from('gardens')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as Garden[];
  }

  /**
   * Fetch a single garden by id. Returns null if not found.
   *
   * "Not found" includes two cases that look identical from the caller's
   * perspective — and that's the point:
   *   1. The id genuinely doesn't exist.
   *   2. The id exists but belongs to a different user.
   *
   * Case 2 gets filtered by the gardens_select_own RLS policy before the
   * row ever leaves Postgres, so the query just returns zero rows. `.single()`
   * then errors with "no rows returned" (PGRST116). We catch that and return
   * null so the component can render a clean "Garden not found." state.
   * Any other error (network, real DB error) re-throws.
   */
  async get(id: string): Promise<Garden | null> {
    const { data, error } = await this.supabase.client
      .from('gardens')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // 0 rows
      throw error;
    }
    return data as Garden;
  }

  /**
   * Update an existing garden by id. Returns the updated row.
   *
   * No user_id filter in the .eq() chain because the gardens_update_own
   * RLS policy blocks the write if the row belongs to another user — same
   * privacy property as reads. If RLS rejects, .single() returns zero rows
   * and we throw a "not found" error rather than leaking that the row
   * exists but belongs to someone else.
   */
  async update(id: string, input: NewGardenInput): Promise<Garden> {
    // Same `...(cond && { key: value })` key-omission pattern as create()
    // — see the longer explanation there. Lets the form update
    // name+description without touching position/size, and lets the editor
    // update position/size without touching name+description.
    const { data, error } = await this.supabase.client
      .from('gardens')
      .update({
        name: input.name,
        description: input.description ?? null,
        ...(input.position_x_ft !== undefined && {
          position_x_ft: input.position_x_ft,
        }),
        ...(input.position_y_ft !== undefined && {
          position_y_ft: input.position_y_ft,
        }),
        ...(input.width_ft !== undefined && { width_ft: input.width_ft }),
        ...(input.height_ft !== undefined && { height_ft: input.height_ft }),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') throw new Error('Garden not found.');
      throw error;
    }
    return data as Garden;
  }

  /**
   * Update only the position fields of a garden. Used by the yard-map
   * editor when the user drags a rectangle and releases. Separate from
   * update() so we don't need to thread the whole NewGardenInput through
   * the drag handler — position is the only thing the drag touches.
   */
  async updatePosition(
    id: string,
    positionX: number,
    positionY: number,
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('gardens')
      .update({ position_x_ft: positionX, position_y_ft: positionY })
      .eq('id', id);

    if (error) throw error;
  }

  /**
   * Delete a garden by id. No-op if the row doesn't exist or RLS hides it.
   *
   * Note: Supabase doesn't error if the delete matches zero rows. From the
   * caller's perspective there's no way to distinguish "you deleted it" from
   * "it was already gone" — which is fine, both are the desired end state.
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('gardens')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  /**
   * Insert a new garden owned by the current user. Throws if no user is
   * signed in (caller should already be behind authGuard, but we belt-and-
   * suspenders it here so a bug elsewhere can't write rows with a null
   * user_id and hit the RLS check at runtime).
   */
  async create(input: NewGardenInput): Promise<Garden> {
    const {
      data: { user },
    } = await this.supabase.client.auth.getUser();

    if (!user) {
      throw new Error('Not signed in.');
    }

    // Only include position/size keys if the caller provided them; omitting
    // a key lets the DB default fill it in. New gardens from the form omit
    // all four and land at (0, 0) with size 10x20. The editor calls update()
    // with the real values once the user has placed them.
    //
    // ── The `...(cond && { key: value })` pattern explained ──
    // This is the JS idiom for "include this key in the object only if a
    // condition holds." How it works:
    //
    //   condition === true  → the expression evaluates to `{ key: value }`,
    //                         which spreads into the surrounding object and
    //                         adds the key.
    //   condition === false → the expression evaluates to `false`, and JS
    //                         silently ignores spreads of non-objects. The
    //                         key is simply absent from the final object.
    //
    // We use `!== undefined` (not a truthy check) so that legitimate falsy
    // values like `position_x_ft: 0` still count as "set." A pure truthy
    // check (`input.position_x_ft && ...`) would drop zero coordinates,
    // which are perfectly valid — the origin of the yard is (0, 0).
    //
    // The Supabase JS client treats "key absent" and "key: undefined"
    // differently: an absent key triggers the DB column default, while
    // `undefined` is serialized as `null` in the JSON payload (overwriting
    // any existing value with null). This pattern avoids that footgun.
    const { data, error } = await this.supabase.client
      .from('gardens')
      .insert({
        user_id: user.id,
        name: input.name,
        description: input.description ?? null,
        ...(input.position_x_ft !== undefined && {
          position_x_ft: input.position_x_ft,
        }),
        ...(input.position_y_ft !== undefined && {
          position_y_ft: input.position_y_ft,
        }),
        ...(input.width_ft !== undefined && { width_ft: input.width_ft }),
        ...(input.height_ft !== undefined && { height_ft: input.height_ft }),
      })
      .select()
      .single();

    if (error) throw error;
    return data as Garden;
  }
}
