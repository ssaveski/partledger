import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The database lets ERP-owned master data change only in a transaction that names itself the
 * ERP import (migration 0023). Only the import path may do that, so no other application code
 * may even name the setting. Test fixtures, outside `src`, stand in for the import.
 */
const repositoryRoot = join(import.meta.dirname, '..', '..', '..');
const importPath = 'apps/api/src/imports/';
const setting = ['app', 'master_data_writer'].join('.');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : sourceFiles(path);
    }
    return /\.(ts|tsx|js|mjs|sql)$/.test(entry.name) ? [path] : [];
  });
}

function applicationSources(): string[] {
  return ['apps', 'libs'].flatMap((group) =>
    readdirSync(join(repositoryRoot, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const source = join(repositoryRoot, group, entry.name, 'src');
        try {
          return sourceFiles(source);
        } catch {
          return [];
        }
      }),
  );
}

describe('the ERP import writer setting', () => {
  it('is named by no application code outside the import path', () => {
    const offenders = applicationSources()
      .map((path) => relative(repositoryRoot, path).replaceAll('\\', '/'))
      .filter((path) => !path.startsWith(importPath) && path !== 'apps/api/src/master-data-writer.spec.ts')
      .filter((path) => readFileSync(join(repositoryRoot, path), 'utf8').includes(setting));
    expect(offenders).toEqual([]);
  });

  it('finds application sources to check', () => {
    expect(applicationSources().length).toBeGreaterThan(100);
  });
});
