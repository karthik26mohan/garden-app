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
