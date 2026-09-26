import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

const listenerPorts = ['STAFF_PORT', 'PORTAL_PORT', 'DROP_PORT', 'OPERATOR_PORT'] as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    /** One listener per entry adapter (KTD30); each accepts only its own credential kind. */
    STAFF_PORT: port,
    PORTAL_PORT: port,
    DROP_PORT: port,
    OPERATOR_PORT: port,
    /** The staff, portal and drop listeners bind here. */
    HOST: z.string().min(1).default('127.0.0.1'),
    /** The operator listener binds only to the operator network's interface. */
    OPERATOR_HOST: z.string().min(1).default('127.0.0.1'),
    /** Connects as `pl_app`, never as the owner or a superuser; row-level security depends on it. */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  })
  .superRefine((config, context) => {
    const seen = new Set<number>();
    for (const name of listenerPorts) {
      if (seen.has(config[name])) {
        context.addIssue({ code: 'custom', path: [name], message: 'must differ from the other listener ports' });
      }
      seen.add(config[name]);
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export class InvalidConfigurationError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[], details: string) {
    super(`Invalid configuration: ${details}`);
    this.name = 'InvalidConfigurationError';
    this.fields = fields;
  }
}

export function parseConfig(environment: Readonly<Record<string, string | undefined>>): AppConfig {
  const parsed = envSchema.safeParse(environment);
  if (parsed.success) {
    return parsed.data;
  }
  const fields = parsed.error.issues.map((issue) => issue.path.join('.'));
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new InvalidConfigurationError(fields, details);
}

/** The only place that reads the process environment. */
export function loadConfig(): AppConfig {
  return parseConfig(process.env);
}
