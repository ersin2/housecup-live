import type { ScoreHub } from './hub/ScoreHub.ts';
import type { Guard } from './hub/Guard.ts';
import type { EventRow } from './services/rows.ts';

export interface Env {
  DB: D1Database;
  SCORE_HUB: DurableObjectNamespace<ScoreHub>;
  GUARD: DurableObjectNamespace<Guard>;
  ADMIN_PASSCODE: string;
  SESSION_SECRET: string;
  /** IANA zone for "local time" columns in CSV exports. */
  SCHOOL_TZ?: string;
  /** Extra origins allowed to send mutating requests (comma-separated), e.g. the Vite dev server. */
  ALLOWED_ORIGINS?: string;
  /** Tests only: await live publishing inline instead of via waitUntil. */
  SYNC_PUBLISH?: string;
}

export interface JudgeClaims {
  /** event id */
  e: number;
  /** fingerprint of the judge_token the session was issued against */
  f: string;
  /** judge display name */
  n: string | null;
  /** expiry (ms) */
  x: number;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    judge: { claims: JudgeClaims; event: EventRow };
  };
}
