import api from './index.js';

const SCHEDULER_VERSION = '2026-09-02-auto-status-v2';
const DHAKA_OFFSET_MINUTES = 6 * 60;

function isoDhakaNow() {
  const now = new Date(Date.now() + DHAKA_OFFSET_MINUTES * 60 * 1000);
  return now.toISOString().slice(0, 19).replace('T', ' ');
}

function parseScheduledAt(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/Z$|[+-]\d\d:?\d\d$/.test(text)) {
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? null : ms;
  }
  const normalized = text.replace('T', ' ');
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '00'] = match;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 6, Number(mi), Number(s));
}

async function writeAudit(db, postId, action, payload) {
  try {
    await db.prepare(`INSERT INTO audit (post_id, action, payload, actor) VALUES (?, ?, ?, ?)`).bind(postId ?? null, action, JSON.stringify(payload ?? null), 'scheduler').run();
  } catch (error) {
    console.warn('Scheduler audit failed:', error?.message || error);
  }
}

async function runScheduler(env) {
  if (!env?.DB) throw new Error('D1 binding DB is not configured');
  const nowMs = Date.now();
  const rows = await env.DB.prepare(`SELECT id, project_name, content_type, channel, platform, status, scheduled_at, uploaded_link, notes, is_overdue FROM posts WHERE lower(trim(COALESCE(status, ''))) = 'scheduled' AND scheduled_at IS NOT NULL`).all();
  const posts = rows.results || [];
  const result = { ok:true, scheduler_version:SCHEDULER_VERSION, timezone:'Asia/Dhaka', now_dhaka:isoDhakaNow(), checked:posts.length, due:0, updated:0 };
  for (const post of posts) {
    const scheduledMs = parseScheduledAt(post.scheduled_at);
    if (scheduledMs === null) { console.warn('Invalid scheduled_at:', post.id, post.scheduled_at); continue; }
    if (scheduledMs > nowMs) continue;
    result.due += 1;
    const updateResult = await env.DB.prepare(`UPDATE posts SET status='Uploaded', is_overdue=0 WHERE id=? AND lower(trim(COALESCE(status, '')))='scheduled'`).bind(post.id).run();
    const changed = Number(updateResult?.meta?.changes || 0);
    if (changed <= 0) continue;
    result.updated += changed;
    await writeAudit(env.DB, post.id, 'automatic_status_update', { project_name:post.project_name, previous_status:post.status, new_status:'Uploaded', scheduled_at:post.scheduled_at, automatic:true, scheduler_version:SCHEDULER_VERSION });
  }
  console.log(JSON.stringify(result));
  return result;
}

