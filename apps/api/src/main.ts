import { startApi } from './bootstrap';
import { InvalidRegistryError } from './commands/route-generator';
import { InvalidConfigurationError, loadConfig } from './config/env.schema';
import { CatalogCheckFailedError } from './db/db.module';
import { listenerBindingsFrom } from './listeners/listeners';

async function main(): Promise<void> {
  const config = loadConfig();
  const api = await startApi(config, listenerBindingsFrom(config));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void api.close();
    });
  }
}

main().catch((error: unknown) => {
  if (
    error instanceof InvalidConfigurationError ||
    error instanceof CatalogCheckFailedError ||
    error instanceof InvalidRegistryError
  ) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
