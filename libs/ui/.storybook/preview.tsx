import '../src/global';

import type { Decorator, Preview } from '@storybook/react-vite';
import { z } from 'zod';
import { translate } from '@partledger/contracts';

import { TooltipProvider } from '../src/components/tooltip';
import { themeNames } from '../src/tokens/themes';

const themeSchema = z.enum(themeNames).catch('dark');

// A story that renders its own <main>, such as the root error boundary, sets `bareLayout`.
const bareLayoutSchema = z.boolean().catch(false);

const withTheme: Decorator = (Story, context) => {
  document.documentElement.dataset['theme'] = themeSchema.parse(context.globals['theme']);
  if (bareLayoutSchema.parse(context.parameters['bareLayout'])) {
    return (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    );
  }
  return (
    <TooltipProvider>
      <main className="min-h-screen bg-surface p-6 text-primary">
        <h1 className="mb-6 text-sm font-medium text-muted">{translate('pl.ui.preview.title')}</h1>
        <Story />
      </main>
    </TooltipProvider>
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
