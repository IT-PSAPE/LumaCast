import { CodecError, fail, isRecord, rejectUnknownKeys, type CodecContext } from './codecs';

/**
 * A schema combinator that produces both a runtime decoder and a JSON Schema
 * (draft 2020-12 compatible, the shape LLM tool-parameter schemas expect)
 * from a single declaration. Where `codecs.ts` hand-writes a decoder per
 * wire shape, this module lets a shape be declared once via `s.object(...)`,
 * `s.array(...)`, etc. and get both representations for free.
 *
 * Decoders integrate with the existing trust-boundary contract: they throw
 * `CodecError` via the shared `fail(context, message)` (imported from
 * `./codecs`, so the `[boundary/operation] path: message` format is
 * identical), unknown object keys are rejected via the same
 * `rejectUnknownKeys` every hand-written codec uses, and nested paths are
 * appended the same way — an object field appends `.field`, an array index
 * appends `[index]` (see `childField`/`childIndex` below).
 *
 * Zero runtime dependencies: `JsonSchema` is a plain object type, not an
 * import of an external JSON Schema library.
 */

export interface JsonSchema {
  [key: string]: unknown;
}

export interface Schema<T> {
  /** Phantom marker; never assigned. Lets `Infer<S>` pull `T` back out. */
  readonly _type?: T;
  decode(value: unknown, context: CodecContext): T;
  toJsonSchema(): JsonSchema;
  /** Returns a new schema with `description` set in its JSON Schema output. */
  describe(description: string): Schema<T>;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

// ---------------------------------------------------------------------------
// Shared path helpers (mirror codecs.ts's `child`, but always resolvable
// from a plain field name or numeric index rather than a pre-formatted
// segment string, and use bracket notation for indices per this module's
// convention: `path.field` for object keys, `path[3]` for array indices).
// ---------------------------------------------------------------------------

function childField(context: CodecContext, field: string): CodecContext {
  return { ...context, path: context.path ? `${context.path}.${field}` : field };
}

function childIndex(context: CodecContext, index: number): CodecContext {
  return { ...context, path: `${context.path}[${index}]` };
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Internal schema metadata. Not part of the public `Schema<T>` shape — it
// lets composite builders (`object`, `discriminatedUnion`, `nullable`)
// recognize schemas built by `s.literal`/`s.optional`/`s.object` without
// widening the public interface every other schema has to implement.
// ---------------------------------------------------------------------------

const INTERNAL = Symbol('schema.internal');

type InternalInfo =
  | { readonly kind: 'object'; readonly props: Record<string, Schema<unknown>>; readonly optionalKeys: ReadonlySet<string> }
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'optional' }
  | { readonly kind: 'other' };

interface SchemaInternal<T> extends Schema<T> {
  readonly [INTERNAL]: InternalInfo;
}

function internalOf(schema: Schema<unknown>): InternalInfo {
  return (schema as SchemaInternal<unknown>)[INTERNAL] ?? { kind: 'other' };
}

function createSchema<T>(
  decode: (value: unknown, context: CodecContext) => T,
  buildJsonSchema: () => JsonSchema,
  internal: InternalInfo = { kind: 'other' },
  currentDescription?: string,
): Schema<T> {
  const schema: SchemaInternal<T> = {
    decode,
    toJsonSchema(): JsonSchema {
      const base = buildJsonSchema();
      return currentDescription === undefined ? base : { ...base, description: currentDescription };
    },
    describe(nextDescription: string): Schema<T> {
      return createSchema(decode, buildJsonSchema, internal, nextDescription);
    },
    [INTERNAL]: internal,
  };
  return schema;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function stringSchema(opts: { minLength?: number; maxLength?: number; pattern?: RegExp } = {}): Schema<string> {
  return createSchema<string>(
    (value, context) => {
      if (typeof value !== 'string') fail(context, `must be a string, got ${describeValue(value)}`);
      if (opts.minLength !== undefined && value.length < opts.minLength) {
        fail(context, `must have length >= ${opts.minLength}, got ${value.length}`);
      }
      if (opts.maxLength !== undefined && value.length > opts.maxLength) {
        fail(context, `must have length <= ${opts.maxLength}, got ${value.length}`);
      }
      if (opts.pattern !== undefined && !opts.pattern.test(value)) {
        fail(context, `must match pattern ${opts.pattern.source}, got ${describeValue(value)}`);
      }
      return value;
    },
    () => {
      const json: JsonSchema = { type: 'string' };
      if (opts.minLength !== undefined) json.minLength = opts.minLength;
      if (opts.maxLength !== undefined) json.maxLength = opts.maxLength;
      if (opts.pattern !== undefined) json.pattern = opts.pattern.source;
      return json;
    },
  );
}

function numberSchema(opts: { min?: number; max?: number; integer?: boolean } = {}): Schema<number> {
  return createSchema<number>(
    (value, context) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(context, `must be a finite number, got ${describeValue(value)}`);
      }
      if (opts.integer && !Number.isInteger(value)) fail(context, `must be an integer, got ${describeValue(value)}`);
      if (opts.min !== undefined && value < opts.min) fail(context, `must be >= ${opts.min}, got ${value}`);
      if (opts.max !== undefined && value > opts.max) fail(context, `must be <= ${opts.max}, got ${value}`);
      return value;
    },
    () => {
      const json: JsonSchema = { type: opts.integer ? 'integer' : 'number' };
      if (opts.min !== undefined) json.minimum = opts.min;
      if (opts.max !== undefined) json.maximum = opts.max;
      return json;
    },
  );
}

