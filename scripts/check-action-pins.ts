import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findUnpinnedActions } from './action-pins.ts';

const workflowDirectory = join(import.meta.dirname, '..', '.github', 'workflows');
const workflowFiles = readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/.test(name));
const unpinned = workflowFiles.flatMap((name) =>
  findUnpinnedActions(name, readFileSync(join(workflowDirectory, name), 'utf8')),
);

if (unpinned.length > 0) {
  for (const action of unpinned) {
    console.error(`${action.file}: action "${action.uses}" is not pinned by commit digest`);
  }
  process.exitCode = 1;
} else {
  console.log(`All actions in ${workflowFiles.length} workflow(s) are pinned by digest.`);
}
