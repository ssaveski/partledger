import { englishCatalogue, type ModuleCatalogue } from '@partledger/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Select, SelectTrigger } from '../components/select';
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from '../states/states';
import { TranslationProvider } from './translation';

// Every message becomes its own key in brackets, so any text outside brackets is a literal.
const pseudoCatalogue: ModuleCatalogue = Object.fromEntries(
  Object.keys(englishCatalogue).map((key) => [key, `⟦${key}⟧`]),
);

function renderWith(catalogue: ModuleCatalogue, node: ReactNode): string {
  return renderToStaticMarkup(<TranslationProvider catalogue={catalogue}>{node}</TranslationProvider>);
}

/** Visible text and text-bearing attributes, with every bracketed key removed. */
function literalText(markup: string): string {
  const attributes = [...markup.matchAll(/(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map((match) => match[1]);
  const text = markup.replace(/<[^>]*>/g, ' ');
  return [text, ...attributes]
    .join(' ')
    .replace(/⟦[^⟧]*⟧/g, '')
    .trim();
}

const noop = () => undefined;

const rendered: [string, ReactNode][] = [
  ['the loading state', <LoadingState key="loading" />],
  [
    'the empty state',
    <EmptyState
      key="empty"
      titleKey="pl.ui.preview.noPartsTitle"
      descriptionKey="pl.ui.preview.noPartsDescription"
      action={null}
    />,
  ],
  ['the error state', <ErrorState key="error" messageKey="pl.ui.state.error.unexpected" onRetry={noop} />],
  ['the no-permission state', <NoPermissionState key="noPermission" />],
  [
    'the select placeholder',
    <Select key="select">
      <SelectTrigger />
    </Select>,
  ],
];

describe('component text', () => {
  it.each(rendered)('%s renders translation keys, not literals', (_name, node) => {
    const markup = renderWith(pseudoCatalogue, node);
    expect(markup).toContain('⟦pl.ui.');
    expect(literalText(markup)).toBe('');
  });

  it('fills message params in the error state', () => {
    const markup = renderWith(
      englishCatalogue,
      <ErrorState messageKey="pl.ui.preview.suppliersFailed" messageParams={{ status: 503 }} onRetry={noop} />,
    );
    expect(markup).toContain('The supplier list could not be loaded (status 503).');
  });

  it('shows the generic message when the error state gets an unknown message key', () => {
    const markup = renderWith(englishCatalogue, <ErrorState messageKey="pl.api.notInTheCatalogue" onRetry={noop} />);
    expect(markup).toContain(englishCatalogue['pl.ui.state.error.unexpected']);
  });

  it('shows the generic message when the error state misses a message param', () => {
    const markup = renderWith(
      englishCatalogue,
      <ErrorState messageKey="pl.ui.preview.suppliersFailed" onRetry={noop} />,
    );
    expect(markup).toContain(englishCatalogue['pl.ui.state.error.unexpected']);
  });

  it('still fails loudly on a missing key outside the error state', () => {
    expect(() => renderWith(englishCatalogue, <LoadingState labelKey="pl.ui.notInTheCatalogue" />)).toThrow(
      /Missing message/,
    );
  });
});
