import { describe, expect, expectTypeOf, it } from 'vitest';
import { CodecError, type CodecContext } from '../../../../packages/protocol/src/codecs';
import { s, type Infer, type Schema } from '../../../../packages/protocol/src/schema';

const CONTEXT: CodecContext = { boundary: 'test', operation: 'unit', path: '' };

function pathOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof CodecError) return error.fieldPath;
    throw error;
  }
  throw new Error('expected fn to throw a CodecError');
}

function messageOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof CodecError) return error.message;
    throw error;
  }
  throw new Error('expected fn to throw a CodecError');
}

describe('s.string', () => {
  it('decodes a string', () => {
    expect(s.string().decode('hello', CONTEXT)).toBe('hello');
  });

  it('rejects a non-string', () => {
    expect(() => s.string().decode(5, CONTEXT)).toThrow(CodecError);
    expect(messageOf(() => s.string().decode(5, { ...CONTEXT, path: 'name' }))).toBe(
      '[test/unit] name: must be a string, got 5',
    );
  });

  it('enforces minLength/maxLength/pattern', () => {
    const schema = s.string({ minLength: 2, maxLength: 4, pattern: /^[a-z]+$/ });
    expect(schema.decode('abc', CONTEXT)).toBe('abc');
    expect(() => schema.decode('a', CONTEXT)).toThrow(/must have length >= 2/);
    expect(() => schema.decode('abcde', CONTEXT)).toThrow(/must have length <= 4/);
    expect(() => schema.decode('ABC', CONTEXT)).toThrow(/must match pattern/);
  });

  it('produces a JSON Schema', () => {
    expect(s.string({ minLength: 1, maxLength: 3, pattern: /^a+$/ }).toJsonSchema()).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 3,
      pattern: '^a+$',
    });
  });
});

describe('s.number', () => {
  it('decodes a finite number', () => {
    expect(s.number().decode(3.5, CONTEXT)).toBe(3.5);
  });

  it('rejects non-finite values', () => {
    expect(() => s.number().decode(Number.NaN, CONTEXT)).toThrow(/must be a finite number/);
    expect(() => s.number().decode('5', CONTEXT)).toThrow(/must be a finite number, got "5"/);
  });

  it('enforces integer/min/max', () => {
    const schema = s.number({ min: 0, max: 10, integer: true });
    expect(schema.decode(5, CONTEXT)).toBe(5);
    expect(() => schema.decode(5.5, CONTEXT)).toThrow(/must be an integer/);
    expect(() => schema.decode(-1, CONTEXT)).toThrow(/must be >= 0/);
    expect(() => schema.decode(11, CONTEXT)).toThrow(/must be <= 10/);
  });

  it('produces a JSON Schema', () => {
    expect(s.number({ min: 0, max: 10, integer: true }).toJsonSchema()).toEqual({
      type: 'integer',
      minimum: 0,
      maximum: 10,
    });
    expect(s.number().toJsonSchema()).toEqual({ type: 'number' });
  });
});

describe('s.boolean', () => {
  it('decodes booleans and rejects everything else', () => {
    expect(s.boolean().decode(true, CONTEXT)).toBe(true);
    expect(() => s.boolean().decode(1, CONTEXT)).toThrow(/must be a boolean, got 1/);
    expect(s.boolean().toJsonSchema()).toEqual({ type: 'boolean' });
  });
});

describe('s.literal', () => {
  it('accepts only the exact value', () => {
    const schema = s.literal('circle');
    expect(schema.decode('circle', CONTEXT)).toBe('circle');
    expect(() => schema.decode('square', CONTEXT)).toThrow('[test/unit] must be "circle", got "square"');
  });

  it('produces a JSON Schema with const', () => {
    expect(s.literal(3).toJsonSchema()).toEqual({ type: 'number', const: 3 });
    expect(s.literal(true).toJsonSchema()).toEqual({ type: 'boolean', const: true });
  });
});

describe('s.enum', () => {
  const schema = s.enum(['red', 'green', 'blue'] as const);

  it('decodes an allowed value', () => {
    expect(schema.decode('green', CONTEXT)).toBe('green');
  });

  it('rejects a disallowed value with the allowed list in the message', () => {
    expect(() => schema.decode('purple', { ...CONTEXT, path: 'color' })).toThrow(
      '[test/unit] color: must be one of [red, green, blue], got "purple"',
    );
  });

  it('produces a JSON Schema', () => {
    expect(schema.toJsonSchema()).toEqual({ type: 'string', enum: ['red', 'green', 'blue'] });
  });
});

