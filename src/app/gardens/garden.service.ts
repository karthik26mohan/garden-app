import { inject, Injectable } from '@angular/core';
import { SupabaseService } from '../supabase.service';

/**
 * Shape of a row in the public.gardens table.
 *
 * Mirrors the schema in supabase/migrations/20260516000002_gardens.sql.
 * boundary and centroid are geography columns; we keep them as unknown on
 * the client until the map UI lands and we wire up a real GeoJSON type.
 */
export interface Garden {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  boundary: unknown | null;
  centroid: unknown | null;
  created_at: string;
  updated_at: string;
}

/**
 * Payload for creating a new garden. user_id is added by the service
 * (pulled from the current Supabase session), not by callers — that way
 * components can stay ignorant of auth state.
 */
export interface NewGardenInput {
  name: string;
  description?: string;
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
    const { data, error } = await this.supabase.client
      .from('gardens')
      .update({
        name: input.name,
        description: input.description ?? null,
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

    const { data, error } = await this.supabase.client
      .from('gardens')
      .insert({
        user_id: user.id,
        name: input.name,
        description: input.description ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data as Garden;
  }
}
