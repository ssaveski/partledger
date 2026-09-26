import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';

import type { AppConfig } from '../config/env.schema';
import { httpEntryAdapters, type HttpEntryAdapter } from './entry-adapters';

export interface ListenerBinding {
  readonly host: string;
  /** 0 picks a free port, for tests. */
  readonly port: number;
}

export type ListenerBindings = Readonly<Record<HttpEntryAdapter, ListenerBinding>>;

export interface RunningListeners {
  /** Base URL of each listener, such as `http://127.0.0.1:3000`. */
  readonly urls: Readonly<Record<HttpEntryAdapter, string>>;
  close(): Promise<void>;
}

const adapterByRequest = new WeakMap<IncomingMessage, HttpEntryAdapter>();

/**
 * The listener a request arrived on, recorded by the server that accepted it; nothing the
 * client sends can change it. `undefined` for a request that no listener accepted.
 */
export function entryAdapterOf(request: IncomingMessage): HttpEntryAdapter | undefined {
  return adapterByRequest.get(request);
}

export function listenerBindingsFrom(config: AppConfig): ListenerBindings {
  return {
    staff: { host: config.HOST, port: config.STAFF_PORT },
    portal: { host: config.HOST, port: config.PORTAL_PORT },
    drop: { host: config.HOST, port: config.DROP_PORT },
    operator: { host: config.OPERATOR_HOST, port: config.OPERATOR_PORT },
  };
}

/**
 * One HTTP server per entry adapter (KTD30), all serving the same initialised application.
 * Each server tags its requests with its adapter before the application sees them.
 */
export async function startListeners(app: INestApplication, bindings: ListenerBindings): Promise<RunningListeners> {
  const httpAdapter = app.getHttpAdapter();
  if (!(httpAdapter instanceof ExpressAdapter)) {
    throw new Error('The API runs on the Express adapter');
  }
  const handler = httpAdapter.getInstance<RequestListener>();
  const servers: Server[] = [];
  const urls: Partial<Record<HttpEntryAdapter, string>> = {};
  try {
    for (const adapter of httpEntryAdapters) {
      const server = createServer((request, response) => {
        adapterByRequest.set(request, adapter);
        handler(request, response);
      });
      servers.push(server);
      urls[adapter] = await listen(server, bindings[adapter]);
    }
  } catch (error) {
    await Promise.all(servers.map(closeServer));
    throw error;
  }
  const { staff, portal, drop, operator } = urls;
  if (staff === undefined || portal === undefined || drop === undefined || operator === undefined) {
    throw new Error('A listener did not start');
  }
  return {
    urls: { staff, portal, drop, operator },
    async close() {
      await Promise.all(servers.map(closeServer));
    },
  };
}

function listen(server: Server, binding: ListenerBinding): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(binding.port, binding.host, () => {
      server.off('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('The listener has no TCP address'));
        return;
      }
      const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
      resolve(`http://${host}:${address.port}`);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => {
      resolve();
    });
    server.closeAllConnections();
  });
}
