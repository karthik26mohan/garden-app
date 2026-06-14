# Claude-Powered Plant Dimension Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a new species is created from a photo identification, fetch its mature height and canopy spread via Claude (Haiku 4.5) behind a Supabase Edge Function, store both on the species, and seed the plant's on-map diameter from the spread.

**Architecture:** A Supabase Edge Function (`plant-dimensions`, Deno) proxies one Claude structured-output call so the Anthropic key never enters the client bundle. An Angular `PlantDimensionService` invokes it via supabase-js. `SpeciesService.ensureByIdentification` calls the lookup when creating a new species and merges the dimensions (Perenual height wins if present, else LLM; spread from LLM). `garden-detail.onIdentified` seeds `diameter_ft` from the species' `spread_ft_max`. Everything degrades to null dimensions on failure — the species is always created.

**Tech Stack:** Angular 21 (standalone, signals, `inject()`), Supabase JS v2 (`functions.invoke`), Supabase Edge Functions (Deno 2), Anthropic Messages API (`claude-haiku-4-5`, `output_config.format` structured outputs), Vitest (Angular) + `deno test` (the function).

**Spec:** `docs/superpowers/specs/2026-06-13-llm-plant-dimensions-design.md`

**Conventions (read before starting):**
- Before any npm/node command: `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"` (default node is too old for Angular CLI 21).
- Angular test: `npm test -- --watch=false` (Vitest, jsdom). Prettier `printWidth` 100 — run `npx prettier --write` on changed TS files before committing.
- Angular services live in `src/app/gardens/`, are `@Injectable({ providedIn: 'root' })`, use `inject(SupabaseService)` → `.client`. Model file: `src/app/gardens/perenual.service.ts` (best-effort, returns null on failure — match this style).
- Branch: `feature/llm-plant-dimensions`.
- Anthropic model id is exactly `claude-haiku-4-5`. Structured outputs use `output_config: { format: { type: 'json_schema', schema: {...} } }` on `messages.create` — NOT the deprecated `output_format`. Haiku 4.5 supports structured outputs. Do NOT add `thinking` or `effort` (Haiku supports neither — `effort` 400s on Haiku).

---

### Task 0: Branch + baseline

**Files:** none

- [ ] **Step 0.1: Create the feature branch and confirm the suite is green**

```bash
cd "/Users/kmohan/Documents/Claude/Projects/garden app/garden-app"
git checkout -b feature/llm-plant-dimensions
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
npm test -- --watch=false
```

Expected: all existing tests PASS (52 at last count). If not, stop and report.

---

### Task 1: Species dimension columns migration

**Files:**
- Create: `supabase/migrations/20260613000001_species_dimensions.sql`

- [ ] **Step 1.1: Write the migration**

Create `supabase/migrations/20260613000001_species_dimensions.sql`:

```sql
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
```

- [ ] **Step 1.2: Apply the migration**

Run:
```bash
cd "/Users/kmohan/Documents/Claude/Projects/garden app/garden-app"
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
npx supabase db push
```

Expected: migration `20260613000001` applied. Answer `Y` if prompted. If the CLI isn't authenticated in this environment, flag it to the user to run themselves and continue — nothing before the manual test needs the live column.

- [ ] **Step 1.3: Commit**

```bash
git add supabase/migrations/20260613000001_species_dimensions.sql
git commit -m "feat: add spread + dimensions_source columns to species"
```

---

### Task 2: Edge Function `parseDimensions` (pure function + Deno test)

**Files:**
- Create: `supabase/functions/plant-dimensions/dimensions.ts`
- Test: `supabase/functions/plant-dimensions/dimensions.test.ts`

The Anthropic-response → dimensions mapping is a pure function so it's testable without the network. The HTTP handler (Task 3) wraps it.

- [ ] **Step 2.1: Write the failing Deno test**

