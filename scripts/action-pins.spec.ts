import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findUnpinnedActions } from './action-pins.ts';

const digest = '08c6903cd8c0fde910a37f88322edcfb5dd907a8';

describe('workflow action pins', () => {
  it('accepts actions pinned by commit digest and local actions', () => {
    const workflow = `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${digest} # v5.0.0\n      - uses: ./.github/actions/local\n`;
    expect(findUnpinnedActions('ci.yml', workflow)).toEqual([]);
  });

  it('reports an action referenced by tag', () => {
    const workflow = 'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v5\n';
    expect(findUnpinnedActions('ci.yml', workflow)).toEqual([{ file: 'ci.yml', uses: 'actions/checkout@v5' }]);
  });

  it('reports a reusable workflow referenced by branch', () => {
    const workflow = 'jobs:\n  a:\n    uses: octo/repo/.github/workflows/x.yml@main\n';
    expect(findUnpinnedActions('ci.yml', workflow)).toHaveLength(1);
  });

  it('makes the check script fail when a workflow uses a tag', () => {
    const root = mkdtempSync(join(tmpdir(), 'pins-'));
    cpSync(join(import.meta.dirname), join(root, 'scripts'), { recursive: true });
    symlinkSync(join(import.meta.dirname, '..', 'node_modules'), join(root, 'node_modules'));
    cpSync(join(import.meta.dirname, '..', '.github'), join(root, '.github'), { recursive: true });
    const script = join(root, 'scripts', 'check-action-pins.ts');
    expect(() => execFileSync(process.execPath, [script], { stdio: 'pipe' })).not.toThrow();
    writeFileSync(
      join(root, '.github', 'workflows', 'bad.yml'),
      'jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v4\n',
    );
    expect(() => execFileSync(process.execPath, [script], { stdio: 'pipe' })).toThrow();
  });
});
