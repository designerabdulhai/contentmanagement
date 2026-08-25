import { syncAllToGoogleSheets } from './googleSheets.js';

const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
async function createAuthToken(user) { const expires = Math.floor(Date.now() / 1000) + 7 * 86400; const payload = `${user.id}.${expires}`; const sig = await sha256Hex(`${payload}.${String(user.password_hash || '')}`); return `${base64UrlEncode(payload)}.${sig}`; }
async function requireAuth(request, db) { const token = tokenFromRequest(request); if (!token) return null; const parts = token.split('.'); if (parts.length !== 2) return null; try { const payload = base64UrlDecode(parts[0]); const [idText, expText] = payload.split('.'); const id = Number(idText); const exp = Number(expText); if (!Number.isInteger(id) || !Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null; const user = await db.prepare(`SELECT id, display_name, email, photo, role, password_hash FROM users WHERE id = ? LIMIT 1`).bind(id).first(); if (!user?.password_hash) return null; const expected = await sha256Hex(`${payload}.${String(user.password_hash)}`); return expected === parts[1] ? user : null; } catch { return null; } }
function settingsObject(rows) { const out = {}; for (const row of rows) out[row.key] = String(row.value || '').split(',').map((v) => v.trim()).filter(Boolean); return out; }

async function handle(request, env) {
  if (request.method === 'OPTIONS') return noContent();
  if (!env.DB) return json({ error: 'D1 binding DB is not configured' }, 500);
  const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, '') || '/'; const method = request.method; const db = env.DB;

  if (method === 'GET' && path === '/') return json({ ok: true, service: 'contentmanagement-api', database: 'D1' });
  if (method === 'GET' && path === '/api/health') { const r = await db.prepare('SELECT 1 AS ok').first(); return json({ ok: r?.ok === 1, database: 'D1', worker: 'contentmanagement-api' }); }

  if (method === 'POST' && path === '/api/auth/login') {
    const p = await body(request); const email = String(p.email || '').trim().toLowerCase(); const password = String(p.password || '');
    if (!email || !password) return json({ error: 'email and password required' }, 400);
    const user = await db.prepare(`SELECT id, display_name, email, photo, role, password_hash, password_salt FROM users WHERE lower(trim(email)) = ? LIMIT 1`).bind(email).first();
    if (!user || !(await passwordMatches(password, user.password_salt, user.password_hash))) return json({ error: 'invalid email or password' }, 401);
    return json({ token: await createAuthToken(user), user: { id:user.id, display_name:user.display_name, email:user.email, photo:user.photo, role:user.role } });
  }
  if (method === 'GET' && path === '/api/auth/me') { const u = await requireAuth(request, db); if (!u) return json({ error: 'authentication required' }, 401); return json({ user:{ id:u.id, display_name:u.display_name, email:u.email, photo:u.photo, role:u.role } }); }
  if (method === 'POST' && path === '/api/auth/logout') return json({ ok: true });

  if (method === 'GET' && path === '/api/google-sheets/status') return json({ ok:Boolean(env.DB && env.GSHEET_WEBHOOK_URL && env.GSHEET_SYNC_SECRET), database:Boolean(env.DB), webhookConfigured:Boolean(env.GSHEET_WEBHOOK_URL), secretConfigured:Boolean(env.GSHEET_SYNC_SECRET), syncEndpoint:'/api/google-sheets/sync' });
  if (method === 'POST' && path === '/api/google-sheets/sync') { const u = await requireAuth(request, db); if (!u) return json({ error:'authentication required' }, 401); const result = await syncAllToGoogleSheets(env); return json(result, result.ok ? 200 : 502); }

  const publicPaths = new Set(['/','/api/health','/api/auth/login','/api/auth/me','/api/auth/logout','/api/google-sheets/status']);
  if (!publicPaths.has(path)) { const u = await requireAuth(request, db); if (!u) return json({ error:'authentication required' }, 401); }

  if (method === 'GET' && path === '/api/posts') return json((await db.prepare(`SELECT p.*, u.display_name AS owner FROM posts p LEFT JOIN users u ON p.created_by=u.id ORDER BY p.scheduled_at IS NULL, p.scheduled_at`).all()).results || []);

  if (method === 'POST' && path === '/api/posts') {
    const p = await body(request); if (!p.project_name) return json({ error:'project_name required' },400);
    const r = await db.prepare(`INSERT INTO posts (project_name,content_type,channel,platform,status,scheduled_at,uploaded_link,notes,created_by,recurring_rule) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(p.project_name,p.content_type||null,p.channel||null,p.platform||null,p.status||'Listed',p.scheduled_at||null,p.uploaded_link||null,p.notes||null,p.created_by||null,p.recurring_rule||null).run();
    const row = await db.prepare('SELECT * FROM posts WHERE id=?').bind(r.meta.last_row_id).first(); return json(row,201);
  }

  const postMatch = path.match(/^\/api\/posts\/(\d+)$/);
  if (postMatch) {
    const id = Number(postMatch[1]);
    if (method === 'DELETE') { const existing = await db.prepare('SELECT id FROM posts WHERE id=?').bind(id).first(); if (!existing) return json({error:'post not found'},404); await db.prepare('DELETE FROM posts WHERE id=?').bind(id).run(); return json({ok:true,id}); }
    if (method === 'PUT') { const p = await body(request); const existing = await db.prepare('SELECT * FROM posts WHERE id=?').bind(id).first(); if (!existing) return json({error:'post not found'},404); await db.prepare(`UPDATE posts SET project_name=?,content_type=?,channel=?,platform=?,status=?,scheduled_at=?,uploaded_link=?,notes=?,recurring_rule=? WHERE id=?`).bind(p.project_name ?? existing.project_name,p.content_type ?? existing.content_type,p.channel ?? existing.channel,p.platform ?? existing.platform,p.status ?? existing.status,p.scheduled_at ?? existing.scheduled_at,p.uploaded_link ?? existing.uploaded_link,p.notes ?? existing.notes,p.recurring_rule ?? existing.recurring_rule,id).run(); return json(await db.prepare('SELECT * FROM posts WHERE id=?').bind(id).first()); }
  }

  if (method === 'GET' && path === '/api/settings') return json(settingsObject((await db.prepare('SELECT key,value FROM settings').all()).results || []));
  if (method === 'GET' && path === '/api/templates') return json((await db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all()).results || []);
  if (method === 'GET' && path === '/api/users') return json((await db.prepare('SELECT id,display_name,email,photo,role,created_at FROM users ORDER BY created_at DESC').all()).results || []);
  if (method === 'GET' && path === '/api/invites') return json((await db.prepare('SELECT id,email,role,status,created_at FROM invites ORDER BY created_at DESC').all()).results || []);
  if (method === 'GET' && path === '/api/summary') {
    const [a,b,c,d,e]=await db.batch([db.prepare('SELECT COUNT(*) AS c FROM posts'),db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE scheduled_at>=datetime('now') AND scheduled_at<datetime('now','+7 days')`),db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE status='Uploaded'`),db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE status='Listed'`),db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE is_overdue=1`)]);
    return json({total:a.results[0]?.c||0,scheduledWeek:b.results[0]?.c||0,uploadedMonth:c.results[0]?.c||0,listedCount:d.results[0]?.c||0,overdue:e.results[0]?.c||0});
  }

  return json({ error:'not found', path },404);
}

export default {
  async fetch(request, env) {
    try {
      const response = await handle(request, env); const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, '') || '/';
      const isWrite = ['POST','PUT','DELETE'].includes(request.method); const isAuth = path.startsWith('/api/auth/'); const isManualSync = path === '/api/google-sheets/sync';
      if (isWrite && !isAuth && !isManualSync && response.status < 400) { try { const syncResult = await syncAllToGoogleSheets(env); if (!syncResult.ok) console.error('Automatic Google Sheets sync failed:', syncResult.error); } catch(error) { console.error('Automatic Google Sheets sync exception:', error?.message || error); } }
      return response;
    } catch(error) { console.error('Worker error:', error?.message || error); return json({error:error?.message || String(error)},500); }
  },
};