Create `supabase/functions/plant-dimensions/dimensions.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert@1';
import { parseDimensions, type Dimensions } from './dimensions.ts';

const NULLS: Dimensions = {
  heightFtMin: null,
  heightFtMax: null,
  spreadFtMin: null,
  spreadFtMax: null,
};

Deno.test('parseDimensions reads a full structured-output text block', () => {
  // Anthropic Messages API response shape: content[].text holds the JSON
  // string when output_config.format is json_schema.
  const response = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          heightFtMin: 1,
          heightFtMax: 3,
          spreadFtMin: 1,
          spreadFtMax: 2,
        }),
      },
    ],
  };
  assertEquals(parseDimensions(response), {
    heightFtMin: 1,
    heightFtMax: 3,
    spreadFtMin: 1,
    spreadFtMax: 2,
  });
});

Deno.test('parseDimensions preserves partial nulls', () => {
  const response = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          heightFtMin: null,
          heightFtMax: 4,
          spreadFtMin: null,
          spreadFtMax: null,
        }),
      },
    ],
  };
  assertEquals(parseDimensions(response), {
    heightFtMin: null,
    heightFtMax: 4,
    spreadFtMin: null,
    spreadFtMax: null,
  });
});

Deno.test('parseDimensions returns all-nulls for a malformed body', () => {
  assertEquals(parseDimensions({ content: [{ type: 'text', text: 'not json' }] }), NULLS);
  assertEquals(parseDimensions({ content: [] }), NULLS);
  assertEquals(parseDimensions(null), NULLS);
  assertEquals(parseDimensions({ content: [{ type: 'text', text: '{}' }] }), NULLS);
});

Deno.test('parseDimensions coerces non-numbers to null', () => {
  const response = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          heightFtMin: 'tall',
          heightFtMax: 3,
          spreadFtMin: 2,
          spreadFtMax: 'wide',
        }),
      },
    ],
  };
  assertEquals(parseDimensions(response), {
    heightFtMin: null,
    heightFtMax: 3,
    spreadFtMin: 2,
    spreadFtMax: null,
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run:
```bash
cd "/Users/kmohan/Documents/Claude/Projects/garden app/garden-app"
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
npx supabase functions --help >/dev/null 2>&1  # ensure CLI present
deno test supabase/functions/plant-dimensions/dimensions.test.ts
```

Expected: FAIL — `dimensions.ts` not found. (If `deno` isn't on PATH, install via `brew install deno` or use the Deno bundled with the Supabase CLI; flag to the user if unavailable and continue authoring.)

- [ ] **Step 2.3: Write the implementation**

Create `supabase/functions/plant-dimensions/dimensions.ts`:

```ts
/** Mature plant dimensions in feet; any field null when unknown. */
export interface Dimensions {
  heightFtMin: number | null;
  heightFtMax: number | null;
  spreadFtMin: number | null;
  spreadFtMax: number | null;
}

