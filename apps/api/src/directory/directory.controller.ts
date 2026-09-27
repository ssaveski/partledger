import type { IncomingMessage, ServerResponse } from 'node:http';

import { Controller, Get, Inject, NotFoundException, Param, Req, Res } from '@nestjs/common';
import { tenantSlugSchema, type DirectoryEntry, type TenantRegion } from '@partledger/contracts';
import { schema } from '@partledger/db';
import { domainError } from '@partledger/domain';
import { eq } from 'drizzle-orm';

import { appDatabase } from '../db/db.module';
import type { AppDatabase } from '../db/tenant-transaction';
import { DomainFailure } from '../http/failures';
import { entryAdapterOf } from '../listeners/listeners';

const { directoryEntries } = schema;

export const regionUrls = Symbol('RegionUrls');

export type RegionUrls = Readonly<Partial<Record<TenantRegion, string>>>;

/**
 * The directory (R1): `GET /api/v1/directory/<slug>` answers which region's staff app serves a
 * tenant, and nothing else about it, before anyone signs in. An unknown slug and a malformed
 * one get the same answer. Served on the staff listener only.
 *
 * In Release 1 the directory is cell-local: `directory_entries` lives in this region's
 * database, so it knows only this cell's tenants, and a slug is unique per cell, not across
 * regions. A global directory shared by every cell is a follow-up before a second region goes
 * live (docs/runbooks/keycloak.md).
 */
@Controller('directory')
export class DirectoryController {
  constructor(
    @Inject(appDatabase) private readonly database: AppDatabase,
    @Inject(regionUrls) private readonly urls: RegionUrls,
  ) {}

  @Get(':slug')
  async lookUp(
    @Param('slug') slug: string,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<DirectoryEntry> {
    if (entryAdapterOf(request) !== 'staff') {
      throw new NotFoundException();
    }
    response.setHeader('cache-control', 'no-store');
    const notFound = new DomainFailure(domainError('NotFound', 'resource'));
    const parsedSlug = tenantSlugSchema.safeParse(slug);
    if (!parsedSlug.success) {
      throw notFound;
    }
    // The directory is global: its rows belong to no tenant, so no tenant context is needed.
    const [entry] = await this.database
      .select({ region: directoryEntries.region })
      .from(directoryEntries)
      .where(eq(directoryEntries.slug, parsedSlug.data));
    const regionUrl = entry === undefined ? undefined : this.urls[entry.region];
    if (regionUrl === undefined) {
      throw notFound;
    }
    return { regionUrl };
  }
}
