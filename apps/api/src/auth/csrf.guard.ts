import type { IncomingMessage } from 'node:http';

import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { staffRequestHeader } from '@partledger/contracts';
import { domainError } from '@partledger/domain';

import { DomainFailure } from '../http/failures';
import type { HttpEntryAdapter } from '../listeners/entry-adapters';
import { entryAdapterOf } from '../listeners/listeners';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Whether a request may change state on its listener (KTD20). The staff listener
 * authenticates by cookie, which a browser attaches to requests other sites trigger, so every
 * state-changing request there must carry the staff app's request header; a cross-site form
 * cannot add a header, and a cross-site script cannot without a CORS preflight the API never
 * grants. The other listeners take credentials the browser never attaches on its own; a
 * request no listener tagged is treated like a staff request.
 */
export function passesCrossSiteCheck(request: IncomingMessage, adapter: HttpEntryAdapter | undefined): boolean {
  if ((adapter !== undefined && adapter !== 'staff') || safeMethods.has(request.method ?? '')) {
    return true;
  }
  return request.headers[staffRequestHeader.name] === staffRequestHeader.value;
}

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<IncomingMessage>();
    if (!passesCrossSiteCheck(request, entryAdapterOf(request))) {
      throw new DomainFailure(domainError('Forbidden', 'crossSiteRequest'));
    }
    return true;
  }
}