const NULLS: Dimensions = {
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
 * Map an Anthropic Messages API response to Dimensions. With
 * output_config.format = json_schema, the model's JSON lands as a string in
 * the first text content block. Defensive: any missing/malformed piece yields
 * all-nulls rather than throwing — dimensions are best-effort.
 */
export function parseDimensions(response: unknown): Dimensions {
  const content = (response as { content?: unknown[] } | null)?.content;
  if (!Array.isArray(content)) return { ...NULLS };

  const textBlock = content.find(
    (b) => (b as { type?: string }).type === 'text',
  ) as { text?: string } | undefined;
  if (!textBlock?.text) return { ...NULLS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return { ...NULLS };
  }

  const d = parsed as Record<string, unknown>;
  return {
    heightFtMin: num(d.heightFtMin),
    heightFtMax: num(d.heightFtMax),
    spreadFtMin: num(d.spreadFtMin),
    spreadFtMax: num(d.spreadFtMax),
  };
}
```

- [ ] **Step 2.4: Run the test to verify it passes**

Run: `deno test supabase/functions/plant-dimensions/dimensions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 2.5: Commit**

```bash
git add supabase/functions/plant-dimensions/dimensions.ts supabase/functions/plant-dimensions/dimensions.test.ts
git commit -m "feat: add plant-dimensions response parser with Deno tests"
```

---

### Task 3: Edge Function HTTP handler

**Files:**
- Create: `supabase/functions/plant-dimensions/index.ts`

This is the deployable handler. It's exercised by manual testing (Task 7) — no automated HTTP test (Deno-serve integration testing is out of scope for MVP); the parsing logic it depends on is already covered in Task 2.

- [ ] **Step 3.1: Write the handler**

Create `supabase/functions/plant-dimensions/index.ts`:

```ts
import { parseDimensions, type Dimensions } from './dimensions.ts';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

const NULLS: Dimensions = {
  heightFtMin: null,
  heightFtMax: null,
  spreadFtMin: null,
  spreadFtMax: null,
};

// functions.invoke is cross-origin from the app; allow it.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DIMENSION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    heightFtMin: { type: ['number', 'null'] },
    heightFtMax: { type: ['number', 'null'] },
    spreadFtMin: { type: ['number', 'null'] },
    spreadFtMax: { type: ['number', 'null'] },
  },
  required: ['heightFtMin', 'heightFtMax', 'spreadFtMin', 'spreadFtMax'],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let scientificName = '';
  let commonName = '';
  try {
    const body = await req.json();
    scientificName = String(body.scientificName ?? '').trim();
    commonName = String(body.commonName ?? '').trim();
  } catch {
    // bad body → best-effort nulls
    return json(NULLS);
  }
  if (!scientificName) return json(NULLS);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(NULLS); // not configured → degrade, don't error

  const label = commonName
    ? `${scientificName} (commonly "${commonName}")`
    : scientificName;
  const prompt =
    `Give the typical mature dimensions of the plant ${label}, in feet.\n` +
    `Provide minimum and maximum mature height, and minimum and maximum ` +
    `mature canopy spread (top-down width). Use null for any value you are ` +
    `not confident about — do not guess.`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: DIMENSION_SCHEMA,
          },
        },
      }),
    });
    if (!res.ok) return json(NULLS);
    return json(parseDimensions(await res.json()));
  } catch {
    return json(NULLS);
  }
});
```

- [ ] **Step 3.2: Type-check the function with Deno**

Run:
```bash
cd "/Users/kmohan/Documents/Claude/Projects/garden app/garden-app"
deno check supabase/functions/plant-dimensions/index.ts
```

Expected: no type errors. (If `deno` is unavailable, skip with a note — the function deploys via the Supabase CLI which bundles Deno.)

- [ ] **Step 3.3: Commit**

```bash
git add supabase/functions/plant-dimensions/index.ts
git commit -m "feat: add plant-dimensions edge function (Claude Haiku proxy)"
```

---

### Task 4: PlantDimensionService (Angular)

**Files:**
- Create: `src/app/gardens/plant-dimension.service.ts`
- Test: `src/app/gardens/plant-dimension.service.spec.ts`

- [ ] **Step 4.1: Write the failing tests**

Create `src/app/gardens/plant-dimension.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { PlantDimensionService } from './plant-dimension.service';
import { SupabaseService } from '../supabase.service';

describe('PlantDimensionService.lookup', () => {
  let service: PlantDimensionService;
  const invokeMock = vi.fn();
  const supabaseMock = {
    client: { functions: { invoke: invokeMock } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: supabaseMock }],
    });
    service = TestBed.inject(PlantDimensionService);
  });

  it('invokes the edge function with scientific + common name and maps the result', async () => {
    invokeMock.mockResolvedValue({
      data: { heightFtMin: 1, heightFtMax: 3, spreadFtMin: 1, spreadFtMax: 2 },
      error: null,
    });

    const dims = await service.lookup('Lavandula angustifolia', 'English lavender');

    expect(invokeMock).toHaveBeenCalledWith('plant-dimensions', {
      body: {
        scientificName: 'Lavandula angustifolia',
        commonName: 'English lavender',
      },
    });
    expect(dims).toEqual({
      heightFtMin: 1,
      heightFtMax: 3,
      spreadFtMin: 1,
      spreadFtMax: 2,
    });
  });

  it('omits commonName from the body when not provided', async () => {
    invokeMock.mockResolvedValue({
      data: { heightFtMin: null, heightFtMax: null, spreadFtMin: null, spreadFtMax: null },
      error: null,
    });

    await service.lookup('Lavandula angustifolia');

    expect(invokeMock).toHaveBeenCalledWith('plant-dimensions', {
      body: { scientificName: 'Lavandula angustifolia' },
    });
  });

  it('returns all-nulls when the function returns an error', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('boom') });

    await expect(service.lookup('Rosa canina')).resolves.toEqual({
      heightFtMin: null,
      heightFtMax: null,
      spreadFtMin: null,
      spreadFtMax: null,
    });
  });

  it('returns all-nulls when invoke throws (network failure)', async () => {
    invokeMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(service.lookup('Rosa canina')).resolves.toEqual({
      heightFtMin: null,
      heightFtMax: null,
      spreadFtMin: null,
      spreadFtMax: null,
    });
  });

  it('coerces a missing/partial payload to all-nulls fields', async () => {
    invokeMock.mockResolvedValue({ data: { heightFtMax: 5 }, error: null });

    await expect(service.lookup('Rosa canina')).resolves.toEqual({
      heightFtMin: null,
      heightFtMax: 5,
      spreadFtMin: null,
      spreadFtMax: null,
    });
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `npm test -- --watch=false`
Expected: FAIL — `plant-dimension.service` module not found.

- [ ] **Step 4.3: Write the implementation**

Create `src/app/gardens/plant-dimension.service.ts`:

```ts
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

  async lookup(
    scientificName: string,
    commonName?: string,
  ): Promise<PlantDimensions> {
    const body: { scientificName: string; commonName?: string } = {
      scientificName,
    };
    if (commonName) body.commonName = commonName;

    try {
      const { data, error } = await this.supabase.client.functions.invoke(
        'plant-dimensions',
        { body },
      );
      if (error || !data) return { ...NULLS };
      const d = data as Record<string, unknown>;
      return {
        heightFtMin: num(d.heightFtMin),
        heightFtMax: num(d.heightFtMax),
        spreadFtMin: num(d.spreadFtMin),
        spreadFtMax: num(d.spreadFtMax),
      };
    } catch {
      return { ...NULLS };
    }
  }
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `npm test -- --watch=false`
Expected: PASS.

- [ ] **Step 4.5: Prettier + commit**

```bash
npx prettier --write src/app/gardens/plant-dimension.service.ts src/app/gardens/plant-dimension.service.spec.ts
git add src/app/gardens/plant-dimension.service.ts src/app/gardens/plant-dimension.service.spec.ts
git commit -m "feat: add PlantDimensionService (edge-function dimension lookup)"
```

---

### Task 5: Wire dimensions into ensureByIdentification

**Files:**
- Modify: `src/app/gardens/species.service.ts`
- Modify: `src/app/gardens/species.service.spec.ts`

- [ ] **Step 5.1: Write the failing tests**

In `src/app/gardens/species.service.spec.ts`, add `PlantDimensionService` to the imports and provide a mock, then add the dimension-merge tests. First, at the top of the file add the import:

```ts
import { PlantDimensionService } from './plant-dimension.service';
```

In the `describe('SpeciesService.ensureByIdentification', …)` block, add a dimension mock alongside the existing `perenualMock`:

```ts
  const dimensionMock = { lookup: vi.fn() };
```

Register it in that block's `beforeEach` providers array (next to the `PerenualService` provider):

```ts
        { provide: PlantDimensionService, useValue: dimensionMock },
```

And give it a default in the same `beforeEach` (so existing tests that don't care still pass):

```ts
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: null,
      heightFtMax: null,
      spreadFtMin: null,
      spreadFtMax: null,
    });
```

Now add these tests inside the block:

```ts
  it('fills height + spread from the LLM when Perenual has no dimensions', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue({
      externalId: '2',
      heightFtMin: null,
      heightFtMax: null,
      raw: { id: 2 },
    });
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: 1,
      heightFtMax: 3,
      spreadFtMin: 1,
      spreadFtMax: 2,
    });
    insertSingleMock.mockResolvedValue({ data: { ...EXISTING, id: 'sp-new' }, error: null });

    await service.ensureByIdentification(CANDIDATE);

    expect(dimensionMock.lookup).toHaveBeenCalledWith(
      'Lavandula angustifolia',
      'English lavender',
    );
    expect(insertPayloads[0]).toMatchObject({
      height_ft_min: 1,
      height_ft_max: 3,
      spread_ft_min: 1,
      spread_ft_max: 2,
      dimensions_source: 'llm',
    });
  });

  it('prefers Perenual height over the LLM but takes spread from the LLM', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue({
      externalId: '2',
      heightFtMin: 2,
      heightFtMax: 5,
      raw: { id: 2 },
    });
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: 1,
      heightFtMax: 3,
      spreadFtMin: 1,
      spreadFtMax: 2,
    });
    insertSingleMock.mockResolvedValue({ data: { ...EXISTING, id: 'sp-new' }, error: null });

    await service.ensureByIdentification(CANDIDATE);

    expect(insertPayloads[0]).toMatchObject({
      height_ft_min: 2,
      height_ft_max: 5,
      spread_ft_min: 1,
      spread_ft_max: 2,
      dimensions_source: 'perenual',
    });
  });

  it('leaves dimensions_source null when neither source has dimensions', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    maxMaybeSingleMock.mockResolvedValue({ data: null, error: null });
    perenualMock.searchByScientificName.mockResolvedValue(null);
    dimensionMock.lookup.mockResolvedValue({
      heightFtMin: null,
      heightFtMax: null,
      spreadFtMin: null,
      spreadFtMax: null,
    });
    insertSingleMock.mockResolvedValue({ data: { ...EXISTING, id: 'sp-new' }, error: null });

    await service.ensureByIdentification(CANDIDATE);

    const payload = insertPayloads[0] as Record<string, unknown>;
    expect(payload.dimensions_source).toBeUndefined();
    expect(payload.spread_ft_min).toBeUndefined();
  });

  it('does not call the dimension lookup when an existing species is found', async () => {
    maybeSingleMock.mockResolvedValue({ data: EXISTING, error: null });

    await service.ensureByIdentification(CANDIDATE);

    expect(dimensionMock.lookup).not.toHaveBeenCalled();
  });
```

Note: `CANDIDATE` and `EXISTING` are the consts already defined at the top of the existing spec file; `CANDIDATE.commonNames[0]` is `'English lavender'`.

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `npm test -- --watch=false`
Expected: FAIL — `PlantDimensionService` not injected / dimension columns not in the insert payload.

- [ ] **Step 5.3: Implement**

In `src/app/gardens/species.service.ts`:

Add the import near the others:
```ts
import { PlantDimensionService } from './plant-dimension.service';
```

Extend the `Species` interface (after `external_data`):
```ts
  spread_ft_min: number | null;
  spread_ft_max: number | null;
  dimensions_source: 'perenual' | 'llm' | null;
```

Add the inject next to the existing `perenual`:
```ts
  private dimensions = inject(PlantDimensionService);
```

In `ensureByIdentification`, replace the Step 2 + Step 3 region (from `// Step 2: enrich via Perenual` through the `insert({...})` call) with this. The find/backfill branch above it and the `23505` catch below the insert stay exactly as they are:

```ts
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
    const usedPerenualDims =
      perenualData?.heightFtMin != null || perenualData?.heightFtMax != null;
    const usedLlmDims =
      heightFtMin != null ||
      heightFtMax != null ||
      spreadFtMin != null ||
      spreadFtMax != null;
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
```

Note: this moves `height_ft_min`/`height_ft_max` out of the Perenual-only spread and into the merged conditional spreads (so the LLM can supply them). The `external_id`/`external_data` stay gated on `perenualData`.

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `npm test -- --watch=false`
Expected: PASS. The earlier Task 6 (photo-ID) tests that asserted `height_ft_min: 1` from Perenual still pass because Perenual height still wins; the "plantnet-only" test still passes because with `perenualData` null and the default dimension mock returning all-nulls, no height/spread/source keys are added.

- [ ] **Step 5.5: Prettier + commit**

```bash
npx prettier --write src/app/gardens/species.service.ts src/app/gardens/species.service.spec.ts
git add src/app/gardens/species.service.ts src/app/gardens/species.service.spec.ts
git commit -m "feat: enrich identified species with Claude-sourced dimensions"
```

---

### Task 6: Seed plant diameter from species spread

**Files:**
- Modify: `src/app/gardens/garden-detail/garden-detail.ts`

- [ ] **Step 6.1: Update onIdentified**

In `src/app/gardens/garden-detail/garden-detail.ts`, in `onIdentified`, change the `plantService.create` call's `diameter_ft` line from:

```ts
        diameter_ft: this.newPlantDiameter(),
```

to:

```ts
        // Seed the on-map diameter from the species' mature canopy spread
        // (the circle represents footprint/spacing); fall back to the manual
        // field when spread is unknown.
        diameter_ft: species.spread_ft_max ?? this.newPlantDiameter(),
```

(The surrounding `create({...})` call and everything else in `onIdentified` is unchanged.)

- [ ] **Step 6.2: Run the suite and a production build**

```bash
cd "/Users/kmohan/Documents/Claude/Projects/garden app/garden-app"
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
npm test -- --watch=false
npm run build
```

Expected: tests PASS, build succeeds (catches template/type errors). `species.spread_ft_max` is typed by the `Species` interface change from Task 5, so this compiles.

- [ ] **Step 6.3: Prettier + commit**

```bash
npx prettier --write src/app/gardens/garden-detail/garden-detail.ts
git add src/app/gardens/garden-detail/garden-detail.ts
git commit -m "feat: seed photo-identified plant diameter from species spread"
```

---

### Task 7: Housekeeping + manual verification

**Files:**
- Create: `supabase/functions/.env.example`
- Modify: `supabase/functions/.gitignore` (create if absent)
- Modify: `DECISIONS.md`

- [ ] **Step 7.1: Add the function env example + gitignore**

Create `supabase/functions/.env.example`:

```
# Copy to supabase/functions/.env for local `supabase functions serve`.
# In production this is set via: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Create `supabase/functions/.gitignore` (so a real local key is never committed):

```
.env
```

- [ ] **Step 7.2: Add DECISIONS.md Entry #16**

Append to `DECISIONS.md`, following the file's template (Context/Options/Decision filled; Why/Tradeoffs as italic hints for the user to rewrite):

```markdown
## 16. Claude (Haiku) for plant dimensions, behind a Supabase Edge Function
**Date:** 2026-06-13
**Status:** Accepted

**Context.** Plants need a mature canopy spread to seed their on-map diameter, and a height for color-coding. Perenual's dimension data (Entry #14) turned out to be premium-only — its free tier returns no height or spread — so the data has to come from somewhere else, and the API key for that source must be handled safely.

**Options considered.**
- **Claude via a Supabase Edge Function** — Haiku 4.5 structured-output call; key in Supabase secrets.
- **Claude client-direct** — key in the bundle like Pl@ntNet/Perenual.
- **Pay for Perenual** — unlocks the details endpoint.
- **Manual entry only** — user types every plant's size.

**Decision.** Claude Haiku 4.5 behind a Supabase Edge Function, as the LLM fallback Entry #14 anticipated; the function is the first server-side component and the pattern phase 3 (AI recommendations) will reuse.

**Why (in my own words).**
*Hints: an Anthropic key can be abused across every model, not just a capped quota — unlike the Pl@ntNet/Perenual keys, it doesn't belong in the bundle; the edge function is the "real backend" the earlier entries kept deferring; cost is fractions of a cent per species, cached forever; doing it now pre-builds phase 3's Claude integration.*

**Tradeoffs / what we're giving up.**
*Hints: a new deploy artifact + local-dev step (functions serve, secrets); LLM dimensions are best-effort estimates, not a curated catalog (tracked via dimensions_source = 'llm'); one more external dependency in the add-plant flow, though it degrades to null dims on failure.*
```

- [ ] **Step 7.3: Commit**

```bash
git add supabase/functions/.env.example supabase/functions/.gitignore DECISIONS.md
git commit -m "docs: env example + DECISIONS entry for Claude dimension lookup"
```

- [ ] **Step 7.4: Manual verification checklist (requires the user's Anthropic key + deploy)**

Prerequisites the user completes (spec section 10): Anthropic key obtained, `supabase secrets set ANTHROPIC_API_KEY=…`, `supabase functions deploy plant-dimensions`, and the Task 1 migration applied.

Then `npm start` and verify on `http://localhost:49971`:

1. Identify a well-known plant from a photo (e.g. lavender) and add it. In Supabase Studio's `species` table, the new row has non-null `height_ft_min/max`, `spread_ft_min/max`, and `dimensions_source = 'llm'`.
2. The plant's circle on the yard map renders at a realistic size (its `diameter_ft` ≈ the species' `spread_ft_max`), not the old default of 1 ft.
3. Identify an obscure/unidentifiable plant: the species is still created with null dimensions, the plant gets the fallback diameter, and no error is shown.
4. Temporarily unset the secret (or before deploy): photo-add still works end to end; plants just get the default diameter (function returns nulls / invoke errors → swallowed).
5. Confirm the key is server-side only: view-source / network tab on the app shows calls to `…/functions/v1/plant-dimensions`, never a direct `api.anthropic.com` request and no `sk-ant-` string in the bundle.

---

## Self-Review Notes

- **Spec coverage:** Edge Function + parse (Tasks 2–3), `PlantDimensionService` (Task 4), migration (Task 1), `ensureByIdentification` merge with Perenual-height precedence + `dimensions_source` (Task 5), diameter seeding from `spread_ft_max` (Task 6), key-in-secrets / best-effort degradation (Tasks 3–4 return nulls on every failure path), owner setup + DECISIONS (Task 7).
- **Type consistency:** `Dimensions`/`PlantDimensions` share the four `*FtMin/Max` fields across the function (`dimensions.ts`), service (`plant-dimension.service.ts`), and tests; `Species` gains `spread_ft_min`/`spread_ft_max`/`dimensions_source` in Task 5 and Task 6 consumes `species.spread_ft_max`; the function's `claude-haiku-4-5` + `output_config.format` match the claude-api guidance (no `thinking`/`effort` on Haiku).
- **Known judgment calls:** the LLM fires for essentially every new species (free-tier Perenual has no dims) — intended per the spec, ~$0.0006/species cached forever. Existing-species adds skip the lookup (new-species-only scope). No automated HTTP-integration test for the deployed function; its only non-trivial logic (`parseDimensions`) is Deno-tested in Task 2, and the live path is covered by the Task 7 manual checklist.
