import { translate } from '@partledger/contracts';

export function App() {
  return (
    <main>
      <h1>{translate('pl.common.appName')}</h1>
      <p>{translate('pl.common.staffAppTagline')}</p>
    </main>
  );
}
