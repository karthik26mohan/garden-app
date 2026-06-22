-- Mature canopy spread + a dimensions provenance marker on species, per the
-- LLM-dimensions spec
-- (docs/superpowers/specs/2026-06-13-llm-plant-dimensions-design.md).
--
-- height_ft_min/max already exist (migration 20260531000001). spread is the
-- top-down canopy width — it seeds a plant's on-map diameter. dimensions_source
-- records where the dimension numbers came from ('perenual' catalog vs 'llm'
-- estimate), distinct from external_source which records the catalog match.

alter table public.species
  add column spread_ft_min     numeric,
  add column spread_ft_max     numeric,
  add column dimensions_source text;   -- 'perenual' | 'llm' | null