function booleanSchema(): Schema<boolean> {
  return createSchema<boolean>(
    (value, context) => {
      if (typeof value !== 'boolean') fail(context, `must be a boolean, got ${describeValue(value)}`);
      return value;
    },
    () => ({ type: 'boolean' }),
  );
}

function literalSchema<const V extends string | number | boolean>(value: V): Schema<V> {
  const jsonType = typeof value === 'string' ? 'string' : typeof value === 'number' ? 'number' : 'boolean';
  return createSchema<V>(
    (input, context) => {
      if (input !== value) fail(context, `must be ${describeValue(value)}, got ${describeValue(input)}`);
      return value;
    },
    () => ({ type: jsonType, const: value }),
    { kind: 'literal', value },
  );
}

function enumSchema<const V extends readonly string[]>(values: V): Schema<V[number]> {
  const allowed = values as readonly string[];
  return createSchema<V[number]>(
    (input, context) => {
      if (typeof input !== 'string' || !allowed.includes(input)) {
        fail(context, `must be one of [${allowed.join(', ')}], got ${describeValue(input)}`);
      }
      return input as V[number];
    },
    () => ({ type: 'string', enum: [...allowed] }),
  );
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

function arraySchema<T>(item: Schema<T>, opts: { minItems?: number; maxItems?: number } = {}): Schema<T[]> {
  return createSchema<T[]>(
    (value, context) => {
      if (!Array.isArray(value)) fail(context, `must be an array, got ${describeValue(value)}`);
      if (opts.minItems !== undefined && value.length < opts.minItems) {
        fail(context, `must have at least ${opts.minItems} items, got ${value.length}`);
      }
      if (opts.maxItems !== undefined && value.length > opts.maxItems) {
        fail(context, `must have at most ${opts.maxItems} items, got ${value.length}`);
      }
      return value.map((entry: unknown, index: number) => item.decode(entry, childIndex(context, index)));
    },
    () => {
      const json: JsonSchema = { type: 'array', items: item.toJsonSchema() };
      if (opts.minItems !== undefined) json.minItems = opts.minItems;
      if (opts.maxItems !== undefined) json.maxItems = opts.maxItems;
      return json;
    },
  );
}

type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Keys whose declared schema already includes `undefined` (i.e. built via `s.optional(...)`). */
type OptionalValueKeys<P> = { [K in keyof P]: undefined extends Infer<P[K]> ? K : never }[keyof P];

type ObjectShape<P extends Record<string, Schema<unknown>>, Opt extends readonly (keyof P)[]> = Prettify<
  { [K in Exclude<keyof P, OptionalValueKeys<P> | Opt[number]>]: Infer<P[K]> } & {
    [K in Extract<keyof P, OptionalValueKeys<P> | Opt[number]>]?: Infer<P[K]>;
  }
>;

function objectSchema<P extends Record<string, Schema<unknown>>, Opt extends readonly (keyof P)[] = []>(
  props: P,
  opts?: { optional?: Opt },
): Schema<ObjectShape<P, Opt>> {
  const knownKeys = Object.keys(props);
  const optionalKeys = new Set<string>((opts?.optional as readonly string[] | undefined) ?? []);
  for (const key of knownKeys) {
    if (internalOf(props[key]).kind === 'optional') optionalKeys.add(key);
  }

  return createSchema<ObjectShape<P, Opt>>(
    (value, context) => {
      if (!isRecord(value)) fail(context, `must be an object, got ${describeValue(value)}`);
      rejectUnknownKeys(value, context, knownKeys);
      const result: Record<string, unknown> = {};
      for (const key of knownKeys) {
        if (optionalKeys.has(key) && value[key] === undefined) continue;
        result[key] = props[key].decode(value[key], childField(context, key));
      }
      return result as ObjectShape<P, Opt>;
    },
    () => {
      const properties: Record<string, JsonSchema> = {};
      for (const key of knownKeys) properties[key] = props[key].toJsonSchema();
      const required = knownKeys.filter((key) => !optionalKeys.has(key));
      return { type: 'object', properties, required, additionalProperties: false };
    },
    { kind: 'object', props: props as Record<string, Schema<unknown>>, optionalKeys },
  );
}

function recordSchema<T>(value: Schema<T>): Schema<Record<string, T>> {
  return createSchema<Record<string, T>>(
    (input, context) => {
      if (!isRecord(input)) fail(context, `must be an object, got ${describeValue(input)}`);
      const result: Record<string, T> = {};
      for (const key of Object.keys(input)) {
        result[key] = value.decode(input[key], childField(context, key));
      }
      return result;
    },
    () => ({ type: 'object', additionalProperties: value.toJsonSchema() }),
  );
}

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------

function unionSchema<T extends readonly Schema<unknown>[]>(members: T): Schema<Infer<T[number]>> {
  return createSchema<Infer<T[number]>>(
    (value, context) => {
      const problems: string[] = [];
      for (const member of members) {
        try {
          return member.decode(value, context) as Infer<T[number]>;
        } catch (error) {
          problems.push(error instanceof CodecError ? error.message : String(error));
        }
      }
      fail(context, `did not match any option:\n  - ${problems.join('\n  - ')}`);
    },
    () => ({ anyOf: members.map((member) => member.toJsonSchema()) }),
  );
}

function discriminatedUnionSchema<K extends string, T extends readonly Schema<{ [key in K]: string }>[]>(
  key: K,
  members: T,
): Schema<Infer<T[number]>> {
  const dispatch = new Map<string, Schema<unknown>>();
  for (const member of members) {
    const info = internalOf(member);
    if (info.kind !== 'object') {
      throw new Error(`discriminatedUnion('${key}'): every member must be built with s.object(...)`);
    }
    const discriminantSchema = info.props[key];
    const discriminantInfo = discriminantSchema && internalOf(discriminantSchema);
    if (!discriminantSchema || discriminantInfo.kind !== 'literal' || typeof discriminantInfo.value !== 'string') {
      throw new Error(`discriminatedUnion('${key}'): every member must declare '${key}' via s.literal(<string>)`);
    }
    dispatch.set(discriminantInfo.value, member as Schema<unknown>);
  }

  return createSchema<Infer<T[number]>>(
    (value, context) => {
      if (!isRecord(value)) fail(context, `must be an object, got ${describeValue(value)}`);
      const tag = value[key];
      if (typeof tag !== 'string') {
        fail(childField(context, key), `must be a string, got ${describeValue(tag)}`);
      }
      const member = dispatch.get(tag);
      if (!member) {
        fail(childField(context, key), `must be one of [${[...dispatch.keys()].join(', ')}], got ${describeValue(tag)}`);
      }
      return member.decode(value, context) as Infer<T[number]>;
    },
    () => ({ oneOf: members.map((member) => member.toJsonSchema()) }),
  );
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

const PRIMITIVE_JSON_TYPES = new Set(['string', 'number', 'integer', 'boolean']);

function nullableSchema<T>(inner: Schema<T>): Schema<T | null> {
  return createSchema<T | null>(
    (value, context) => (value === null ? null : inner.decode(value, context)),
    () => {
      const innerSchema = inner.toJsonSchema();
      const type = innerSchema.type;
      if (typeof type === 'string' && PRIMITIVE_JSON_TYPES.has(type) && !('const' in innerSchema) && !('enum' in innerSchema)) {
        return { ...innerSchema, type: [type, 'null'] };
      }
      return { anyOf: [innerSchema, { type: 'null' }] };
    },
  );
}

function optionalSchema<T>(inner: Schema<T>): Schema<T | undefined> {
  return createSchema<T | undefined>(
    (value, context) => (value === undefined ? undefined : inner.decode(value, context)),
    () => inner.toJsonSchema(),
    { kind: 'optional' },
  );
}

function unknownSchema(): Schema<unknown> {
  return createSchema<unknown>(
    (value: unknown) => value,
    () => ({}),
  );
}

function lazySchema<T>(thunk: () => Schema<T>): Schema<T> {
  let resolved: Schema<T> | undefined;
  const resolve = (): Schema<T> => {
    if (!resolved) resolved = thunk();
    return resolved;
  };

  // A truly recursive shape (a schema that refers to itself through the
  // thunk) would otherwise make `toJsonSchema()` recurse forever, since the
  // interface returns a plain, self-contained object rather than threading a
  // `$defs`/`$ref` registry through every call. Break the cycle at the
  // re-entrancy point instead: the first call resolves and expands
  // normally, and any call that re-enters while that expansion is still in
  // flight gets an open (unconstrained) placeholder for the recursive edge.
  let expanding = false;

  return createSchema<T>(
    (value, context) => resolve().decode(value, context),
    () => {
      if (expanding) return { description: 'recursive reference (see enclosing schema)' };
      expanding = true;
      try {
        return resolve().toJsonSchema();
      } finally {
        expanding = false;
      }
    },
  );
}

export const s = {
  string: stringSchema,
  number: numberSchema,
  boolean: booleanSchema,
  literal: literalSchema,
  enum: enumSchema,
  array: arraySchema,
  object: objectSchema,
  record: recordSchema,
  union: unionSchema,
  discriminatedUnion: discriminatedUnionSchema,
  nullable: nullableSchema,
  optional: optionalSchema,
  unknown: unknownSchema,
  lazy: lazySchema,
};
