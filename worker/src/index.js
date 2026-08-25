import { syncAllToGoogleSheets } from './googleSheets.js';

const WORKER_VERSION = '2026-08-25-delete-route-v2';
const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS });
const noContent = () => new Response(null, { status: 204, headers: CORS });
async function body(request) { try { return await request.json(); } catch { return {}; } }
const encoder = new TextEncoder();
async function sha256Hex(value) { const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value))); return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function tokenFromRequest(request) { const auth = String(request.headers.get('Authorization') || ''); return auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''; }
function base64UrlEncode(value) { return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function base64UrlDecode(value) { const n = String(value || '').replace(/-/g, '+').replace(/_/g, '/'); return atob(n + '='.repeat((4 - (n.length % 4)) % 4)); }
async function passwordMatches(password, salt, storedHash) { const p = String(password ?? ''); const s = String(salt ?? '').trim(); const h = String(storedHash ?? '').trim().toLowerCase(); if (!p || !h) return false; return (await sha256Hex(p + s)).toLowerCase() === h; }
async function createAuthToken(user) { const expires = Math.floor(Date.now() / 1000) + 7 * 86400; const payload = `${user.id}.${expires}`; const signature = await sha256Hex(`${payload}.${String(user.password_hash || '')}`); return `${base64UrlEncode(payload)}.${signature}`; }
async function requireAuth(request, db) { const token = tokenFromRequest(request); if (!token) return null; const parts = token.split('.'); if (parts.length !== 2) return null; try { const payload = base64UrlDecode(parts[0]); const [idText, expText] = payload.split('.'); const id = Number(idText); const exp = Number(expText); if (!Number.isInteger(id) || !Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null; const user = await db.prepare(`SELECT id,display_name,email,photo,role,password_hash FROM users WHERE id=? LIMIT 1`).bind(id).first(); if (!user?.password_hash) return null; const expected = await sha256Hex(`${payload}.${String(user.password_hash)}`); return expected === parts[1] ? user : null; } catch { return null; } }
function settingsObject(rows) { const out = {}; for (const row of rows) out[row.key] = String(row.value || '').split(',').map(v => v.trim()).filter(Boolean); return out; }

async function handle(request, env) {
  if (request.method === 'OPTIONS') return noContent();
  if (!env.DB) return json({ error: 'D1 binding DB is not configured' }, 500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const db = env.DB;

  if (method === 'GET' && path === '/') return json({ ok:true, service:'contentmanagement-api', database:'D1', version:WORKER_VERSION });
  if (method === 'GET' && path === '/api/health') return json({ ok:true, database:'D1', worker:'contentmanagement-api', version:WORKER_VERSION, deleteRoutes:['/api/posts/:id/delete','/api/posts/:id','/posts/:id/delete','/posts/:id'] });

  if (method === 'POST' && path === '/api/auth/login') {
    const p = await body(request);
    const email = String(p.email || '').trim().toLowerCase();
    const password = String(p.password || '');
    if (!email || !password) return json({ error:'email and password required' }, 400);
    const user = await db.prepare(`SELECT id,display_name,email,photo,role,password_hash,password_salt FROM users WHERE lower(trim(email))=? LIMIT 1`).bind(email).first();
    if (!user || !(await passwordMatches(password, user.password_salt, user.password_hash))) return json({ error:'invalid email or password' }, 401);
    return json({ ok:true, token:await createAuthToken(user), user:{ id:user.id, display_name:user.display_name, email:user.email, photo:user.photo, role:user.role } });
  }

  if (method === 'GET' && path === '/api/auth/me') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error:'authentication required' }, 401);
    return json({ user:{ id:user.id, display_name:user.display_name, email:user.email, photo:user.photo, role:user.role } });
  }
  if (method === 'POST' && path === '/api/auth/logout') return json({ ok:true });

  if (method === 'POST' && path === '/api/google-sheets/sync') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error:'authentication required' }, 401);
    const result = await syncAllToGoogleSheets(env, { mode:'manual', actor:user.email });
    return json(result, result.ok ? 200 : 502);
  }

  if (method === 'GET' && path === '/api/posts') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error:'authentication required' }, 401);
    const result = await db.prepare(`SELECT p.*, u.display_name AS owner FROM posts p LEFT JOIN users u ON p.created_by=u.id ORDER BY p.scheduled_at IS NULL,p.scheduled_at`).all();
    return json(result.results || []);
  }

  if (method === 'POST' && path === '/api/posts') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error:'authentication required' }, 401);
    const p = await body(request);
    if (!p.project_name) return json({ error:'project_name required' }, 400);
    const result = await db.prepare(`INSERT INTO posts (project_name,content_type,channel,platform,status,scheduled_at,uploaded_link,notes,created_by,recurring_rule) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(p.project_name,p.content_type||null,p.channel||null,p.platform||null,p.status||'Listed',p.scheduled_at||null,p.uploaded_link||null,p.notes||null,user.id,p.recurring_rule||null).run();
    const row = await db.prepare('SELECT * FROM posts WHERE id=?').bind(result.meta.last_row_id).first();
    return json(row, 201);
  }

  // Accept both the normal /api/posts/:id form and paths where an upstream
  // proxy has stripped the /api prefix. This makes deletion resilient to
  // Vercel/Worker path rewrites without changing the D1 schema.
  const postActionMatch = path.match(/(?:^|\/)posts\/(\d+)(?:\/(delete|remove))?$/);
  if (postActionMatch) {
    const id = Number(postActionMatch[1]);
    const action = postActionMatch[2] || '';
    const user = await requireAuth(request, db);
    if (!user) return json({ error:'authentication required' }, 401);

    const isDelete = Boolean(action) || method === 'DELETE';
    if (isDelete && (method === 'POST' || method === 'DELETE')) {
      const existing = await db.prepare('SELECT id FROM posts WHERE id=?').bind(id).first();
      if (!existing) return json({ error:'post not found', id, path, method }, 404);
      await db.prepare('DELETE FROM posts WHERE id=?').bind(id).run();
      return json({ ok:true, id, deleted:true, path, method });
    }

    if (!action && method === 'GET') {
      const row = await db.prepare('SELECT p.*,u.display_name AS owner FROM posts p LEFT JOIN users u ON p.created_by=u.id WHERE p.id=?').bind(id).first();
      return row ? json(row) : json({error:'post not found', id},404);
    }

    if (!action && method === 'PUT') {
      const p = await body(request);
      const existing = await db.prepare('SELECT * FROM posts WHERE id=?').bind(id).first();
      if (!existing) return json({error:'post not found', id},404);
      await db.prepare(`UPDATE posts SET project_name=?,content_type=?,channel=?,platform=?,status=?,scheduled_at=?,uploaded_link=?,notes=?,recurring_rule=?,updated_at=datetime('now') WHERE id=?`).bind(p.project_name ?? existing.project_name,p.content_type ?? existing.content_type,p.channel ?? existing.channel,p.platform ?? existing.platform,p.status ?? existing.status,p.scheduled_at ?? existing.scheduled_at,p.uploaded_link ?? existing.uploaded_link,p.notes ?? existing.notes,p.recurring_rule ?? existing.recurring_rule,id).run();
      return json(await db.prepare('SELECT * FROM posts WHERE id=?').bind(id).first());
    }
  }

  if (method === 'GET' && path === '/api/settings') { const user = await requireAuth(request, db); if (!user) return json({ error:'authentication required' },401); return json(settingsObject((await db.prepare('SELECT key,value FROM settings').all()).results || [])); }
  if (method === 'GET' && path === '/api/templates') { const user = await requireAuth(request, db); if (!user) return json({ error:'authentication required' },401); return json((await db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all()).results || []); }
  if (method === 'GET' && path === '/api/users') { const user = await requireAuth(request, db); if (!user) return json({ error:'authentication required' },401); return json((await db.prepare('SELECT id,display_name,email,photo,role,created_at FROM users ORDER BY created_at DESC').all()).results || []); }
  if (method === 'GET' && path === '/api/invites') { const user = await requireAuth(request, db); if (!user) return json({ error:'authentication required' },401); return json((await db.prepare('SELECT id,email,role,status,created_at FROM invites ORDER BY created_at DESC').all()).results || []); }

  if (method === 'GET' && path === '/api/summary') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error:'authentication required' },401);
    const [a,b,c,d,e] = await db.batch([
      db.prepare('SELECT COUNT(*) AS c FROM posts'),
      db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE scheduled_at>=datetime('now') AND scheduled_at<datetime('now','+7 days')`),
      db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE status='Uploaded'`),
      db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE status='Listed'`),
      db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE is_overdue=1`),
    ]);
    return json({ total:a.results[0]?.c||0, scheduledWeek:b.results[0]?.c||0, uploadedMonth:c.results[0]?.c||0, listedCount:d.results[0]?.c||0, overdue:e.results[0]?.c||0 });
  }

  return json({ error:'not found', path, method }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error('Worker error:', error?.message || error);
      return json({ error:error?.message || String(error) }, 500);
    }
  },
};