const encoder = new TextEncoder();
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
}
function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g,'+').replace(/_/g,'/');
  return atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
}
async function contentUser(request, db) {
  const header = String(request.headers.get('Authorization') || '');
  if (!header.startsWith('Bearer ')) return null;
  const parts = header.slice(7).trim().split('.');
  if (parts.length !== 2) return null;
  try {
    const payload = base64UrlDecode(parts[0]);
    const [idText, expText] = payload.split('.');
    const id = Number(idText), exp = Number(expText);
    if (!Number.isInteger(id) || !Number.isFinite(exp) || exp <= Math.floor(Date.now()/1000)) return null;
    const user = await db.prepare('SELECT id, display_name, email, photo, role, password_hash FROM users WHERE id=? LIMIT 1').bind(id).first();
    if (!user?.password_hash) return null;
    const expected = await sha256Hex(`${payload}.${String(user.password_hash)}`);
    return expected === parts[1] ? user : null;
  } catch { return null; }
}
async function ensureContentsTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    full_video_status TEXT,
    short_ex_status TEXT,
    short_top_status TEXT,
    style_ex_status TEXT,
    style_top_status TEXT,
    poster_status TEXT,
    full_video TEXT,
    short_ex TEXT,
    short_top TEXT,
    style_ex TEXT,
    style_top TEXT,
    poster TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();
}
async function handleContent(request, env) {
  if (!env?.DB) return new Response(JSON.stringify({error:'D1 binding DB is not configured'}), {status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  const headers = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'};
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  const url = new URL(request.url); const match = url.pathname.replace(/\/+$/,'').match(/^\/api\/contents(?:\/(\d+))?$/);
  if (!match) return api.fetch(request,env);
  const user = await contentUser(request,env.DB);
  if (!user) return new Response(JSON.stringify({error:'authentication required'}),{status:401,headers});
  await ensureContentsTable(env.DB);
  const id = match[1] ? Number(match[1]) : null;
  const method = request.method.toUpperCase();
  if (method === 'GET' && id === null) {
    const result = await env.DB.prepare('SELECT c.*, u.display_name AS owner FROM contents c LEFT JOIN users u ON c.created_by=u.id ORDER BY c.created_at DESC, c.id DESC').all();
    return new Response(JSON.stringify(result.results || []),{status:200,headers});
  }
  if (method === 'POST' && id === null) {
    const payload = await request.json().catch(()=>({})); const name = String(payload.name || '').trim();
    if (!name) return new Response(JSON.stringify({error:'name required'}),{status:400,headers});
    const result = await env.DB.prepare(`INSERT INTO contents (name,full_video_status,short_ex_status,short_top_status,style_ex_status,style_top_status,poster_status,full_video,short_ex,short_top,style_ex,style_top,poster,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(name,payload.full_video_status||null,payload.short_ex_status||null,payload.short_top_status||null,payload.style_ex_status||null,payload.style_top_status||null,payload.poster_status||null,payload.full_video||null,payload.short_ex||null,payload.short_top||null,payload.style_ex||null,payload.style_top||null,payload.poster||null,user.id).run();
    const row = await env.DB.prepare('SELECT * FROM contents WHERE id=?').bind(result.meta.last_row_id).first();
    return new Response(JSON.stringify(row),{status:201,headers});
  }
  if (id !== null && method === 'GET') {
    const row = await env.DB.prepare('SELECT c.*, u.display_name AS owner FROM contents c LEFT JOIN users u ON c.created_by=u.id WHERE c.id=? LIMIT 1').bind(id).first();
    return row ? new Response(JSON.stringify(row),{status:200,headers}) : new Response(JSON.stringify({error:'content not found',id}),{status:404,headers});
  }
  if (id !== null && method === 'PUT') {
    const payload = await request.json().catch(()=>({})); const existing = await env.DB.prepare('SELECT * FROM contents WHERE id=? LIMIT 1').bind(id).first();
    if (!existing) return new Response(JSON.stringify({error:'content not found',id}),{status:404,headers});
    const name = String(payload.name ?? existing.name ?? '').trim(); if (!name) return new Response(JSON.stringify({error:'name required'}),{status:400,headers});
    await env.DB.prepare(`UPDATE contents SET name=?,full_video_status=?,short_ex_status=?,short_top_status=?,style_ex_status=?,style_top_status=?,poster_status=?,full_video=?,short_ex=?,short_top=?,style_ex=?,style_top=?,poster=?,updated_at=datetime('now') WHERE id=?`).bind(name,payload.full_video_status??existing.full_video_status,payload.short_ex_status??existing.short_ex_status,payload.short_top_status??existing.short_top_status,payload.style_ex_status??existing.style_ex_status,payload.style_top_status??existing.style_top_status,payload.poster_status??existing.poster_status,payload.full_video??existing.full_video,payload.short_ex??existing.short_ex,payload.short_top??existing.short_top,payload.style_ex??existing.style_ex,payload.style_top??existing.style_top,payload.poster??existing.poster,id).run();
    const row = await env.DB.prepare('SELECT * FROM contents WHERE id=?').bind(id).first(); return new Response(JSON.stringify(row),{status:200,headers});
  }
  if (id !== null && method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM contents WHERE id=?').bind(id).run();
    return result.meta.changes > 0 ? new Response(JSON.stringify({ok:true,deleted:true,id}),{status:200,headers}) : new Response(JSON.stringify({error:'content not found',id}),{status:404,headers});
  }
  return new Response(JSON.stringify({error:'method not allowed'}),{status:405,headers});
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname.replace(/\/+$/,'') || '/';
    if (pathname === '/api/contents' || /^\/api\/contents\/\d+$/.test(pathname)) return handleContent(request,env);
    return api.fetch(request,env,ctx);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduler(env).catch((error)=>console.error('Automatic scheduled status update failed:',error?.message||error)));
  },
};

export { runScheduler };
