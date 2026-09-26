import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  HOST: z.string().min(1).default('127.0.0.1'),
  /** Connects as `pl_app`, never as the owner or a superuser; row-level security depends on it. */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
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
