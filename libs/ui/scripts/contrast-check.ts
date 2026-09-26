import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contrastPairs, themeNames } from '../src/tokens/themes.ts';
import { runContrastCheck } from './contrast.ts';

const css = readFileSync(join(import.meta.dirname, '..', 'src', 'tokens', 'tokens.css'), 'utf8');
const problems = runContrastCheck(css);
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem);
  }
  process.exitCode = 1;
} else {
  console.log(`${contrastPairs.length} colour pairs meet their contrast threshold in ${themeNames.join(' and ')}.`);
}
