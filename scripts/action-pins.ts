import { parse } from 'yaml';

export interface UnpinnedAction {
  readonly file: string;
  readonly uses: string;
}

const pinnedByDigest = /^[^@\s]+@[0-9a-f]{40}$/;

function collectUses(node: unknown, found: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectUses(item, found);
    }
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'uses' && typeof value === 'string') {
        found.push(value);
      } else {
        collectUses(value, found);
      }
    }
  }
}

/** Actions must be referenced by full commit digest (KTD41); local actions (`./`) are exempt. */
export function findUnpinnedActions(file: string, workflowSource: string): UnpinnedAction[] {
  const uses: string[] = [];
  collectUses(parse(workflowSource), uses);
  return uses
    .filter((reference) => !reference.startsWith('./') && !pinnedByDigest.test(reference))
    .map((reference) => ({ file, uses: reference }));
}
