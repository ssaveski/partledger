import { translate } from '@partledger/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../components/button';
import { RootErrorBoundary } from './root-error-boundary';
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from './states';

const meta = { title: 'States' } satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const noop = () => undefined;

export const Loading: Story = {
  render: () => <LoadingState labelKey="pl.ui.preview.loadingParts" />,
};

export const Empty: Story = {
  render: () => (
    <EmptyState
      titleKey="pl.ui.preview.noPartsTitle"
      descriptionKey="pl.ui.preview.noPartsDescription"
      action={
        <>
          <Button>{translate('pl.ui.preview.importParts')}</Button>
          <Button variant="secondary">{translate('pl.ui.preview.addPart')}</Button>
        </>
      }
    />
  ),
};

export const ErrorWithRetry: Story = {
  render: () => (
    <ErrorState messageKey="pl.ui.preview.suppliersFailed" messageParams={{ status: 503 }} onRetry={noop} />
  ),
};

export const ErrorWithUnknownKey: Story = {
  render: () => <ErrorState messageKey="pl.api.error.notInTheCatalogue" onRetry={noop} />,
};

export const NoPermission: Story = {
  render: () => <NoPermissionState />,
};

function MissingTranslation() {
  return <p>{translate('pl.ui.preview.missingOnPurpose')}</p>;
}

export const RootErrorBoundaryCatchesMissingKey: Story = {
  parameters: { bareLayout: true },
  render: () => (
    <RootErrorBoundary>
      <MissingTranslation />
    </RootErrorBoundary>
  ),
};
