import { randomBytes } from 'node:crypto';
import { connect, createServer } from 'node:net';
import { join } from 'node:path';

import { CreateBucketCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

/**
 * The upload pipeline's regional services for integration tests (U14): the shipped clamd
 * configuration on the pinned ClamAV image, and a local S3-compatible store. Both images are
 * pinned by digest (KTD41); MinIO no longer publishes images, so the store is VersityGW.
 */

/** ClamAV 1.4 LTS with its signature databases built in, as infra/compose/clamd/compose.yaml runs it. */
export const clamdImage = 'clamav/clamav:1.4@sha256:a5f03c12a79dbe9f6d8a527b6bb1ea053fa8dd061d3738a26897f055ee2d9303';

/** VersityGW: an S3 gateway over a local directory, standing in for OVHcloud Object Storage. */
export const objectStoreImage =
  'versity/versitygw:v1.0.16@sha256:605de57c0cdc297fc5bc905ece592965d542d8df70d6eedf755734c80f2eb797';

export const clamdConfig = join(import.meta.dirname, '..', '..', '..', '..', 'infra', 'compose', 'clamd', 'clamd.conf');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/** Whether clamd answers `PING` with `PONG`. */
function pong(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let reply = '';
    socket.setTimeout(2_000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.on('data', (data: Buffer) => {
      reply += data.toString('latin1');
    });
    socket.on('close', () => {
      resolve(reply.startsWith('PONG'));
    });
    socket.on('connect', () => {
      socket.end('zPING\0');
    });
  });
}

export interface StartedClamd {
  readonly host: string;
  /** Fixed for the container's life, so a restarted clamd answers where the API already points. */
  readonly port: number;
  /** Stops the container, keeping it, as an outage would. */
  stop(): Promise<void>;
  /** Starts the stopped container again and waits until clamd answers. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export async function startClamd(): Promise<StartedClamd> {
  const port = await freePort();
  const container: StartedTestContainer = await new GenericContainer(clamdImage)
    // The built-in signatures are enough; tests never reach the update servers.
    .withEnvironment({ CLAMAV_NO_FRESHCLAMD: 'true' })
    .withCopyFilesToContainer([{ source: clamdConfig, target: '/etc/clamav/clamd.conf' }])
    .withExposedPorts({ container: 3310, host: port })
    .withWaitStrategy(Wait.forLogMessage('socket found, clamd started'))
    .withStartupTimeout(300_000)
    .start();
  const host = '127.0.0.1';
  return {
    host,
    port,
    async stop() {
      await container.stop({ remove: false, timeout: 5_000 });
    },
    async restart() {
      await container.restart();
      const deadline = Date.now() + 300_000;
      while (!(await pong(host, port))) {
        if (Date.now() > deadline) {
          throw new Error('clamd did not answer after its restart');
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    },
    async close() {
      await container.stop();
    },
  };
}

/** OVHcloud's Beauharnois region name, which the API's configuration defaults to. */
export const objectStoreRegion = 'bhs';

export interface StartedObjectStore {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly buckets: { readonly quarantine: string; readonly evidence: string; readonly imports: string };
  /** The keys stored under a prefix of a bucket. */
  keys(bucket: string, prefix: string): Promise<string[]>;
  exists(bucket: string, key: string): Promise<boolean>;
  close(): Promise<void>;
}

export async function startObjectStore(): Promise<StartedObjectStore> {
  const accessKeyId = `synthetic${randomBytes(6).toString('hex')}`;
  const secretAccessKey = randomBytes(24).toString('base64url');
  const container = await new GenericContainer(objectStoreImage)
    .withEnvironment({
      ROOT_ACCESS_KEY_ID: accessKeyId,
      ROOT_SECRET_ACCESS_KEY: secretAccessKey,
      VGW_REGION: objectStoreRegion,
    })
    .withTmpFs({ '/data': 'rw' })
    .withCommand(['posix', '/data'])
    .withExposedPorts(7070)
    .withWaitStrategy(Wait.forLogMessage('Admin/S3 service listening on'))
    .withStartupTimeout(120_000)
    .start();
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(7070)}`;
  const client = new S3Client({
    endpoint,
    region: objectStoreRegion,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  const buckets = { quarantine: 'test-quarantine', evidence: 'test-evidence', imports: 'test-imports' };
  for (const bucket of Object.values(buckets)) {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    buckets,
    async keys(bucket, prefix) {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
      return (listed.Contents ?? []).flatMap((object) => (object.Key === undefined ? [] : [object.Key]));
    },
    async exists(bucket, key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      client.destroy();
      await container.stop();
    },
  };
}
