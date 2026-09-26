import { createApp } from './bootstrap';
import { InvalidConfigurationError, loadConfig } from './config/env.schema';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp();
  await app.listen(config.PORT, config.HOST);
}

main().catch((error: unknown) => {
  if (error instanceof InvalidConfigurationError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
