import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');

async function ruleIdsFor(relativePath: string, source: string): Promise<(string | null)[]> {
  const path = join(root, relativePath);
  writeFileSync(path, source);
  try {
    const eslint = new ESLint({ cwd: root });
    const [result] = await eslint.lintFiles([path]);
    return result?.messages.map((message) => message.ruleId) ?? [];
  } finally {
    rmSync(path, { force: true });
  }
}

describe('workspace lint rules', () => {
  beforeAll(() => {
    execFileSync('pnpm', ['exec', 'nx', 'show', 'projects'], { cwd: root, stdio: 'pipe' });
  });

  it('refuses an import from apps/api inside apps/web by package name', async () => {
    const rules = await ruleIdsFor(
      'apps/web/src/lint-probe-api.ts',
      "import { apiPrefix } from '@partledger/api/src/bootstrap';\nexport const probe = apiPrefix;\n",
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('refuses an import from apps/api inside apps/web by relative path', async () => {
    const rules = await ruleIdsFor(
      'apps/web/src/lint-probe-api-relative.ts',
      "import { apiPrefix } from '../../api/src/bootstrap';\nexport const probe = apiPrefix;\n",
    );
    expect(rules).toContain('@nx/enforce-module-boundaries');
  });

  it('refuses an import from an API-only library inside apps/web', async () => {
    const rules = await ruleIdsFor('apps/web/src/lint-probe-db.ts', "export * from '@partledger/db';\n");
    expect(rules).toContain('@nx/enforce-module-boundaries');
  });

  it('refuses an import from libs/domain inside apps/verifier', async () => {
    const rules = await ruleIdsFor('apps/verifier/src/lint-probe-domain.ts', "export * from '@partledger/domain';\n");
    expect(rules).toContain('@nx/enforce-module-boundaries');
  });

  it('allows the verifier to import libs/chain', async () => {
    const rules = await ruleIdsFor('apps/verifier/src/lint-probe-chain.ts', "export * from '@partledger/chain';\n");
    expect(rules).not.toContain('@nx/enforce-module-boundaries');
  });

  it('refuses a literal user-facing string in a component', async () => {
    const rules = await ruleIdsFor(
      'apps/web/src/lint-probe-literal.tsx',
      'export function Probe() {\n  return <p>Hello there</p>;\n}\n',
    );
    expect(rules).toContain('partledger/no-literal-ui-strings');
  });

  it('refuses a literal aria-label in a component', async () => {
    const rules = await ruleIdsFor(
      'libs/ui/src/lint-probe-label.tsx',
      'export function Probe() {\n  return <button type="button" aria-label="Close" />;\n}\n',
    );
    expect(rules).toContain('partledger/no-literal-ui-strings');
  });

  it('accepts text that comes from a translation key', async () => {
    const rules = await ruleIdsFor(
      'apps/portal/src/lint-probe-key.tsx',
      "import { translate } from '@partledger/contracts';\n\nexport function Probe() {\n  return <p title={translate('pl.common.appName')}>{translate('pl.common.appName')}</p>;\n}\n",
    );
    expect(rules).toEqual([]);
  });

  it('refuses an `as` cast', async () => {
    const rules = await ruleIdsFor(
      'libs/domain/src/lint-probe-cast.ts',
      'const value: unknown = 1;\nexport const probe = value as number;\n',
    );
    expect(rules).toContain('@typescript-eslint/consistent-type-assertions');
  });

  it('refuses process.env outside the API config module', async () => {
    const rules = await ruleIdsFor('apps/api/src/lint-probe-env.ts', 'export const port = process.env.PORT;\n');
    expect(rules).toContain('no-restricted-properties');
  });
});
