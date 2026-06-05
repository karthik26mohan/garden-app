import { inject, Injectable } from '@angular/core';
import { SupabaseService } from '../supabase.service';

/**
 * Shape of a row in the public.species table.
 *
 * Mirrors the schema in supabase/migrations/20260529000001_species.sql.
 * See DECISIONS.md Entry #13 for why species exists as a first-class
 * entity rather than being derived from plant names at read time.
 *
 * display_number is the legend number that appears inside plant circles
 * on the yard map. It's stable per user — deleting all plants of a
 * species doesn't release its number.
 *
 * scientific_name is nullable; it gets populated later via Pl@ntNet
 * identification (per-species, so all plants of that species inherit
 * the identification for free).
 */
export interface Species {
  id: string;
  user_id: string;
  common_name: string;
  scientific_name: string | null;
  display_number: number;
  created_at: string;
  updated_at: string;
}

/**
 * Data-access layer for the species table.
 *
 * Two methods:
 *   - list() returns every species for the current user.
 *   - ensureByName(name) is find-or-create — used by the add-plant UI
 *     to convert a typed name into a species_id.
 *
 * RLS filters by user_id via the species_select_own policy, so no
 * client-side filtering needed.
 */
@Injectable({ providedIn: 'root' })
export class SpeciesService {
  private supabase = inject(SupabaseService);

  /**
   * Return every species the current user has, sorted by display_number
   * (so the natural iteration order matches the legend's default order).
   */
  async list(): Promise<Species[]> {
    const { data, error } = await this.supabase.client
      .from('species')
      .select('*')
      .order('display_number', { ascending: true });

    if (error) throw error;
    return (data ?? []) as Species[];
  }

  /**
   * Find an existing species by case-insensitive trimmed match on either
   * common_name or scientific_name, or create a new one with the next
   * sequential display_number if none exists. Returns the species.
   *
   * The dual-field search means a user who knows "Rose" as a common name
   * and a user who knows "Rosa damascena" as the scientific name can
   * both find the same species row (assuming one has been identified).
   *
   * On create, the input is used as common_name (we have no other info).
   * The user can later edit the species to set scientific_name explicitly,
   * or Pl@ntNet identification will populate it.
   *
   * Concurrency caveat: two simultaneous calls inserting a new species
   * could both compute the same next display_number and one would fail
   * the unique constraint. For a single-user app this is essentially
   * impossible; a real product would catch the unique-violation and
   * retry. For MVP we just propagate the error.
   */
  async ensureByName(name: string): Promise<Species> {
    const normalized = name.trim();
    if (!normalized) {
      throw new Error('Species name cannot be empty.');
    }

    // Step 1: try to find an existing species. Search BOTH common_name
    // and scientific_name (case-insensitive). Supabase's .or() filter
    // takes a comma-separated list of conditions; ILIKE with no
    // wildcards = case-insensitive exact match.
    const { data: existing, error: selectError } = await this.supabase.client
      .from('species')
      .select('*')
      .or(
        `common_name.ilike.${normalized},scientific_name.ilike.${normalized}`,
      )
      .maybeSingle();

    if (selectError) throw selectError;
    if (existing) return existing as Species;

    // Step 2: create. Need the current user's id and the next number.
    const {
      data: { user },
    } = await this.supabase.client.auth.getUser();
    if (!user) {
      throw new Error('Not signed in.');
    }

    // Compute next display_number = max + 1 (default to 1 if no species yet).
    const { data: maxRow, error: maxError } = await this.supabase.client
      .from('species')
      .select('display_number')
      .order('display_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw maxError;
    const nextNumber = (maxRow?.display_number ?? 0) + 1;

    const { data: created, error: insertError } = await this.supabase.client
      .from('species')
      .insert({
        user_id: user.id,
        common_name: normalized,
        display_number: nextNumber,
      })
      .select()
      .single();

    if (insertError) throw insertError;
    return created as Species;
  }
}