describe('s.array', () => {
  const schema = s.array(s.string());

  it('decodes each item', () => {
    expect(schema.decode(['a', 'b'], CONTEXT)).toEqual(['a', 'b']);
  });

  it('rejects a non-array', () => {
    expect(() => schema.decode('nope', CONTEXT)).toThrow(/must be an array/);
  });

  it('reports the failing index using bracket notation', () => {
    expect(pathOf(() => schema.decode(['a', 5, 'c'], CONTEXT))).toBe('[1]');
    expect(pathOf(() => schema.decode(['a', 5, 'c'], { ...CONTEXT, path: 'tags' }))).toBe('tags[1]');
  });

  it('enforces minItems/maxItems', () => {
    const bounded = s.array(s.string(), { minItems: 1, maxItems: 2 });
    expect(() => bounded.decode([], CONTEXT)).toThrow(/must have at least 1 items/);
    expect(() => bounded.decode(['a', 'b', 'c'], CONTEXT)).toThrow(/must have at most 2 items/);
  });

  it('produces a JSON Schema', () => {
    expect(s.array(s.number(), { minItems: 1 }).toJsonSchema()).toEqual({
      type: 'array',
      items: { type: 'number' },
      minItems: 1,
    });
  });
});

describe('s.object', () => {
  const schema = s.object(
    {
      name: s.string(),
      nickname: s.optional(s.string()),
      age: s.number(),
    },
    { optional: ['age'] },
  );

  it('decodes a fully-populated object', () => {
    expect(schema.decode({ name: 'Ada', nickname: 'Countess', age: 36 }, CONTEXT)).toEqual({
      name: 'Ada',
      nickname: 'Countess',
      age: 36,
    });
  });

  it('omits keys that are optional (via opts.optional or s.optional) when absent', () => {
    expect(schema.decode({ name: 'Ada' }, CONTEXT)).toEqual({ name: 'Ada' });
  });

  it('rejects a non-object', () => {
    expect(() => schema.decode(['not', 'an', 'object'], CONTEXT)).toThrow(/must be an object/);
    expect(() => schema.decode(null, CONTEXT)).toThrow(/must be an object, got null/);
  });

  it('fails on a missing required key with the field appended to the path', () => {
    expect(pathOf(() => schema.decode({}, CONTEXT))).toBe('name');
    expect(messageOf(() => schema.decode({}, CONTEXT))).toBe('[test/unit] name: must be a string, got undefined');
  });

  it('rejects unknown keys the same way rejectUnknownKeys does', () => {
    expect(() => schema.decode({ name: 'Ada', bogus: true }, CONTEXT)).toThrow(
      '[test/unit] bogus: unknown field',
    );
  });

  it('produces a JSON Schema with required limited to non-optional keys', () => {
    expect(schema.toJsonSchema()).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        nickname: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
      additionalProperties: false,
    });
  });

  it('nests object and array paths correctly (object.key, array[index])', () => {
    const nested = s.object({
      address: s.object({ city: s.string() }),
      tags: s.array(s.string()),
    });
    expect(
      pathOf(() => nested.decode({ address: { city: 5 }, tags: ['ok'] }, CONTEXT)),
    ).toBe('address.city');
    expect(
      pathOf(() => nested.decode({ address: { city: 'x' }, tags: ['ok', 5] }, CONTEXT)),
    ).toBe('tags[1]');
  });
});

describe('s.record', () => {
  const schema = s.record(s.number());

  it('decodes every value', () => {
    expect(schema.decode({ a: 1, b: 2 }, CONTEXT)).toEqual({ a: 1, b: 2 });
  });

  it('rejects a non-object', () => {
    expect(() => schema.decode([1, 2], CONTEXT)).toThrow(/must be an object/);
  });

  it('reports the failing key in the path', () => {
    expect(pathOf(() => schema.decode({ a: 1, b: 'nope' }, CONTEXT))).toBe('b');
  });

  it('produces a JSON Schema', () => {
    expect(schema.toJsonSchema()).toEqual({ type: 'object', additionalProperties: { type: 'number' } });
  });
});

describe('s.union', () => {
  const schema = s.union([s.string(), s.number()] as const);

  it('accepts any member', () => {
    expect(schema.decode('a', CONTEXT)).toBe('a');
    expect(schema.decode(5, CONTEXT)).toBe(5);
  });

  it('fails with every member reason when nothing matches', () => {
    const message = messageOf(() => schema.decode(true, CONTEXT));
    expect(message).toContain('did not match any option');
    expect(message).toContain('must be a string');
    expect(message).toContain('must be a finite number');
  });

  it('produces a JSON Schema with anyOf', () => {
    expect(schema.toJsonSchema()).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] });
  });
});

