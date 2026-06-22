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
