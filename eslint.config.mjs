import js from '@eslint/js';
import nx from '@nx/eslint-plugin';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { partledgerPlugin } from './tools/eslint/no-literal-ui-strings.mjs';

// Full words in names (CLAUDE.md): `context`, not `ctx`.
const abbreviations = [
  'ctx',
  'req',
  'res',
  'err',
  'cb',
  'e',
  'evt',
  'msg',
  'tmp',
  'val',
  'obj',
  'arr',
  'str',
  'num',
  'cfg',
  'conf',
  'env',
  'db',
  'tx',
  'idx',
  'btn',
  'el',
  'fn',
];

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '.nx/**', 'playwright-report/**', 'test-results/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', 'tools/eslint/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { '@nx': nx, partledger: partledgerPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'id-denylist': ['error', ...abbreviations],
      // Apps are never imported; Nx cannot resolve an app's package name, so this backs up the boundary rule.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@partledger/(api|web|portal|verifier)(/|$)',
              message: 'Apps are not importable; share code through a library.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'env', message: 'Read configuration through apps/api/src/config only.' },
      ],
      '@nx/enforce-module-boundaries': [
        'error',
        {
          allow: [],
          enforceBuildableLibDependency: false,
          depConstraints: [
            { sourceTag: 'type:lib', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: 'scope:api', onlyDependOnLibsWithTags: ['scope:api', 'scope:shared', 'scope:chain'] },
            { sourceTag: 'scope:frontend', onlyDependOnLibsWithTags: ['scope:frontend', 'scope:shared'] },
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
            { sourceTag: 'scope:chain', onlyDependOnLibsWithTags: ['scope:chain'] },
            { sourceTag: 'scope:verifier', onlyDependOnLibsWithTags: ['scope:chain'] },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/config/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['apps/web/**/*.tsx', 'apps/portal/**/*.tsx', 'libs/ui/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } },
    rules: { 'partledger/no-literal-ui-strings': 'error' },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.e2e-spec.ts', '**/e2e/**'],
    rules: { 'partledger/no-literal-ui-strings': 'off' },
  },
  {
    files: ['**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
