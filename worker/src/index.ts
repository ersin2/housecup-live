import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './env.ts';
import { ApiError, errorBody } from './lib/http.ts';
import { publicRoutes } from './routes/public.ts';
import { judgeRoutes } from './routes/judge.ts';
import { adminRoutes } from './routes/admin.ts';

export { ScoreHub } from './hub/ScoreHub.ts';
export { Guard } from './hub/Guard.ts';

const app = new Hono<AppEnv>();

app.use('/api/*', async (c, next) => {
  await next();
  if (c.res.status === 101) return; // WebSocket upgrade
  try {
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'same-origin');
  } catch {
    // immutable headers (should not happen; responses are copied before return)
  }
});

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api/public', publicRoutes);
app.route('/api/judge', judgeRoutes);
app.route('/api/admin', adminRoutes);

app.notFound((c) => c.json(errorBody('NOT_FOUND', 'No such endpoint'), 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(errorBody(err.code, err.message, err.details), err.status);
  if (err instanceof HTTPException) return c.json(errorBody('HTTP_ERROR', err.message), err.status);
  if (err instanceof SyntaxError) return c.json(errorBody('BAD_JSON', 'Malformed JSON body'), 400);
  console.error('unhandled', err);
  return c.json(errorBody('INTERNAL', 'Something went wrong'), 500);
});

export default app;
