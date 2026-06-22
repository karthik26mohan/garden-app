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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  const label = commonName ? `${scientificName} (commonly "${commonName}")` : scientificName;
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
