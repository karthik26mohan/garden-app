import { inject, Injectable } from '@angular/core';
import { SupabaseService } from '../supabase.service';
import { PerenualService } from './perenual.service';
import { PlantIdCandidate } from './plant-id.service';
import { PlantDimensionService } from './plant-dimension.service';

export type SpeciesExternalSource = 'perenual' | 'plantnet' | 'llm' | 'manual';

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
  external_source: SpeciesExternalSource | null;
  external_id: string | null;
  height_ft_min: number | null;
  height_ft_max: number | null;
  external_data: unknown | null;
  /** Mature canopy spread (top-down width), feet — seeds a plant's on-map diameter. */
  spread_ft_min: number | null;
  spread_ft_max: number | null;
  /** 'perenual' | 'llm' | null — where the dimension numbers came from (vs external_source = catalog match). */
  dimensions_source: 'perenual' | 'llm' | null;
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
  private dimensions = inject(PlantDimensionService);

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
   * Find one species by exact (case-insensitive) name. Checks the
   * given columns in priority order with separate single-column
   * queries: the .ilike() builder safely encodes any value (names
   * with commas or parens would corrupt a combined .or() filter),
   * and limit(1) keeps an ambiguous double-match from erroring the
   * way .or(...).maybeSingle() does.
   */
  private async findByName(
    value: string,
    columns: ('scientific_name' | 'common_name')[],
  ): Promise<Species | null> {
    for (const column of columns) {
      const { data, error } = await this.supabase.client
        .from('species')
        .select('*')
        .ilike(column, value)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as Species;
    }
    return null;
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

    // Step 1: try to find an existing species. Check common_name first,
    // then scientific_name (case-insensitive; ILIKE with no wildcards =
    // case-insensitive exact match). Separate single-column queries via
    // findByName instead of one .or() — same "match either column"
    // semantics, but injection-safe and deterministic when both columns
    // could match different rows.
    const existing = await this.findByName(normalized, ['common_name', 'scientific_name']);
    if (existing) return existing;

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
   *   1. FIND: match the scientific name against scientific_name then
   *      common_name, then the candidate's common name against
   *      common_name (all case-insensitive). If found, return it —
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

    // Step 1: find an existing species. Priority: scientific-name match
    // (authoritative), then a legacy row whose typed common_name IS the
    // scientific name, then a row matching the candidate's common name
    // (the "typed 'Tomato' first, photographed it later" case).
    const commonName = candidate.commonNames[0]?.trim();
    const existing =
      (await this.findByName(scientificName, ['scientific_name', 'common_name'])) ??
      (commonName ? await this.findByName(commonName, ['common_name']) : null);

    if (existing) {
      const found = existing;
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

    // Step 2: enrich. Perenual gives a catalog match (external_id); its free
    // tier returns no dimensions, so a Claude lookup (via the plant-dimensions
    // edge function) fills height + spread. Both are best-effort — null on any
    // failure — so the species is always created.
    const perenualData = await this.perenual.searchByScientificName(scientificName);
    const llmDims = await this.dimensions.lookup(scientificName, commonName);

    // Merge: Perenual height wins when present (a future paid tier would then
    // take precedence); spread only ever comes from the LLM today. Track which
    // source actually supplied a dimension number.
    const heightFtMin = perenualData?.heightFtMin ?? llmDims.heightFtMin;
    const heightFtMax = perenualData?.heightFtMax ?? llmDims.heightFtMax;
    const spreadFtMin = llmDims.spreadFtMin;
    const spreadFtMax = llmDims.spreadFtMax;
    const usedPerenualDims = perenualData?.heightFtMin != null || perenualData?.heightFtMax != null;
    const usedLlmDims =
      heightFtMin != null || heightFtMax != null || spreadFtMin != null || spreadFtMax != null;
    const dimensionsSource: 'perenual' | 'llm' | null = usedPerenualDims
      ? 'perenual'
      : usedLlmDims
        ? 'llm'
        : null;

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
          external_data: perenualData.raw,
        }),
        ...(heightFtMin != null && { height_ft_min: heightFtMin }),
        ...(heightFtMax != null && { height_ft_max: heightFtMax }),
        ...(spreadFtMin != null && { spread_ft_min: spreadFtMin }),
        ...(spreadFtMax != null && { spread_ft_max: spreadFtMax }),
        ...(dimensionsSource && { dimensions_source: dimensionsSource }),
      })
      .select()
      .single();
    if (insertError) {
      // 23505 = unique violation: a concurrent create or a casing-variant
      // near-miss that the find didn't surface — recover by re-reading.
      if ((insertError as { code?: string }).code === '23505') {
        const raced =
          (await this.findByName(scientificName, ['scientific_name', 'common_name'])) ??
          (commonName ? await this.findByName(commonName, ['common_name']) : null);
        if (raced) return raced;
      }
      throw insertError;
    }
    return created as Species;
  }

  /**
   * Best-effort height/spread backfill for a species that's missing
   * dimensions — used by the "Fill in missing heights" action on the
   * yard map, which needs height data to color-code plants. Mirrors the
   * dimension-merge logic in ensureByIdentification, but for an existing
   * row instead of a brand-new one.
   *
   * Never throws: returns the species unchanged if it has no
   * scientific_name to look up, the lookup finds nothing, or the update
   * fails.
   */
  async backfillDimensions(species: Species): Promise<Species> {
    if (!species.scientific_name) return species;

    const dims = await this.dimensions.lookup(species.scientific_name, species.common_name);
    const hasAnyDimension =
      dims.heightFtMin != null ||
      dims.heightFtMax != null ||
      dims.spreadFtMin != null ||
      dims.spreadFtMax != null;
    if (!hasAnyDimension) return species;

    const { data, error } = await this.supabase.client
      .from('species')
      .update({
        ...(dims.heightFtMin != null && { height_ft_min: dims.heightFtMin }),
        ...(dims.heightFtMax != null && { height_ft_max: dims.heightFtMax }),
        ...(dims.spreadFtMin != null && { spread_ft_min: dims.spreadFtMin }),
        ...(dims.spreadFtMax != null && { spread_ft_max: dims.spreadFtMax }),
        dimensions_source: 'llm',
      })
      .eq('id', species.id)
      .select()
      .single();
    if (error) return species;
    return data as Species;
  }
}