describe('s.discriminatedUnion', () => {
  const circle = s.object({ kind: s.literal('circle'), radius: s.number() });
  const square = s.object({ kind: s.literal('square'), side: s.number() });
  const shape = s.discriminatedUnion('kind', [circle, square] as const);

  it('dispatches to the matching member', () => {
    expect(shape.decode({ kind: 'circle', radius: 5 }, CONTEXT)).toEqual({ kind: 'circle', radius: 5 });
    expect(shape.decode({ kind: 'square', side: 2 }, CONTEXT)).toEqual({ kind: 'square', side: 2 });
  });

  it('rejects an unknown discriminant with the allowed list', () => {
    expect(() => shape.decode({ kind: 'triangle' }, CONTEXT)).toThrow(
      '[test/unit] kind: must be one of [circle, square], got "triangle"',
    );
  });

  it('still runs the matched member\'s own validation', () => {
    expect(pathOf(() => shape.decode({ kind: 'circle', radius: 'nope' }, CONTEXT))).toBe('radius');
  });

  it('produces a JSON Schema with oneOf', () => {
    expect(shape.toJsonSchema()).toEqual({
      oneOf: [circle.toJsonSchema(), square.toJsonSchema()],
    });
  });

  it('refuses to build when a member is not an object schema', () => {
    expect(() => s.discriminatedUnion('kind', [s.string() as unknown as Schema<{ kind: string }>])).toThrow(
      /must be built with s.object/,
    );
  });

  it('refuses to build when a member does not declare the key as a literal', () => {
    const loose = s.object({ kind: s.string() });
    expect(() => s.discriminatedUnion('kind', [loose])).toThrow(/must declare 'kind' via s.literal/);
  });
});

describe('s.nullable', () => {
  it('accepts null and delegates otherwise', () => {
    const schema = s.nullable(s.string());
    expect(schema.decode(null, CONTEXT)).toBeNull();
    expect(schema.decode('x', CONTEXT)).toBe('x');
    expect(() => schema.decode(5, CONTEXT)).toThrow(/must be a string/);
  });

  it('uses a type array for primitive inner schemas', () => {
    expect(s.nullable(s.string()).toJsonSchema()).toEqual({ type: ['string', 'null'] });
    expect(s.nullable(s.number({ min: 0 })).toJsonSchema()).toEqual({ type: ['number', 'null'], minimum: 0 });
  });

  it('falls back to anyOf for non-primitive or const/enum inner schemas', () => {
    expect(s.nullable(s.literal('a')).toJsonSchema()).toEqual({
      anyOf: [{ type: 'string', const: 'a' }, { type: 'null' }],
    });
    const objectSchema = s.object({ x: s.number() });
    expect(s.nullable(objectSchema).toJsonSchema()).toEqual({
      anyOf: [objectSchema.toJsonSchema(), { type: 'null' }],
    });
  });
});

describe('s.optional', () => {
  it('passes undefined through and delegates otherwise', () => {
    const schema = s.optional(s.string());
    expect(schema.decode(undefined, CONTEXT)).toBeUndefined();
    expect(schema.decode('x', CONTEXT)).toBe('x');
    expect(() => schema.decode(5, CONTEXT)).toThrow(/must be a string/);
  });

  it('mirrors the inner JSON Schema (optionality is expressed via `required`)', () => {
    expect(s.optional(s.string()).toJsonSchema()).toEqual({ type: 'string' });
  });
});

describe('s.unknown', () => {
  it('accepts anything and constrains nothing', () => {
    const schema = s.unknown();
    expect(schema.decode('x', CONTEXT)).toBe('x');
    expect(schema.decode(undefined, CONTEXT)).toBeUndefined();
    expect(schema.decode({ a: 1 }, CONTEXT)).toEqual({ a: 1 });
    expect(schema.toJsonSchema()).toEqual({});
  });
});

describe('s.lazy', () => {
  interface TreeNode {
    value: number;
    children: TreeNode[];
  }

  const treeSchema: Schema<TreeNode> = s.object({
    value: s.number(),
    children: s.array(s.lazy(() => treeSchema)),
  });

  it('decodes an arbitrarily deep recursive structure', () => {
    const input = {
      value: 1,
      children: [
        { value: 2, children: [] },
        { value: 3, children: [{ value: 4, children: [] }] },
      ],
    };
    expect(treeSchema.decode(input, CONTEXT)).toEqual(input);
  });

  it('reports a deep path through repeated recursion', () => {
    const input = { value: 1, children: [{ value: 2, children: [{ value: 'bad', children: [] }] }] };
    expect(pathOf(() => treeSchema.decode(input, CONTEXT))).toBe('children[0].children[0].value');
  });

  it('does not overflow the stack when generating a JSON Schema for a self-referential shape', () => {
    let json: unknown;
    expect(() => {
      json = treeSchema.toJsonSchema();
    }).not.toThrow();
    expect(json).toMatchObject({
      type: 'object',
      required: ['value', 'children'],
      additionalProperties: false,
    });
  });
});

