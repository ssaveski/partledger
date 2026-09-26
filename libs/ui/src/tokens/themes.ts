/**
 * The semantic colour tokens (KTD29). `tokens.css` declares the same values as CSS
 * variables; `pnpm contrast:check` fails when the two drift apart or when any pair
 * below drops under its threshold.
 */

export const themeNames = ['dark', 'light'] as const;

export type ThemeName = (typeof themeNames)[number];

export const colourTokens = [
  'surface',
  'surface-raised',
  'surface-overlay',
  'surface-sunken',
  'text-primary',
  'text-muted',
  'text-on-accent',
  'text-on-state',
  'accent',
  'accent-hover',
  'border',
  'border-strong',
  'focus-ring',
  'success',
  'warning',
  'danger',
  'danger-hover',
  'info',
] as const;

export type ColourToken = (typeof colourTokens)[number];

export type Palette = Readonly<Record<ColourToken, string>>;

// Seeded from the operator's dark palette. Its faint greys (#636c74, #5c656d) measure
// under 4.5:1 on these surfaces, so muted text uses a lighter grey instead.
const dark: Palette = {
  surface: '#0e1113',
  'surface-raised': '#12171b',
  'surface-overlay': '#171c20',
  'surface-sunken': '#1b2025',
  'text-primary': '#e6eaed',
  'text-muted': '#9aa4ad',
  'text-on-accent': '#0e1113',
  'text-on-state': '#0e1113',
  accent: '#03fdfc',
  'accent-hover': '#5afdfd',
  border: '#2a3138',
  'border-strong': '#737d86',
  'focus-ring': '#03fdfc',
  success: '#38d39f',
  warning: '#f5b945',
  danger: '#f2555a',
  'danger-hover': '#ff7a7e',
  info: '#6db0ef',
};

// Its own palette rather than an inversion: the cyan accent is unreadable on white,
// so the light theme uses a deep teal and darker state colours.
const light: Palette = {
  surface: '#f6f8f9',
  'surface-raised': '#ffffff',
  'surface-overlay': '#ffffff',
  'surface-sunken': '#eef1f3',
  'text-primary': '#14191d',
  'text-muted': '#4f5961',
  'text-on-accent': '#ffffff',
  'text-on-state': '#ffffff',
  accent: '#006a73',
  'accent-hover': '#005a62',
  border: '#d9dee2',
  'border-strong': '#6f7982',
  'focus-ring': '#006a73',
  success: '#146c50',
  warning: '#7a5000',
  danger: '#b3262d',
  'danger-hover': '#9a1f26',
  info: '#1b5ca3',
};

export const themes: Readonly<Record<ThemeName, Palette>> = { dark, light };

/** Text needs 4.5:1; UI boundaries and focus indicators need 3:1 (WCAG 2.2 AA). */
export type ContrastKind = 'text' | 'ui' | 'focus';

export const minimumContrast: Readonly<Record<ContrastKind, number>> = { text: 4.5, ui: 3, focus: 3 };

export interface ContrastPair {
  readonly foreground: ColourToken;
  readonly background: ColourToken;
  readonly kind: ContrastKind;
}

const surfaces: readonly ColourToken[] = ['surface', 'surface-raised', 'surface-overlay', 'surface-sunken'];

const textOnSurfaces: readonly ColourToken[] = [
  'text-primary',
  'text-muted',
  'accent',
  'success',
  'warning',
  'danger',
  'info',
];

const uiOnSurfaces: readonly ColourToken[] = ['border-strong', 'accent', 'danger'];

function onEverySurface(foregrounds: readonly ColourToken[], kind: ContrastKind): ContrastPair[] {
  return foregrounds.flatMap((foreground) => surfaces.map((background) => ({ foreground, background, kind })));
}

/** Every foreground and background combination the components use. */
export const contrastPairs: readonly ContrastPair[] = [
  ...onEverySurface(textOnSurfaces, 'text'),
  { foreground: 'text-on-accent', background: 'accent', kind: 'text' },
  { foreground: 'text-on-accent', background: 'accent-hover', kind: 'text' },
  ...(['success', 'warning', 'danger', 'danger-hover', 'info'] satisfies ColourToken[]).map(
    (background): ContrastPair => ({ foreground: 'text-on-state', background, kind: 'text' }),
  ),
  ...onEverySurface(uiOnSurfaces, 'ui'),
  ...onEverySurface(['focus-ring'], 'focus'),
];
