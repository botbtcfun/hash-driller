/**
 * The game's Worker: the static game, and its daily leaderboard under /api.
 * Scores come in as initials and a run's inputs; the Worker replays the run
 * and keeps what it comes to. Nothing about a player is stored but the
 * initials they type. Their address only keys the rate limit.
 */
import { type Run, dayOf, verify } from './verify';

/** The bits of Cloudflare's bindings used here. */
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { last_row_id: number; changes: number } }>;
}
interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  DB: { prepare(sql: string): D1Statement };
  SCORE_LIMIT: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

/** The board shows this many. */
const TOP = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/board' && req.method === 'GET') return board(env, Number(url.searchParams.get('day')) || dayOf(Date.now()));
    if (url.pathname === '/api/score' && req.method === 'POST') return score(req, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};

interface Row {
  initials: string;
  sats: number;
  depth: number;
  level: number;
  chain: number;
}

/** A day's best runs, best first; ties go to the earlier one. */
async function top(env: Env, day: number): Promise<Row[]> {
  const { results } = await env.DB.prepare('SELECT initials, sats, depth, level, chain FROM scores WHERE day = ? ORDER BY sats DESC, id ASC LIMIT ?').bind(day, TOP).all<Row>();
  return results;
}

async function board(env: Env, day: number): Promise<Response> {
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ?').bind(day).first<{ n: number }>();
  return json({ day, runs: count?.n ?? 0, top: await top(env, day) });
}

async function score(req: Request, env: Env): Promise<Response> {
  const { success } = await env.SCORE_LIMIT.limit({ key: req.headers.get('cf-connecting-ip') ?? 'anyone' });
  if (!success) return json({ error: 'too many scores at once: try again in a minute' }, 429);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const verdict = verify(body, Date.now());
  if (!verdict.ok) return json({ error: verdict.error }, verdict.status);
  const run: Run = verdict.run;
  // The same run sent twice is one entry: its final state hash is unique for the day.
  await env.DB.prepare('INSERT OR IGNORE INTO scores (day, initials, sats, depth, level, chain, ticks, hash, inputs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(run.day, run.initials, run.sats, run.depth, run.level, run.chain, run.ticks, run.hash, run.inputs)
    .run();
  const entry = await env.DB.prepare('SELECT id FROM scores WHERE day = ? AND hash = ?').bind(run.day, run.hash).first<{ id: number }>();
  const better = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ? AND (sats > ? OR (sats = ? AND id < ?))')
    .bind(run.day, run.sats, run.sats, entry?.id ?? 0)
    .first<{ n: number }>();
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ?').bind(run.day).first<{ n: number }>();
  return json({ day: run.day, rank: (better?.n ?? 0) + 1, runs: count?.n ?? 0, sats: run.sats, top: await top(env, run.day) });
}