describe('.describe()', () => {
  it('sets description without mutating the original schema', () => {
    const base = s.string();
    const described = base.describe('A greeting');
    expect(base.toJsonSchema().description).toBeUndefined();
    expect(described.toJsonSchema()).toEqual({ type: 'string', description: 'A greeting' });
  });

  it('propagates through object properties', () => {
    const schema = s.object({ name: s.string().describe('Full name') });
    expect(schema.toJsonSchema()).toEqual({
      type: 'object',
      properties: { name: { type: 'string', description: 'Full name' } },
      required: ['name'],
      additionalProperties: false,
    });
  });

  it('can describe a whole object schema', () => {
    const schema = s.object({ x: s.number() }).describe('A point');
    expect(schema.toJsonSchema().description).toBe('A point');
  });
});

describe('a realistic nested object (snapshot-style toJsonSchema assertion)', () => {
  const personSchema = s
    .object(
      {
        id: s.string({ minLength: 1 }).describe('Unique identifier'),
        name: s.string(),
        age: s.number({ min: 0, integer: true }),
        role: s.enum(['admin', 'member', 'guest'] as const),
        address: s.object({
          street: s.string(),
          city: s.string(),
          zip: s.nullable(s.string()),
        }),
        tags: s.array(s.string()),
        email: s.optional(s.string()),
        metadata: s.record(s.unknown()),
      },
      { optional: ['metadata'] },
    )
    .describe('A person record');

  it('decodes a full and a minimal example', () => {
    expect(
      personSchema.decode(
        {
          id: 'p-1',
          name: 'Ada',
          age: 36,
          role: 'admin',
          address: { street: '1 Main St', city: 'London', zip: null },
          tags: ['founder'],
          email: 'ada@example.com',
          metadata: { source: 'import' },
        },
        CONTEXT,
      ),
    ).toEqual({
      id: 'p-1',
      name: 'Ada',
      age: 36,
      role: 'admin',
      address: { street: '1 Main St', city: 'London', zip: null },
      tags: ['founder'],
      email: 'ada@example.com',
      metadata: { source: 'import' },
    });

    expect(
      personSchema.decode(
        {
          id: 'p-2',
          name: 'Grace',
          age: 40,
          role: 'member',
          address: { street: '2 Main St', city: 'NYC', zip: '10001' },
          tags: [],
        },
        CONTEXT,
      ),
    ).toEqual({
      id: 'p-2',
      name: 'Grace',
      age: 40,
      role: 'member',
      address: { street: '2 Main St', city: 'NYC', zip: '10001' },
      tags: [],
    });
  });

  it('produces the exact expected JSON Schema shape', () => {
    expect(personSchema.toJsonSchema()).toEqual({
      type: 'object',
      description: 'A person record',
      properties: {
        id: { type: 'string', minLength: 1, description: 'Unique identifier' },
        name: { type: 'string' },
        age: { type: 'integer', minimum: 0 },
        role: { type: 'string', enum: ['admin', 'member', 'guest'] },
        address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
            zip: { type: ['string', 'null'] },
          },
          required: ['street', 'city', 'zip'],
          additionalProperties: false,
        },
        tags: { type: 'array', items: { type: 'string' } },
        email: { type: 'string' },
        metadata: { type: 'object', additionalProperties: {} },
      },
      required: ['id', 'name', 'age', 'role', 'address', 'tags'],
      additionalProperties: false,
    });
  });

  it('infers the TypeScript shape, including optional keys', () => {
    expectTypeOf<Infer<typeof personSchema>>().toEqualTypeOf<{
      id: string;
      name: string;
      age: number;
      role: 'admin' | 'member' | 'guest';
      address: { street: string; city: string; zip: string | null };
      tags: string[];
      email?: string;
      metadata?: Record<string, unknown>;
    }>();
  });
});

describe('type inference', () => {
  it('infers a discriminated union as the member union', () => {
    const circle = s.object({ kind: s.literal('circle'), radius: s.number() });
    const square = s.object({ kind: s.literal('square'), side: s.number() });
    const shape = s.discriminatedUnion('kind', [circle, square] as const);

    expectTypeOf<Infer<typeof shape>>().toEqualTypeOf<
      { kind: 'circle'; radius: number } | { kind: 'square'; side: number }
    >();
  });

  it('infers a plain union as the member union', () => {
    const schema = s.union([s.string(), s.number()] as const);
    expectTypeOf<Infer<typeof schema>>().toEqualTypeOf<string | number>();
  });
});
