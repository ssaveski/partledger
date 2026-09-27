import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

/** A bare origin such as `https://app.example`, with no path, query or trailing slash. */
const origin = z
  .url({ protocol: /^https?$/, abort: true })
  .refine((value) => new URL(value).origin === value, 'must be an origin with no path or trailing slash');

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
    /**
     * The staff app's origin. It reaches the API through its own `/api` proxy (KTD30), so the
     * sign-in callback and the post-sign-in redirect both live on it.
     */
    STAFF_APP_ORIGIN: origin,
    /** The region's Keycloak realm, such as `https://id.example/realms/partledger` (KTD20). */
    KEYCLOAK_ISSUER: z.url({ protocol: /^https?$/ }).transform((issuer) => issuer.replace(/\/+$/, '')),
    KEYCLOAK_CLIENT_ID: z.string().min(1).default('partledger-api'),
    /** The confidential client's secret; set per environment from the secret store. */
    KEYCLOAK_CLIENT_SECRET: z.string().min(16),
    /** The shortest time between two fetches of the realm's signing keys when a token names an unknown key. */
    KEYCLOAK_JWKS_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
    /**
     * 32 random bytes, base64: encrypts the refresh tokens kept with staff sessions and the
     * short-lived sign-in state cookie. Generate with `openssl rand -base64 32`.
     */
    SESSION_TOKEN_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/, 'must be 32 bytes, base64-encoded')
      .transform((key) => Buffer.from(key, 'base64')),
    STAFF_SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(10_080).default(30),
    STAFF_SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().min(1).max(168).default(10),
    /** How often a session's tokens are refreshed against Keycloak; a failed refresh ends the session. */
    STAFF_SESSION_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
    /** pg-boss connects as `pl_job_runner`, which reaches the job queue schema and nothing else (KTD16). */
    JOBS_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    JOBS_DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(5),
    /** `on` runs job handlers and fires schedules in this process; `off` only enqueues. */
    JOBS_WORKERS: z.enum(['on', 'off']).default('on'),
    /** The supplier portal's origin, which links in supplier emails open (KTD30, KTD33). */
    PORTAL_APP_ORIGIN: origin.default('http://127.0.0.1:5174'),
    /**
     * The email port's adapter (KTD36). `local` writes each email as a file to a dev inbox; the
     * production provider's adapter, processing in the tenant's region, arrives with U24.
     */
    EMAIL_ADAPTER: z.enum(['local']).default('local'),
    /** Where the local adapter writes emails, one JSON file per notification. */
    EMAIL_LOCAL_INBOX_DIRECTORY: z.string().min(1).default('local-dev/email-inbox'),
    /** The sender of every notification email. */
    EMAIL_FROM_ADDRESS: z.email().default('notifications@partledger.invalid'),
  })
  .superRefine((config, context) => {
    const seen = new Set<number>();
    for (const name of listenerPorts) {
      if (seen.has(config[name])) {
        context.addIssue({ code: 'custom', path: [name], message: 'must differ from the other listener ports' });
      }
      seen.add(config[name]);
    }
    if (config.NODE_ENV === 'production') {
      for (const name of ['STAFF_APP_ORIGIN', 'PORTAL_APP_ORIGIN', 'KEYCLOAK_ISSUER'] as const) {
        if (!config[name].startsWith('https://')) {
          context.addIssue({ code: 'custom', path: [name], message: 'must use https in production' });
        }
      }
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
