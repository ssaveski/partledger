import '../src/global';

import type { Decorator, Preview } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { TooltipProvider } from '../src/components/tooltip';
import { TranslationProvider, useTranslate } from '../src/i18n/translation';
import { previewCatalogue } from '../src/preview/catalogue';
import { themeNames } from '../src/tokens/themes';

const themeSchema = z.enum(themeNames).catch('dark');

// A story that renders its own <main>, such as the root error boundary, sets `bareLayout`.
const bareLayoutSchema = z.boolean().catch(false);

function PreviewFrame({ children }: { children: ReactNode }) {
  const translate = useTranslate();
  return (
    <main className="min-h-screen bg-surface p-6 text-primary">
      <h1 className="mb-6 text-sm font-medium text-muted">{translate('pl.preview.title')}</h1>
      {children}
    </main>
  );
}

const withTheme: Decorator = (Story, context) => {
  document.documentElement.dataset['theme'] = themeSchema.parse(context.globals['theme']);
  const bare = bareLayoutSchema.parse(context.parameters['bareLayout']);
  return (
    <TranslationProvider catalogue={previewCatalogue}>
      <TooltipProvider>
        {bare ? (
          <Story />
        ) : (
          <PreviewFrame>
            <Story />
          </PreviewFrame>
        )}
      </TooltipProvider>
    </TranslationProvider>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: { title: 'Theme', icon: 'contrast', items: [...themeNames], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'dark' },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
};

export default preview;
