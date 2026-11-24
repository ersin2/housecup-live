import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_PASSCODE: 'test-admin-passcode',
            SESSION_SECRET: 'test-session-secret-0123456789abcdef',
            SYNC_PUBLISH: '1',
            SCHOOL_TZ: 'Asia/Kuala_Lumpur',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
    },
  };
});
