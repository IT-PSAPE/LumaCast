import { runBrowserPreviewCli } from './server';

void runBrowserPreviewCli().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
