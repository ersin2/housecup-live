import { applyD1Migrations, reset } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach } from 'vitest';
import { newHost } from './helpers.ts';

beforeEach(async () => {
  newHost(); // unique origin per test → isolated Cache API keys
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

afterEach(async () => {
  await reset();
});
