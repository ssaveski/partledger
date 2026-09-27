import { createPublicKey } from 'node:crypto';
import { request } from 'node:https';

import { failure, success, type Result } from '@partledger/domain';
import { z } from 'zod';

import { openWithKey, sealWithKey } from './envelope';
import {
  associatedDataOf,
  type EncryptionContext,
  type KeyService,
  type KeyServiceFailure,
  type KeySignature,
  type SealedEnvelope,
  type SigningPublicKey,
} from './key-service.port';

/**
 * The key service's OVHcloud KMS adapter (KTD36, KTD18), over the KMS REST API with the
 * region's mutual-TLS client certificate. The KMS wraps each data key with the region's
 * symmetric service key, so the key-encryption key never leaves the KMS, and signs with the
 * region's ECDSA P-256 service key. The data key encrypts locally with AES-256-GCM, bound to the
 * value's context. Every call goes to the one configured KMS endpoint; nothing else.
 */

/** A KMS endpoint, such as `https://ca-east-bhs.okms.ovh.net`; never a free-form URL. */
export const ovhKmsEndpointPattern = /^https:\/\/[a-z0-9-]+\.okms\.ovh\.net$/;

export interface KmsResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Sends one request to the KMS; resolves with its status and parsed body, rejects when unreachable. */
export interface KmsTransport {
  send(method: 'GET' | 'POST', path: string, body: unknown): Promise<KmsResponse>;
}

export interface OvhKmsOptions {
  /** The KMS domain's id. */
  readonly kmsId: string;
  /** The symmetric service key that wraps data keys. */
  readonly encryptionKeyId: string;
  /** The ECDSA P-256 service key that signs. */
  readonly signingKeyId: string;
  readonly transport: KmsTransport;
}

const refusedStatuses: ReadonlySet<number> = new Set([400, 404, 422]);

const base64 = z.string().regex(/^[A-Za-z0-9+/_-]+=*$/);
const dataKeyResponse = z.object({ key: z.string().min(1).max(4096), plaintext: base64 });
const plaintextResponse = z.object({ plaintext: base64 });
const signatureResponse = z.object({ signature: base64 });
const publicJwk = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: base64, y: base64 });
const publicKeyResponse = z.object({ keys: z.tuple([publicJwk], publicJwk) });

function decodeBase64(value: string): Buffer {
  return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}

export class OvhKmsAdapter implements KeyService {
  constructor(private readonly options: OvhKmsOptions) {}

  private path(keyId: string, action: string): string {
    return `/api/${this.options.kmsId}/v1/servicekey/${keyId}${action}`;
  }

  private async call<Schema extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    schema: Schema,
  ): Promise<Result<z.output<Schema>, 'unavailable' | 'refused'>> {
    let response: KmsResponse;
    try {
      response = await this.options.transport.send(method, path, body);
    } catch {
      return failure('unavailable');
    }
    // Only a refusal of the request itself is final. A refused client certificate (401, 403), a
    // timeout (408) or throttling (429) is an outage: the value may well decrypt later.
    if (refusedStatuses.has(response.status)) {
      return failure('refused');
    }
    const parsed = schema.safeParse(response.body);
    return response.status === 200 && parsed.success ? success(parsed.data) : failure('unavailable');
  }

  async encrypt(plaintext: Buffer, context: EncryptionContext): Promise<Result<SealedEnvelope, 'unavailable'>> {
    const keyId = this.options.encryptionKeyId;
    const generated = await this.call(
      'POST',
      this.path(keyId, '/datakey'),
      { name: context.purpose, size: 256 },
      dataKeyResponse,
    );
    if (!generated.ok) {
      return failure('unavailable');
    }
    const dataKey = decodeBase64(generated.value.plaintext);
    if (dataKey.length !== 32) {
      dataKey.fill(0);
      return failure('unavailable');
    }
    const ciphertext = sealWithKey(dataKey, plaintext, associatedDataOf(context));
    dataKey.fill(0);
    return success({ keyId, wrappedDataKey: Buffer.from(generated.value.key, 'utf8'), ciphertext });
  }

  async decrypt(envelope: SealedEnvelope, context: EncryptionContext): Promise<Result<Buffer, KeyServiceFailure>> {
    const unwrapped = await this.call(
      'POST',
      this.path(envelope.keyId, '/datakey/decrypt'),
      { key: envelope.wrappedDataKey.toString('utf8') },
      plaintextResponse,
    );
    if (!unwrapped.ok) {
      return failure(unwrapped.error === 'refused' ? 'undecryptable' : 'unavailable');
    }
    const dataKey = decodeBase64(unwrapped.value.plaintext);
    const plaintext = openWithKey(dataKey, envelope.ciphertext, associatedDataOf(context));
    dataKey.fill(0);
    return plaintext === null ? failure('undecryptable') : success(plaintext);
  }

  async sign(message: Buffer): Promise<Result<KeySignature, 'unavailable'>> {
    const keyId = this.options.signingKeyId;
    const signed = await this.call(
      'POST',
      this.path(keyId, '/sign'),
      { message: message.toString('base64'), alg: 'ES256', isdigest: false, format: 'raw' },
      signatureResponse,
    );
    if (!signed.ok) {
      return failure('unavailable');
    }
    const signature = decodeBase64(signed.value.signature);
    return signature.length === 64 ? success({ keyId, algorithm: 'ES256', signature }) : failure('unavailable');
  }

  async signingPublicKey(): Promise<Result<SigningPublicKey, 'unavailable'>> {
    const keyId = this.options.signingKeyId;
    const described = await this.call('GET', this.path(keyId, '?format=jwk'), undefined, publicKeyResponse);
    if (!described.ok) {
      return failure('unavailable');
    }
    const [jwk] = described.value.keys;
    try {
      const spki = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' }).export({
        format: 'der',
        type: 'spki',
      });
      return success({ keyId, algorithm: 'ES256', spki });
    } catch {
      return failure('unavailable');
    }
  }
}

export interface MutualTlsOptions {
  readonly endpoint: string;
  /** PEM client certificate and private key issued for the KMS domain. */
  readonly certificate: string;
  readonly privateKey: string;
  readonly timeoutMilliseconds: number;
}

function parseBody(text: string): unknown {
  try {
    return text === '' ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

/** The production transport: HTTPS with the client certificate, to the configured endpoint only. */
export function mutualTlsTransport(options: MutualTlsOptions): KmsTransport {
  if (!ovhKmsEndpointPattern.test(options.endpoint)) {
    throw new Error('The KMS endpoint must be an https://<region>.okms.ovh.net origin');
  }
  const origin = new URL(options.endpoint);
  return {
    send(method, path, body) {
      return new Promise((resolve, reject) => {
        const outgoing = request(
          {
            protocol: 'https:',
            hostname: origin.hostname,
            port: 443,
            method,
            path,
            cert: options.certificate,
            key: options.privateKey,
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            timeout: options.timeoutMilliseconds,
          },
          (incoming) => {
            const chunks: Buffer[] = [];
            incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
            incoming.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              resolve({ status: incoming.statusCode ?? 0, body: parseBody(text) });
            });
            incoming.on('error', reject);
          },
        );
        outgoing.on('timeout', () => outgoing.destroy(new Error('The KMS did not answer in time')));
        outgoing.on('error', reject);
        outgoing.end(body === undefined ? undefined : JSON.stringify(body));
      });
    },
  };
}
