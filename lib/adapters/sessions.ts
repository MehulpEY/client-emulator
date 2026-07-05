// ============================================================================
// Session pool — the mock of "maintain live connections and reuse them".
// A connection re-uses its unexpired session across heartbeats, fetches and
// gateway calls; when it expires a new one is minted and counted. This is the
// observable-reuse layer PLAN §1 claim 3 promises (Axonius re-auths per fetch;
// we cache like a real client SDK and expose the counters).
//
// Foundation-owned. W1/W2/W3 call getOrCreateSession()/revokeSessions();
// nobody re-implements session logic.
// ============================================================================

import { tryQuery, SCHEMA } from "../db";
import { adapterMeta } from "./meta";
import { sesId, sessionToken } from "./ids";
import type { ConnectionDbRow, SessionInfo } from "./types";

interface SessionRow {
  session_id: string;
  connection_id: string;
  token: string;
  issued_at: string;
  expires_at: string;
  last_used_at: string;
  use_count: number;
  revoked: boolean;
}

const DEFAULT_TTL_MINUTES = 30;

function ttlMinutesFor(conn: ConnectionDbRow): number {
  return adapterMeta(conn.tool_id)?.sessionTtlMinutes ?? DEFAULT_TTL_MINUTES;
}

/**
 * Reuse the connection's live session, or mint a new one. Best-effort: with
 * the DB offline it returns an ephemeral, uncounted session so callers work.
 */
export async function getOrCreateSession(conn: ConnectionDbRow): Promise<SessionInfo> {
  const live = await tryQuery<SessionRow>(
    `select * from ${SCHEMA}.connection_sessions
      where connection_id = $1 and revoked = false and expires_at > now()
      order by issued_at desc limit 1`,
    [conn.connection_id]
  );

  if (live[0]) {
    const s = live[0];
    await tryQuery(
      `update ${SCHEMA}.connection_sessions set use_count = use_count + 1, last_used_at = now() where session_id = $1`,
      [s.session_id]
    );
    await tryQuery(
      `update ${SCHEMA}.adapter_connections set session_reuses = session_reuses + 1 where connection_id = $1`,
      [conn.connection_id]
    );
    return {
      sessionId: s.session_id,
      token: s.token,
      reused: true,
      issuedAt: s.issued_at,
      expiresAt: s.expires_at,
      useCount: s.use_count + 1,
    };
  }

  const id = sesId();
  const token = sessionToken();
  const ttl = ttlMinutesFor(conn);
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
  const inserted = await tryQuery<SessionRow>(
    `insert into ${SCHEMA}.connection_sessions (session_id, connection_id, token, expires_at)
     values ($1, $2, $3, $4) returning *`,
    [id, conn.connection_id, token, expiresAt]
  );
  await tryQuery(
    `update ${SCHEMA}.adapter_connections set sessions_issued = sessions_issued + 1 where connection_id = $1`,
    [conn.connection_id]
  );
  await tryQuery(
    `insert into ${SCHEMA}.connection_events (connection_id, tool_id, kind, detail)
     values ($1, $2, 'session_issued', $3)`,
    [conn.connection_id, conn.tool_id, `session ${id} minted (ttl ${ttl}m)`]
  );
  const row = inserted[0];
  return {
    sessionId: row?.session_id ?? id,
    token: row?.token ?? token,
    reused: false,
    issuedAt: row?.issued_at ?? new Date().toISOString(),
    expiresAt: row?.expires_at ?? expiresAt,
    useCount: row?.use_count ?? 0,
  };
}

/** Kill all live sessions (credential change, disable, simulated revocation). */
export async function revokeSessions(conn: Pick<ConnectionDbRow, "connection_id" | "tool_id">, reason: string): Promise<number> {
  const rows = await tryQuery<{ session_id: string }>(
    `update ${SCHEMA}.connection_sessions set revoked = true
      where connection_id = $1 and revoked = false and expires_at > now()
      returning session_id`,
    [conn.connection_id]
  );
  if (rows.length > 0) {
    await tryQuery(
      `insert into ${SCHEMA}.connection_events (connection_id, tool_id, kind, detail)
       values ($1, $2, 'session_expired', $3)`,
      [conn.connection_id, conn.tool_id, `${rows.length} session(s) revoked: ${reason}`]
    );
  }
  return rows.length;
}

/** Latest session (live or not) for descriptor views. */
export async function currentSession(connectionId: string): Promise<SessionInfo | null> {
  const rows = await tryQuery<SessionRow>(
    `select * from ${SCHEMA}.connection_sessions where connection_id = $1 order by issued_at desc limit 1`,
    [connectionId]
  );
  const s = rows[0];
  if (!s) return null;
  return {
    sessionId: s.session_id,
    token: s.token,
    reused: s.use_count > 0,
    issuedAt: s.issued_at,
    expiresAt: s.expires_at,
    useCount: s.use_count,
  };
}
