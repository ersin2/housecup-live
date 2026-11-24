// One ScoreHub per scope ("event:<id>" or "season"). Uses the WebSocket Hibernation API so idle
// spectator connections cost no duration: the object only wakes to publish or to send a heartbeat.
import { DurableObject } from 'cloudflare:workers';
import type { LiveMessage } from '@housecup/shared/types';
import type { Env } from '../env.ts';
import { buildEventScoreboard, buildSeasonScoreboard } from '../services/scoreboard.ts';
import { getEventById } from '../services/rows.ts';

export const HEARTBEAT_MS = 50_000;
const SNAPSHOT_KEY = 'snapshot';

export class ScoreHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Client "ping" frames are answered by the runtime without waking (or billing duration on) the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const scope = new URL(request.url).searchParams.get('scope') ?? '';
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server); // hibernatable — never server.accept()

    let snapshot: string | null = this.ctx.storage.kv.get<string>(SNAPSHOT_KEY) ?? null;
    if (!snapshot) {
      snapshot = await this.buildSnapshot(scope);
      if (snapshot) this.ctx.storage.kv.put(SNAPSHOT_KEY, snapshot);
    }
    if (snapshot) server.send(snapshot);

    await this.ensureHeartbeat();
    return new Response(null, { status: 101, webSocket: client });
  }

  private loop: Promise<void> | null = null;
  private dirty = false;

  /**
   * RPC: "public data changed for <scope>". The hub rebuilds the snapshot from D1 itself and
   * fans it out (outgoing messages are not billed). Signals arriving while a rebuild is running
   * are coalesced into one more rebuild, so the final broadcast always reflects the latest write
   * — two near-simultaneous saves can never leave screens on an older snapshot.
   */
  async refresh(scope: string): Promise<void> {
    this.dirty = true;
    if (!this.loop) {
      this.loop = (async () => {
        try {
          while (this.dirty) {
            this.dirty = false;
            const snapshot = await this.buildSnapshot(scope);
            if (snapshot) {
              this.ctx.storage.kv.put(SNAPSHOT_KEY, snapshot);
              this.broadcast(snapshot);
            }
          }
        } finally {
          this.loop = null;
        }
      })();
    }
    return this.loop;
  }

  /** RPC (tests/ops): number of connected sockets. */
  async connectionCount(): Promise<number> {
    return this.ctx.getWebSockets().length;
  }

  override async alarm(): Promise<void> {
    // Idle discipline: stop the heartbeat loop once the last viewer is gone.
    if (this.ctx.getWebSockets().length === 0) return;
    const hb: LiveMessage = { t: 'hb', ts: Date.now() };
    this.broadcast(JSON.stringify(hb));
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    }
  }

  override async webSocketMessage(): Promise<void> {
    // Spectators never need to talk to us; "ping" is handled by the auto-response.
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      // already closed
    }
  }

  private broadcast(message: string): number {
    let sent = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
        sent++;
      } catch {
        // socket is closing; the runtime will drop it
      }
    }
    return sent;
  }

  private async ensureHeartbeat() {
    if (this.ctx.getWebSockets().length === 0) return;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    }
  }

  private async buildSnapshot(scope: string): Promise<string | null> {
    let msg: LiveMessage | null = null;
    if (scope === 'season') {
      msg = { t: 'snapshot', data: await buildSeasonScoreboard(this.env.DB) };
    } else if (scope.startsWith('event:')) {
      const event = await getEventById(this.env.DB, Number(scope.slice(6)));
      if (event) msg = { t: 'snapshot', data: await buildEventScoreboard(this.env.DB, event) };
    }
    return msg ? JSON.stringify(msg) : null;
  }
}
