import { createApp } from './bootstrap';
import { InvalidConfigurationError, loadConfig } from './config/env.schema';
import { CatalogCheckFailedError } from './db/db.module';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT, config.HOST);
}

main().catch((error: unknown) => {
  if (error instanceof InvalidConfigurationError || error instanceof CatalogCheckFailedError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
