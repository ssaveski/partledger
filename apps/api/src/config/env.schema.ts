import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

/** A bare origin such as `https://app.example`, with no path, query or trailing slash. */
const origin = z
  .url({ protocol: /^https?$/, abort: true })
  .refine((value) => new URL(value).origin === value, 'must be an origin with no path or trailing slash');

/** Adapters that send nothing, which production refuses. */
const nonSendingEmailAdapters: ReadonlySet<string> = new Set(['local']);

const listenerPorts = ['STAFF_PORT', 'PORTAL_PORT', 'DROP_PORT', 'OPERATOR_PORT'] as const;

const regions = ['ca', 'eu'] as const;

const kmsSettings = [
  'OVH_KMS_ENDPOINT',
  'OVH_KMS_ID',
  'OVH_KMS_ENCRYPTION_KEY_ID',
  'OVH_KMS_SIGNING_KEY_ID',
  'OVH_KMS_CLIENT_CERTIFICATE_FILE',
  'OVH_KMS_CLIENT_KEY_FILE',
] as const;
/** An S3 bucket name: lowercase letters, digits, dots and hyphens. */
const bucketName = z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/);

const byteCount = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

const issuer = z.url({ protocol: /^https?$/ }).transform((value) => value.replace(/\/+$/, ''));

