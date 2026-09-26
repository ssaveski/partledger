import { translate } from '@partledger/contracts';

export function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold text-primary">{translate('pl.common.portalTitle')}</h1>
      <p className="text-muted">{translate('pl.common.portalTagline')}</p>
    </main>
  );
}
