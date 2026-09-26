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

interface ThemeBlock {
  readonly label: string;
  readonly theme: ThemeName;
  readonly pattern: RegExp;
}

// The last block paints the light theme for a light-scheme visitor before `data-theme` is set.
const themeBlocks: readonly ThemeBlock[] = [
  { label: 'dark', theme: 'dark', pattern: /:root,\s*\[data-theme='dark'\]\s*\{([^}]*)\}/ },
  { label: 'light', theme: 'light', pattern: /^\[data-theme='light'\]\s*\{([^}]*)\}/m },
  {
    label: 'light before a theme is set',
    theme: 'light',
    pattern: /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/,
  },
];

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
  const known = new Set<string>(colourTokens);
  return themeBlocks.flatMap(({ label, theme, pattern }) => {
    const block = pattern.exec(css)?.[1];
    if (block === undefined) {
      return [`${label}: no theme block in tokens.css`];
    }
    const variables = declaredVariables(block);
    const palette = palettes[theme];
    return [
      ...colourTokens.flatMap((token) => {
        const declared = variables.get(token);
        const expected = palette[token].toLowerCase();
        return declared === expected
          ? []
          : [`${label}: --pl-${token} is ${declared ?? 'missing'}, expected ${expected}`];
      }),
      ...[...variables.keys()]
        .filter((name) => !known.has(name))
        .map((name) => `${label}: --pl-${name} is not a token in themes.ts`),
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
