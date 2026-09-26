import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  colourTokens,
  contrastPairs,
  minimumContrast,
  themeNames,
  themes,
  type ContrastKind,
  type ContrastPair,
  type Palette,
  type ThemeName,
} from '../src/tokens/themes.ts';

export interface ContrastFailure {
  readonly theme: ThemeName;
  readonly foreground: string;
  readonly background: string;
  readonly kind: ContrastKind;
  readonly ratio: number;
  readonly minimum: number;
}

function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`Colour ${hex} is not a six-digit hex colour`);
  }
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function linear(channel: number): number {
  const scaled = channel / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.2 relative luminance. */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

export function checkPalette(
  theme: ThemeName,
  palette: Palette,
  pairs: readonly ContrastPair[] = contrastPairs,
): ContrastFailure[] {
  return pairs.flatMap((pair) => {
    const ratio = contrastRatio(palette[pair.foreground], palette[pair.background]);
    const minimum = minimumContrast[pair.kind];
    return ratio < minimum
      ? [{ theme, foreground: pair.foreground, background: pair.background, kind: pair.kind, ratio, minimum }]
      : [];
  });
}

const themeSelectors: Readonly<Record<ThemeName, RegExp>> = {
  dark: /:root,\s*\[data-theme='dark'\]\s*\{([^}]*)\}/,
  light: /\[data-theme='light'\]\s*\{([^}]*)\}/,
};

function declaredVariables(block: string): Map<string, string> {
  const variables = new Map<string, string>();
  for (const match of block.matchAll(/--pl-([a-z-]+):\s*([^;]+);/g)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      variables.set(match[1], match[2].trim().toLowerCase());
    }
  }
  return variables;
}

/** Differences between the CSS variables in `tokens.css` and the palettes in `themes.ts`. */
export function findTokenDrift(css: string, palettes: Readonly<Record<ThemeName, Palette>> = themes): string[] {
  return themeNames.flatMap((theme) => {
    const block = themeSelectors[theme].exec(css)?.[1];
    if (block === undefined) {
      return [`${theme}: no theme block in tokens.css`];
    }
    const variables = declaredVariables(block);
    const palette = palettes[theme];
    const known = new Set<string>(colourTokens);
    return [
      ...colourTokens.flatMap((token) => {
        const declared = variables.get(token);
        const expected = palette[token].toLowerCase();
        return declared === expected
          ? []
          : [`${theme}: --pl-${token} is ${declared ?? 'missing'}, expected ${expected}`];
      }),
      ...[...variables.keys()]
        .filter((name) => !known.has(name))
        .map((name) => `${theme}: --pl-${name} is not a token in themes.ts`),
    ];
  });
}

export function runContrastCheck(css: string, palettes: Readonly<Record<ThemeName, Palette>> = themes): string[] {
  const failures = themeNames.flatMap((theme) => checkPalette(theme, palettes[theme]));
  return [
    ...findTokenDrift(css, palettes),
    ...failures.map(
      (failure) =>
        `${failure.theme}: ${failure.kind} ${failure.foreground} on ${failure.background} is ` +
        `${failure.ratio.toFixed(2)}:1, below ${failure.minimum}:1`,
    ),
  ];
}

if (import.meta.main) {
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
}
