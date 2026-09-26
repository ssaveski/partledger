import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const root = join(import.meta.dirname, '..');
const rootPackage = z
  .object({ packageManager: z.string() })
  .parse(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
const workspaceSettings = z
  .object({
    strictDepBuilds: z.literal(true),
    minimumReleaseAge: z.number().positive(),
    allowBuilds: z.record(z.string(), z.boolean()),
  })
  .loose()
  .parse(parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')));

/** Installs one dependency in a scratch project that carries the repository's supply-chain settings. */
function installWithRepositorySettings(
  dependency: string,
  version: string,
  extraAllowBuilds: Readonly<Record<string, boolean>> = {},
): { status: number | null; output: string } {
  const directory = mkdtempSync(join(tmpdir(), 'supply-chain-'));
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'probe',
      private: true,
      packageManager: rootPackage.packageManager,
      dependencies: { [dependency]: version },
    }),
  );
  writeFileSync(
    join(directory, 'pnpm-workspace.yaml'),
    stringify({
      ...workspaceSettings,
      allowBuilds: { ...workspaceSettings.allowBuilds, ...extraAllowBuilds },
      packages: [],
    }),
  );
  const result = spawnSync('pnpm', ['install'], { cwd: directory, encoding: 'utf8', timeout: 150_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('dependency supply-chain policy', () => {
  it('fails an install whose dependency runs a build script that is not allowlisted', () => {
    expect(Object.keys(workspaceSettings.allowBuilds)).not.toContain('core-js');
    const result = installWithRepositorySettings('core-js', '3.38.1');
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/IGNORED_BUILDS/);
  });

  it('installs the same dependency once its build script is allowlisted', () => {
    expect(installWithRepositorySettings('core-js', '3.38.1', { 'core-js': true }).status).toBe(0);
  });

  it('installs a version older than the minimum release age', () => {
    expect(installWithRepositorySettings('typescript', '5.9.3').status).toBe(0);
  });

  it('fails an install of a version younger than the minimum release age', async () => {
    const tagsResponse = await fetch('https://registry.npmjs.org/-/package/typescript/dist-tags');
    const tags = z
      .object({ next: z.string() })
      .loose()
      .parse(await tagsResponse.json());
    // The nightly tag is republished every day, so it is always younger than the minimum age.
    const result = installWithRepositorySettings('typescript', tags.next);
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/minimumReleaseAge/);
  });
});