/** `ca=https://ca.example,eu=https://eu.example`: each region's staff app, for the directory. */
const regionUrls = z
  .string()
  .min(1)
  .transform((value, context) => {
    const entries: Partial<Record<(typeof regions)[number], string>> = {};
    for (const pair of value.split(',')) {
      const separator = pair.indexOf('=');
      const region = z.enum(regions).safeParse(pair.slice(0, separator).trim());
      const url = origin.safeParse(pair.slice(separator + 1).trim());
      if (separator === -1 || !region.success || !url.success || entries[region.data] !== undefined) {
        context.addIssue({ code: 'custom', message: 'must be region=origin pairs, such as ca=https://ca.example' });
        return z.NEVER;
      }
      entries[region.data] = url.data;
    }
    return entries;
  });

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
    KEYCLOAK_ISSUER: issuer,
    KEYCLOAK_CLIENT_ID: z.string().min(1).default('partledger-api'),
    /** The confidential client's secret; set per environment from the secret store. */
    KEYCLOAK_CLIENT_SECRET: z.string().min(16),
    /**
     * The API's service-account client for the realm's admin API: it resets second factors
     * and ends users' Keycloak sessions (U29). Its residual scope is in docs/runbooks/keycloak.md.
     */
    KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).default('partledger-api-admin'),
    KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(16),
    /** The `acr` a step-up command requires (KTD20); the realm's `acr.loa.map` names its levels. */
    STEP_UP_ACR: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,64}$/)
      .default('step-up'),
    /** How recent the step-up's `auth_time` must be for a step-up command (KTD20). */
    STEP_UP_FRESHNESS_SECONDS: z.coerce.number().int().min(10).max(900).default(300),
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
    /** The region this deployment serves (R1); provisioning refuses a tenant of another region. */
    CELL_REGION: z.enum(regions),
    /** Each region's staff app origin, which the directory hands out; it must name this region. */
    DIRECTORY_REGION_URLS: regionUrls,
    /**
     * The API's organizations service account (KTD20, owner decision 2026-09-27): it creates a
     * tenant's organization at provisioning and adds and removes members, and nothing else uses
     * it. It holds `manage-realm`, which Keycloak requires for organizations; see
     * docs/runbooks/keycloak.md for its accepted scope.
     */
    KEYCLOAK_ORGANIZATIONS_CLIENT_ID: z.string().min(1).default('partledger-api-organizations'),
    KEYCLOAK_ORGANIZATIONS_CLIENT_SECRET: z.string().min(16),
    /** The separate realm operators sign in through, with a required second factor (KTD20, R4). */
    OPERATOR_KEYCLOAK_ISSUER: issuer,
    /** The client operators sign in with; operator access tokens must be issued to it. */
    OPERATOR_KEYCLOAK_CLIENT_ID: z.string().min(1).default('partledger-operator-console'),
    /** The audience operator access tokens must carry. */
    OPERATOR_KEYCLOAK_AUDIENCE: z.string().min(1).default('partledger-operator-api'),
    /** pg-boss connects as `pl_job_runner`, which reaches the job queue schema and nothing else (KTD16). */
    JOBS_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    JOBS_DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(5),
    /** `on` runs job handlers and fires schedules in this process; `off` only enqueues. */
    JOBS_WORKERS: z.enum(['on', 'off']).default('on'),
    /** The supplier portal's origin, which links in supplier emails open (KTD30, KTD33). */
    PORTAL_APP_ORIGIN: origin.default('http://127.0.0.1:5174'),
    /**
     * The email port's adapter (KTD36). `local` writes each email as a file to a dev inbox and
     * sends nothing, so production refuses it and must name its adapter; the production
     * provider's adapter, processing in the tenant's region, arrives with U24. Unset means
     * `local` outside production.
     */
    EMAIL_ADAPTER: z.enum(['local']).optional(),
    /** Where the local adapter writes emails, one JSON file per notification. */
    EMAIL_LOCAL_INBOX_DIRECTORY: z.string().min(1).default('local-dev/email-inbox'),
    /** The sender of every notification email. */
    EMAIL_FROM_ADDRESS: z.email().default('notifications@partledger.invalid'),
    /**
     * The platform operator's address that receives a tenant's operational alerts while the
     * tenant has configured no alert recipient, so an alert always reaches a person (KTD41).
     * Required in production.
     */
    OPERATIONAL_ALERT_FALLBACK_EMAIL: z.email().optional(),
    /**
     * The key service's adapter (KTD36). `local` keeps its keys in process memory, so production
     * refuses it and must use the region's OVHcloud KMS. Unset means `local` outside production.
     */
    KEY_SERVICE_ADAPTER: z.enum(['local', 'ovh_kms']).optional(),
    /** The local adapter's key-encryption key, 32 bytes base64; unset gives each process its own. */
    LOCAL_KEY_SERVICE_KEY: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/, 'must be 32 bytes, base64-encoded')
      .transform((key) => Buffer.from(key, 'base64'))
      .optional(),
    /** The region's OVHcloud KMS, such as `https://ca-east-bhs.okms.ovh.net`. */
    OVH_KMS_ENDPOINT: z
      .string()
      .regex(/^https:\/\/[a-z0-9-]+\.okms\.ovh\.net$/, 'must be an https://<region>.okms.ovh.net origin')
      .optional(),
    OVH_KMS_ID: z.uuid().optional(),
    /** The symmetric service key that wraps data keys. */
    OVH_KMS_ENCRYPTION_KEY_ID: z.uuid().optional(),
    /** The ECDSA P-256 service key that signs chain checkpoints (U21). */
    OVH_KMS_SIGNING_KEY_ID: z.uuid().optional(),
    /** Files holding the KMS domain's mutual-TLS client certificate and key, from the secret store. */
    OVH_KMS_CLIENT_CERTIFICATE_FILE: z.string().min(1).optional(),
    OVH_KMS_CLIENT_KEY_FILE: z.string().min(1).optional(),
    /**
     * The AI worker's connection (KTD17, R31): `pl_ai_worker`, which can only insert suggestions
     * and append their audit entries. Unset, no AI suggestion can be stored; production requires it.
     */
    AI_WORKER_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    AI_WORKER_DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(2),
    /**
     * The platform default AI provider (R30, KTD25). `none` switches AI off; `local` is a
     * deterministic development adapter that sends nothing, so production refuses it. Unset
     * means `local` outside production.
     */
    AI_PLATFORM_PROVIDER: z.enum(['none', 'local', 'anthropic', 'openai', 'azure_openai', 'mistral']).optional(),
    /** The platform model or Azure deployment, lowercase, such as `claude-sonnet-4-5`. */
    AI_PLATFORM_MODEL: z.string().min(1).max(100).optional(),
    /** The platform provider's API key, from the secret store. */
    AI_PLATFORM_API_KEY: z.string().min(16).max(512).optional(),
    /** Azure OpenAI only: the resource name, never a URL. */
    AI_PLATFORM_AZURE_RESOURCE_NAME: z.string().min(1).max(64).optional(),
    /** OpenAI: `us` or `eu`, its data-residency endpoint. Azure OpenAI: the resource's Azure region. */
    AI_PLATFORM_ENDPOINT_REGION: z.string().min(1).max(40).optional(),
    /** How long one AI call may take before it is abandoned. */
    AI_CALL_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(120),
    /**
     * The object storage port's adapter (KTD36). `local` keeps objects as files under
     * `STORAGE_LOCAL_DIRECTORY`, for development only, so production refuses it and must name
     * `s3`: the region's S3-compatible object storage (OVHcloud in Canada). Unset means `local`
     * outside production.
     */
    STORAGE_ADAPTER: z.enum(['local', 's3']).optional(),
    STORAGE_LOCAL_DIRECTORY: z.string().min(1).default('local-dev/object-storage'),
    /** Where uploads wait for their scan; nothing in it is ever served (KTD22). */
    STORAGE_QUARANTINE_BUCKET: bucketName.default('partledger-quarantine'),
    /** Clean evidence and staff documents. */
    STORAGE_EVIDENCE_BUCKET: bucketName.default('partledger-evidence'),
    /** Clean import and drop files, deleted once their import commits or is discarded; never Object Lock. */
    STORAGE_IMPORTS_BUCKET: bucketName.default('partledger-imports'),
    /** The region's S3 endpoint, such as `https://s3.bhs.io.cloud.ovh.net`. */
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    S3_REGION: z.string().min(1).default('bhs'),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    /** Set per environment from the secret store. */
    S3_SECRET_ACCESS_KEY: z.string().min(8).optional(),
    /** `on` addresses buckets by path rather than by host name, as most self-hosted stores need. */
    S3_FORCE_PATH_STYLE: z.enum(['on', 'off']).default('off'),
    /**
     * The malware scanner port's adapter (KTD22, KTD36). `local` flags only the EICAR test
     * file and passes everything else, for development only, so production refuses it and must
     * name `clamd`, which runs in the region on the private network. Unset means `local`
     * outside production.
     */
    MALWARE_SCANNER: z.enum(['local', 'clamd']).optional(),
    CLAMD_HOST: z.string().min(1).optional(),
    CLAMD_PORT: port.default(3310),
    /** How long one scan may take before the scanner counts as unavailable and the file stays pending. */
    CLAMD_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(600).default(60),
    /** How many files, and how many bytes, one supplier link may upload over its lifetime (KTD21). */
    UPLOAD_LINK_QUOTA_FILES: z.coerce.number().int().min(1).max(10_000).default(25),
    UPLOAD_LINK_QUOTA_BYTES: byteCount.default(250 * 1024 * 1024),
    /** How many files, and how many bytes, one tenant may upload in any 24 hours. */
    UPLOAD_TENANT_DAILY_QUOTA_FILES: z.coerce.number().int().min(1).max(1_000_000).default(2_000),
    UPLOAD_TENANT_DAILY_QUOTA_BYTES: byteCount.default(4 * 1024 * 1024 * 1024),
  })
  .superRefine((config, context) => {
    const seen = new Set<number>();
    for (const name of listenerPorts) {
      if (seen.has(config[name])) {
        context.addIssue({ code: 'custom', path: [name], message: 'must differ from the other listener ports' });
      }
      seen.add(config[name]);
    }
    if (config.DIRECTORY_REGION_URLS[config.CELL_REGION] === undefined) {
      context.addIssue({ code: 'custom', path: ['DIRECTORY_REGION_URLS'], message: 'must name CELL_REGION' });
    }
    if (config.KEY_SERVICE_ADAPTER === 'ovh_kms') {
      for (const name of kmsSettings) {
        if (config[name] === undefined) {
          context.addIssue({ code: 'custom', path: [name], message: 'is required by the ovh_kms key service adapter' });
        }
      }
    }
    const aiProvider = config.AI_PLATFORM_PROVIDER;
    if (aiProvider !== undefined && aiProvider !== 'none' && aiProvider !== 'local') {
      const required: (keyof typeof config)[] = ['AI_PLATFORM_MODEL', 'AI_PLATFORM_API_KEY'];
      if (aiProvider === 'azure_openai') {
        required.push('AI_PLATFORM_AZURE_RESOURCE_NAME');
      }
      if (aiProvider === 'openai' || aiProvider === 'azure_openai') {
        required.push('AI_PLATFORM_ENDPOINT_REGION');
      }
      for (const name of required) {
        if (config[name] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [name],
            message: `is required by AI_PLATFORM_PROVIDER=${aiProvider}`,
          });
        }
      }
    }
    if (config.NODE_ENV === 'production') {
      for (const name of [
        'STAFF_APP_ORIGIN',
        'PORTAL_APP_ORIGIN',
        'KEYCLOAK_ISSUER',
        'OPERATOR_KEYCLOAK_ISSUER',
      ] as const) {
        if (!config[name].startsWith('https://')) {
          context.addIssue({ code: 'custom', path: [name], message: 'must use https in production' });
        }
      }
      if (config.EMAIL_ADAPTER === undefined || nonSendingEmailAdapters.has(config.EMAIL_ADAPTER)) {
        context.addIssue({
          code: 'custom',
          path: ['EMAIL_ADAPTER'],
          message: 'must name a sending adapter in production; local sends nothing',
        });
      }
      if (config.OPERATIONAL_ALERT_FALLBACK_EMAIL === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['OPERATIONAL_ALERT_FALLBACK_EMAIL'],
          message: 'is required in production',
        });
      }
      if (Object.values(config.DIRECTORY_REGION_URLS).some((url) => !url.startsWith('https://'))) {
        context.addIssue({ code: 'custom', path: ['DIRECTORY_REGION_URLS'], message: 'must use https in production' });
      }
      if (config.KEY_SERVICE_ADAPTER !== 'ovh_kms') {
        context.addIssue({
          code: 'custom',
          path: ['KEY_SERVICE_ADAPTER'],
          message: 'must be ovh_kms in production; local keeps keys in memory',
        });
      }
      if (config.AI_PLATFORM_PROVIDER === undefined || config.AI_PLATFORM_PROVIDER === 'local') {
        context.addIssue({
          code: 'custom',
          path: ['AI_PLATFORM_PROVIDER'],
          message: 'must name a provider, or none, in production; local is a development adapter',
        });
      }
      if (config.AI_WORKER_DATABASE_URL === undefined) {
        context.addIssue({ code: 'custom', path: ['AI_WORKER_DATABASE_URL'], message: 'is required in production' });
      }
      if (config.STORAGE_ADAPTER !== 's3') {
        context.addIssue({
          code: 'custom',
          path: ['STORAGE_ADAPTER'],
          message: 'must be s3 in production; local keeps files on this machine',
        });
      }
      if (config.MALWARE_SCANNER !== 'clamd') {
        context.addIssue({
          code: 'custom',
          path: ['MALWARE_SCANNER'],
          message: 'must be clamd in production; local scans for nothing but the test file',
        });
      }
    }
    if (config.STORAGE_ADAPTER === 's3') {
      for (const name of ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (config[name] === undefined) {
          context.addIssue({ code: 'custom', path: [name], message: 'is required with STORAGE_ADAPTER=s3' });
        }
      }
      if (config.NODE_ENV === 'production' && config.S3_ENDPOINT?.startsWith('https://') === false) {
        context.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'must use https in production' });
      }
    }
    if (config.MALWARE_SCANNER === 'clamd' && config.CLAMD_HOST === undefined) {
      context.addIssue({ code: 'custom', path: ['CLAMD_HOST'], message: 'is required with MALWARE_SCANNER=clamd' });
    }
    const buckets = [config.STORAGE_QUARANTINE_BUCKET, config.STORAGE_EVIDENCE_BUCKET, config.STORAGE_IMPORTS_BUCKET];
    if (new Set(buckets).size !== buckets.length) {
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_QUARANTINE_BUCKET'],
        message: 'quarantine, evidence and imports need three different buckets',
      });
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
