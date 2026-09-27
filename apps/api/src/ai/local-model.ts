import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamResult,
} from '@ai-sdk/provider';

/**
 * The deterministic local model (KTD36's local adapter for AI): it sends nothing anywhere. By
 * default it answers every structured call with the smallest value its JSON schema allows
 * (nulls, empty arrays, first enumeration values, zeros), so development runs end to end
 * without a provider. Tests give it a responder to script the model's answer.
 */

export interface LocalModelRequest {
  /** The instructions and the document text, in prompt order. */
  readonly promptText: string;
  /** The JSON schema the answer must follow, as the structured call sent it. */
  readonly schema: unknown;
}

/** Returns the model's raw text answer. */
export type LocalResponder = (request: LocalModelRequest) => string;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The smallest JSON value a (zod-generated) JSON schema allows. */
export function minimalInstanceOf(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return null;
  }
  if ('const' in schema) {
    return schema.const;
  }
  if (Array.isArray(schema.enum)) {
    const values: readonly unknown[] = schema.enum;
    return values[0] ?? null;
  }
  for (const combinator of ['anyOf', 'oneOf'] as const) {
    const options: unknown = schema[combinator];
    if (Array.isArray(options)) {
      const choices: readonly unknown[] = options;
      const nullable = choices.find((option) => isRecord(option) && option.type === 'null');
      return nullable === undefined ? minimalInstanceOf(choices[0]) : null;
    }
  }
  const types: readonly unknown[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('null')) {
    return null;
  }
  switch (types[0]) {
    case 'object': {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, minimalInstanceOf(value)]));
    }
    case 'array': {
      const minimum = typeof schema.minItems === 'number' ? schema.minItems : 0;
      return Array.from({ length: minimum }, () => minimalInstanceOf(schema.items));
    }
    case 'string':
      return 'x'.repeat(typeof schema.minLength === 'number' ? schema.minLength : 0);
    case 'number':
    case 'integer':
      return typeof schema.minimum === 'number' ? schema.minimum : 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

function promptTextOf(options: LanguageModelV4CallOptions): string {
  return options.prompt
    .flatMap((message) => {
      if (message.role === 'system') {
        return [message.content];
      }
      if (message.role === 'user') {
        return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
      }
      return [];
    })
    .join('\n');
}

export const localModelProvider = 'local';

export class LocalLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4';
  readonly provider = localModelProvider;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(
    readonly modelId: string,
    private readonly responder: LocalResponder | undefined,
  ) {}

  doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    const schema = options.responseFormat?.type === 'json' ? options.responseFormat.schema : undefined;
    const text =
      this.responder === undefined
        ? JSON.stringify(minimalInstanceOf(schema))
        : this.responder({ promptText: promptTextOf(options), schema });
    return Promise.resolve({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      },
      warnings: [],
    });
  }

  doStream(): Promise<LanguageModelV4StreamResult> {
    return Promise.reject(new Error('The local model answers structured calls only'));
  }
}
