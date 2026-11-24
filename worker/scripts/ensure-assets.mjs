// Wrangler needs the assets directory to exist; create a placeholder until the web app is built.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const dir = new URL('../../web/dist/', import.meta.url);
if (!existsSync(new URL('index.html', dir))) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('index.html', dir), '<!doctype html><title>HouseCup Live</title><p>Build the web app: npm run build -w web</p>');
}
