import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CardTitle } from '../components/display';
import { TranslationProvider } from '../i18n/translation';
import { previewCatalogue } from '../preview/catalogue';
import { EmptyState, ErrorState, NoPermissionState } from './states';

const noop = () => undefined;

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<TranslationProvider catalogue={previewCatalogue}>{node}</TranslationProvider>);
}

describe('state headings', () => {
  it('uses a level-two heading by default', () => {
    expect(render(<NoPermissionState />)).toMatch(/<h2[ >]/);
    expect(render(<ErrorState messageKey="pl.ui.state.error.unexpected" onRetry={noop} />)).toMatch(/<h2[ >]/);
  });

  it('renders the heading level a page asks for', () => {
    expect(
      render(
        <EmptyState
          titleKey="pl.preview.noPartsTitle"
          descriptionKey="pl.preview.noPartsDescription"
          action={null}
          headingLevel={3}
        />,
      ),
    ).toMatch(/<h3[ >]/);
    expect(render(<NoPermissionState headingLevel={1} />)).toMatch(/<h1[ >]/);
    expect(render(<CardTitle headingLevel={3} />)).toMatch(/<h3[ >]/);
  });

  it('shows the supplier wording when the portal passes its description key', () => {
    expect(render(<NoPermissionState descriptionKey="pl.ui.state.noPermission.supplierDescription" />)).toContain(
      'Ask the buyer who invited you for access to this page.',
    );
  });
});
