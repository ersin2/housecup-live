import { describe, expect, it } from 'vitest';
import { call, sportsDay } from './helpers.ts';

describe('smoke', () => {
  it('health + fixture', async () => {
    expect((await call('/api/health')).body).toEqual({ ok: true });
    const { event } = await sportsDay();
    expect(event.teams).toHaveLength(4);
  });
  it('second test starts from a clean database', async () => {
    const { event } = await sportsDay();
    expect(event.slug).toBe('sports-day');
  });
});
