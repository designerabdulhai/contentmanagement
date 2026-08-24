import { syncAllToGoogleSheets } from './googleSheets.js';

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...extra } });
const noContent = () => new Response(null, { status: 204, headers: jsonHeaders });

async function body(request) { try { return await request.json(); } catch { return {}; } }
const textEncoder = new TextEncoder();
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function tokenFromRequest(request) {
  const auth = String(request.headers.get('Authorization') || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}
async function passwordMatches(password, salt, storedHash) {
  if (!storedHash) return false;
  const hash = String(storedHash).toLowerCase();
  const candidates = [
    await sha256Hex(password),
    salt ? await sha256Hex(`${password}${salt}`) : '',
    salt ? await sha256Hex(`${salt}${password}`) : '',
  ];
  return candidates.includes(hash);
}
async function ensureSessionsTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
}
async function requireAuth(request, db) {
  const token = tokenFromRequest(request);
  if (!token) return null;
  await ensureSessionsTable(db);
  return db.prepare(`
    SELECT s.user_id, s.expires_at, u.id, u.display_name, u.email, u.photo, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')
  `).bind(await sha256Hex(token)).first();
}
function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function settingObject(rows) {
  const out = {};
  for (const row of rows) out[row.key] = String(row.value || '').split(',').map(v => v.trim()).filter(Boolean);
  return out;
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') return noContent();
  if (!env.DB) return json({ error: 'D1 binding DB is not configured' }, 500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const db = env.DB;

  if (method === 'GET' && path === '/api/health') {
    const row = await db.prepare('SELECT 1 AS ok').first();
    return json({ ok: row?.ok === 1, database: 'D1' });
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const p = await body(request);
    const email = String(p.email || '').trim().toLowerCase();
    const password = String(p.password || '');
    if (!email || !password) return json({ error: 'email and password required' }, 400);
    const user = await db.prepare('SELECT id, display_name, email, photo, role, password_hash, password_salt FROM users WHERE lower(email)=? LIMIT 1').bind(email).first();
    if (!user) return json({ error: 'invalid email or password' }, 401);
    if (!(await passwordMatches(password, user.password_salt, user.password_hash))) return json({ error: 'invalid email or password' }, 401);
    await ensureSessionsTable(db);
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString().replace('T', ' ').replace('Z', '');
    await db.prepare('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES (?, ?, ?)').bind(user.id, tokenHash, expiresAt).run();
    return json({ token, user: { id: user.id, display_name: user.display_name, email: user.email, photo: user.photo, role: user.role } });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    const token = tokenFromRequest(request);
    if (token) {
      await ensureSessionsTable(db);
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
    }
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/api/auth/me') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error: 'authentication required' }, 401);
    return json({ user: { id: user.id, display_name: user.display_name, email: user.email, photo: user.photo, role: user.role } });
  }

  const publicPaths = new Set(['/api/health', '/api/auth/login', '/api/auth/logout', '/api/auth/me']);
  if (!publicPaths.has(path)) {
    const user = await requireAuth(request, db);
    if (!user) return json({ error: 'authentication required' }, 401);
  }

  // Manual full D1 -> Google Sheets sync. This is useful for the first sync
  // and also exposes the exact Google Apps Script error instead of silently
  // swallowing it in the normal write flow.
  if (method === 'POST' && path === '/api/google-sheets/sync') {
    const result = await syncAllToGoogleSheets(env);
    return json(result, result.ok ? 200 : 502);
  }

  if (method === 'GET' && path === '/api/posts') {
    const result = await db.prepare(`SELECT p.*, u.display_name AS owner FROM posts p LEFT JOIN users u ON p.created_by = u.id ORDER BY p.scheduled_at IS NULL, p.scheduled_at`).all();
    return json(result.results || []);
  }
  if (method === 'GET' && path === '/api/posts/project-suggestions') {
    const q = String(url.searchParams.get('query') || '').trim();
    if (!q) return json([]);
    const result = await db.prepare('SELECT project_name, scheduled_at, channel, status FROM posts WHERE project_name IS NOT NULL AND lower(project_name) LIKE ? ORDER BY scheduled_at IS NULL, scheduled_at DESC').bind(`%${q.toLowerCase()}%`).all();
    const map = {};
    for (const r of result.results || []) { const name = r.project_name; if (!map[name]) map[name] = { project_name: name, last_scheduled: [], count: 0 }; map[name].count++; if (r.scheduled_at) map[name].last_scheduled.push(r); }
    return json(Object.values(map).map(item => ({ project_name: item.project_name, count: item.count, last_scheduled_dates: item.last_scheduled.slice(0, 5).map(s => ({ scheduled_at: s.scheduled_at, channel: s.channel || '', status: s.status || '' })) })));
  }
  if (method === 'POST' && path === '/api/posts') {
    const p = await body(request);
    if (!p.project_name) return json({ error: 'project_name required' }, 400);
    if (p.scheduled_at && !parseDate(p.scheduled_at)) return json({ error: 'invalid scheduled_at' }, 400);
    const result = await db.prepare(`INSERT INTO posts (project_name, content_type, channel, platform, status, scheduled_at, uploaded_link, notes, created_by, recurring_rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(p.project_name, p.content_type || null, p.channel || null, p.platform || null, p.status || 'Listed', p.scheduled_at || null, p.uploaded_link || null, p.notes || null, p.created_by || null, p.recurring_rule || null).run();
    const row = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(result.meta.last_row_id).first();
    if (row) await db.prepare('INSERT INTO audit(post_id, action, payload, actor) VALUES (?, ?, ?, ?)').bind(row.id, 'create', JSON.stringify(row), p.created_by || 'system').run();
    return json(row, 201);
  }
  if (method === 'GET' && path === '/api/templates') return json((await db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all()).results || []);
  if (method === 'GET' && path === '/api/settings') return json(settingObject((await db.prepare('SELECT key, value FROM settings').all()).results || []));
  if (method === 'GET' && path === '/api/users') return json((await db.prepare('SELECT id, display_name, email, photo, role, created_at FROM users ORDER BY created_at DESC').all()).results || []);
  if (method === 'GET' && path === '/api/invites') return json((await db.prepare('SELECT id, email, role, status, created_at FROM invites ORDER BY created_at DESC').all()).results || []);
  if (method === 'GET' && path === '/api/summary') {
    const [total, scheduledWeek, uploadedMonth, listedCount, overdue] = await db.batch([
      db.prepare('SELECT COUNT(*) AS c FROM posts'),
      db.prepare("SELECT COUNT(*) AS c FROM posts WHERE scheduled_at >= datetime('now') AND scheduled_at < datetime('now','+7 days')"),
      db.prepare("SELECT COUNT(*) AS c FROM posts WHERE status='Uploaded' AND strftime('%Y-%m', created_at)=strftime('%Y-%m','now')"),
      db.prepare("SELECT COUNT(*) AS c FROM posts WHERE status='Listed'"),
      db.prepare('SELECT COUNT(*) AS c FROM posts WHERE is_overdue=1'),
    ]);
    return json({ total: total.results[0]?.c || 0, scheduledWeek: scheduledWeek.results[0]?.c || 0, uploadedMonth: uploadedMonth.results[0]?.c || 0, listedCount: listedCount.results[0]?.c || 0, overdue: overdue.results[0]?.c || 0 });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const response = await handle(request, env);

      // Sync D1 data after successful write operations. Auth/session writes are excluded.
      const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
      const isWrite = ['POST', 'PUT', 'DELETE'].includes(request.method);
      const isAuth = path.startsWith('/api/auth/');
      const isManualSync = path === '/api/google-sheets/sync';
      if (isWrite && !isAuth && !isManualSync && response.status < 400) {
        const syncResult = await syncAllToGoogleSheets(env);
        if (!syncResult.ok) console.error('Automatic Google Sheets sync failed:', syncResult.error);
      }

      return response;
    } catch (err) {
      console.error(err);
      return json({ error: err?.message || 'internal server error' }, 500);
    }
  },
};
