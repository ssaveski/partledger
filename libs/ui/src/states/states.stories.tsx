import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../components/button';
import { useTranslate } from '../i18n/translation';
import { RootErrorBoundary } from './root-error-boundary';
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from './states';

const meta = { title: 'States' } satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const noop = () => undefined;

export const Loading: Story = {
  render: () => <LoadingState labelKey="pl.preview.loadingParts" />,
};

function EmptyActions() {
  const translate = useTranslate();
  return (
    <>
      <Button>{translate('pl.preview.importParts')}</Button>
      <Button variant="secondary">{translate('pl.preview.addPart')}</Button>
    </>
  );
}

export const Empty: Story = {
  render: () => (
    <EmptyState
      titleKey="pl.preview.noPartsTitle"
      descriptionKey="pl.preview.noPartsDescription"
      action={<EmptyActions />}
    />
  ),
};

export const ErrorWithRetry: Story = {
  render: () => <ErrorState messageKey="pl.preview.suppliersFailed" messageParams={{ status: 503 }} onRetry={noop} />,
};

export const ErrorWithUnknownKey: Story = {
  render: () => <ErrorState messageKey="pl.api.error.notInTheCatalogue" onRetry={noop} />,
};

export const NoPermission: Story = {
  render: () => <NoPermissionState />,
};

export const NoPermissionForSupplier: Story = {
  render: () => <NoPermissionState descriptionKey="pl.ui.state.noPermission.supplierDescription" />,
};

function MissingTranslation() {
  const translate = useTranslate();
  return <p>{translate('pl.preview.missingOnPurpose')}</p>;
}

export const RootErrorBoundaryCatchesMissingKey: Story = {
  parameters: { bareLayout: true },
  render: () => (
    <RootErrorBoundary>
      <MissingTranslation />
    </RootErrorBoundary>
  ),
};

// Fails until the boundary has reported the error, so the retry renders the page successfully.
const flaky = { failing: true };

function FlakyPage() {
  const translate = useTranslate();
  if (flaky.failing) {
    return <p>{translate('pl.preview.missingOnPurpose')}</p>;
  }
  return (
    <main className="p-6">
      <h1>{translate('pl.preview.recovered')}</h1>
    </main>
  );
}

export const RootErrorBoundaryRecovers: Story = {
  parameters: { bareLayout: true },
  render: () => (
    <RootErrorBoundary
      onError={() => {
        flaky.failing = false;
      }}
    >
      <FlakyPage />
    </RootErrorBoundary>
  ),
};
