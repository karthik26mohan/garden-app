import { inject, Injectable } from '@angular/core';
import { SupabaseService } from '../supabase.service';
import { PerenualService } from './perenual.service';
import { PlantIdCandidate } from './plant-id.service';

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
  /** 'perenual' | 'plantnet' | 'llm' | 'manual' — which system filled the external columns. */
  external_source: string | null;
  external_id: string | null;
  height_ft_min: number | null;
  height_ft_max: number | null;
  external_data: unknown | null;
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
  private perenual = inject(PerenualService);

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
      .or(`common_name.ilike.${normalized},scientific_name.ilike.${normalized}`)
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

  /**
   * Resolve a Pl@ntNet identification into a species row — the
   * photo-flow sibling of ensureByName. See the spec
   * (docs/superpowers/specs/2026-06-10-photo-plant-identification-design.md
   * section 4) for the find → enrich → create chain.
   *
   *   1. FIND: match the scientific name against scientific_name OR
   *      common_name (case-insensitive). If found, return it —
   *      backfilling scientific_name when the row predates
   *      identification.
   *   2. ENRICH: for a new species, ask Perenual for growing data
   *      (best-effort; null on any failure).
   *   3. CREATE: insert with the next display_number. external_source
   *      records which system provided the data ('perenual' when the
   *      lookup hit, 'plantnet' when we only have Pl@ntNet's names).
   */
  async ensureByIdentification(candidate: PlantIdCandidate): Promise<Species> {
    const scientificName = candidate.scientificName.trim();
    if (!scientificName) {
      throw new Error('Candidate has no scientific name.');
    }

    // Step 1: find by scientific name in either name column.
    const { data: existing, error: selectError } = await this.supabase.client
      .from('species')
      .select('*')
      .or(`scientific_name.ilike.${scientificName},common_name.ilike.${scientificName}`)
      .maybeSingle();
    if (selectError) throw selectError;

    if (existing) {
      const found = existing as Species;
      if (found.scientific_name) return found;

      // Backfill: the species existed from a typed name; the photo
      // identification just told us what it actually is.
      const { data: updated, error: updateError } = await this.supabase.client
        .from('species')
        .update({ scientific_name: scientificName })
        .eq('id', found.id)
        .select()
        .single();
      if (updateError) throw updateError;
      return updated as Species;
    }

    // Step 2: enrich via Perenual (null = lookup failed or no match).
    const perenualData = await this.perenual.searchByScientificName(scientificName);

    // Step 3: create, same next-number pattern as ensureByName.
    const {
      data: { user },
    } = await this.supabase.client.auth.getUser();
    if (!user) throw new Error('Not signed in.');

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
        common_name: candidate.commonNames[0] ?? scientificName,
        scientific_name: scientificName,
        display_number: nextNumber,
        external_source: perenualData ? 'perenual' : 'plantnet',
        ...(perenualData && {
          external_id: perenualData.externalId,
          height_ft_min: perenualData.heightFtMin,
          height_ft_max: perenualData.heightFtMax,
          external_data: perenualData.raw,
        }),
      })
      .select()
      .single();
    if (insertError) throw insertError;
    return created as Species;
  }
}
