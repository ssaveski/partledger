import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');

// Probes are linted in memory, never written into the tree; the type-aware rules
// need files on disk, and none of the rules under test are type-aware.
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    tseslint.configs.disableTypeChecked,
    { languageOptions: { parserOptions: { projectService: false, project: null } } },
  ],
});

async function ruleIdsFor(relativePath: string, source: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(source, { filePath: join(root, relativePath) });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

const component = (body: string) => `export function Probe(props: { ok: boolean }) {\n  return ${body};\n}\n`;

describe('workspace lint rules', () => {
  beforeAll(() => {
    execFileSync('pnpm', ['exec', 'nx', 'show', 'projects'], { cwd: root, stdio: 'pipe' });
  });

  describe('module boundaries', () => {
    it('refuses an import from apps/api inside apps/web by package name', async () => {
      const rules = await ruleIdsFor(
        'apps/web/src/lint-probe.ts',
        "import { apiPrefix } from '@partledger/api/src/bootstrap';\nexport const probe = apiPrefix;\n",
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('refuses an import from apps/api inside apps/web by relative path', async () => {
      const rules = await ruleIdsFor(
        'apps/web/src/lint-probe.ts',
        "import { apiPrefix } from '../../api/src/bootstrap';\nexport const probe = apiPrefix;\n",
      );
      expect(rules).toContain('@nx/enforce-module-boundaries');
    });

    it('refuses an import from an API-only library inside apps/web', async () => {
      const rules = await ruleIdsFor('apps/web/src/lint-probe.ts', "export * from '@partledger/db';\n");
      expect(rules).toContain('@nx/enforce-module-boundaries');
    });

    it('refuses an import from libs/domain inside apps/verifier', async () => {
      const rules = await ruleIdsFor('apps/verifier/src/lint-probe.ts', "export * from '@partledger/domain';\n");
      expect(rules).toContain('@nx/enforce-module-boundaries');
    });

    it('allows the verifier to import libs/chain', async () => {
      const rules = await ruleIdsFor('apps/verifier/src/lint-probe.ts', "export * from '@partledger/chain';\n");
      expect(rules).not.toContain('@nx/enforce-module-boundaries');
    });
  });

  describe('translation check', () => {
    it.each([
      ['plain JSX text', '<p>Hello there</p>'],
      ['a string in braces', "<p>{'Saved'}</p>"],
      ['a template literal in braces', '<p>{`Saved`}</p>'],
      ['a string in a conditional', "<p>{props.ok ? 'Saved' : 'Failed'}</p>"],
      ['a string after a logical and', "<p>{props.ok && 'Saved'}</p>"],
      ['a literal aria-label', '<button type="button" aria-label="Close" />'],
      ['a template literal aria-label', '<button type="button" aria-label={`Close`} />'],
      ['a conditional alt text', "<img src=\"/a.png\" alt={props.ok ? 'Saved' : 'Failed'} />"],
      ['a submit button value', '<input type="submit" value="Submit order" />'],
    ])('refuses %s in a component', async (_shape, jsx) => {
      expect(await ruleIdsFor('libs/ui/src/lint-probe.tsx', component(jsx))).toContain(
        'partledger/no-literal-ui-strings',
      );
    });

    it('accepts text that comes from a translation key', async () => {
      const rules = await ruleIdsFor(
        'apps/portal/src/lint-probe.tsx',
        "import { translate } from '@partledger/contracts';\n\n" +
          component("<p title={translate('pl.common.appName')}>{props.ok ? translate('pl.common.appName') : null}</p>"),
      );
      expect(rules).toEqual([]);
    });

    it('accepts a data value on a non-button input', async () => {
      const rules = await ruleIdsFor(
        'apps/web/src/lint-probe.tsx',
        component('<input type="hidden" value="erp" disabled={props.ok} />'),
      );
      expect(rules).toEqual([]);
    });
  });

  describe('engineering rules', () => {
    it('refuses an `as` cast', async () => {
      const rules = await ruleIdsFor(
        'libs/domain/src/lint-probe.ts',
        'const value: unknown = 1;\nexport const probe = value as number;\n',
      );
      expect(rules).toContain('@typescript-eslint/consistent-type-assertions');
    });

    it('refuses process.env outside the API config module', async () => {
      const rules = await ruleIdsFor('apps/api/src/lint-probe.ts', 'export const port = process.env.PORT;\n');
      expect(rules).toContain('no-restricted-properties');
    });

    it('refuses a renamed env import from node:process outside the API config module', async () => {
      const rules = await ruleIdsFor(
        'apps/api/src/lint-probe.ts',
        "import { env as environment } from 'node:process';\nexport const port = environment['PORT'];\n",
      );
      expect(rules).toContain('no-restricted-imports');
    });

    it('allows the API config module to read the environment', async () => {
      const rules = await ruleIdsFor(
        'apps/api/src/config/lint-probe.ts',
        "import { env as environment } from 'node:process';\nexport const port = environment['PORT'] ?? process.env.PORT;\n",
      );
      expect(rules).toEqual([]);
    });
  });
});
