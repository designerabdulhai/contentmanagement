const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { ...jsonHeaders, ...extra },
});

const noContent = () => new Response(null, { status: 204, headers: jsonHeaders });

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function settingObject(rows) {
  const out = {};
  for (const row of rows) {
    out[row.key] = String(row.value || '').split(',').map(v => v.trim()).filter(Boolean);
  }
  return out;
}

function formatSuggestedDate(value) {
  const date = parseDate(value);
  if (!date) return String(value || '');
  return date.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

const textEncoder = new TextEncoder();
function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function passwordMatches(password, salt, storedHash) {
  if (!salt || !storedHash) return false;
  // Support SHA-256(password + salt) for Worker/D1-compatible credential storage.
  const candidates = [
    await sha256Hex(`${password}${salt}`),
    await sha256Hex(`${salt}${password}`),
    await sha256Hex(password),
  ];
  return candidates.includes(String(storedHash).toLowerCase());
}

function tokenFromRequest(request) {
  const auth = String(request.headers.get('Authorization') || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

async function requireAuth(request, env) {
  const token = tokenFromRequest(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(`
    SELECT s.user_id, s.expires_at, u.id, u.display_name, u.email, u.photo, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')
  `).bind(tokenHash).first();
  return row || null;
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

    const user = await db.prepare(`SELECT id, display_name, email, photo, role, password_hash, password_salt FROM users WHERE lower(email)=?`).bind(email).first();
    if (!user) return json({ error: 'invalid email or password' }, 401);

    const ok = await passwordMatches(password, user.password_salt, user.password_hash);
    if (!ok) return json({ error: 'invalid email or password' }, 401);

    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const token = toBase64Url(tokenBytes);
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    await db.prepare('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES (?, ?, ?)').bind(user.id, tokenHash, expiresAt).run();

    return json({
      token,
      user: { id: user.id, display_name: user.display_name, email: user.email, photo: user.photo, role: user.role },
    });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    const token = tokenFromRequest(request);
    if (token) {
      const tokenHash = await sha256Hex(token);
      try { await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run(); } catch (_) {}
    }
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/api/auth/me') {
    const user = await requireAuth(request, env);
    if (!user) return json({ error: 'authentication required' }, 401);
    return json({ user: { id: user.id, display_name: user.display_name, email: user.email, photo: user.photo, role: user.role } });
  }

  if (path !== '/api/health' && path !== '/api/auth/login' && path !== '/api/auth/logout' && path !== '/api/auth/me') {
    const user = await requireAuth(request, env);
    if (!user) return json({ error: 'authentication required' }, 401);
  }

  if (method === 'GET' && path === '/api/posts') {
    const result = await db.prepare(`SELECT p.*, u.display_name AS owner FROM posts p LEFT JOIN users u ON p.created_by = u.id ORDER BY p.scheduled_at IS NULL, p.scheduled_at`).all();
    return json(result.results || []);
  }

  if (method === 'GET' && path === '/api/posts/project-suggestions') {
    const q = String(url.searchParams.get('query') || '').trim();
    if (!q) return json([]);
    const result = await db.prepare(`SELECT project_name, scheduled_at, channel, status FROM posts WHERE project_name IS NOT NULL AND lower(project_name) LIKE ? ORDER BY scheduled_at IS NULL, scheduled_at DESC`).bind(`%${q.toLowerCase()}%`).all();
    const map = {};
    for (const r of result.results || []) {
      const name = r.project_name;
      if (!map[name]) map[name] = { project_name: name, last_scheduled: [], count: 0 };
      map[name].count += 1;
      if (r.scheduled_at) map[name].last_scheduled.push(r);
    }
    return json(Object.values(map).map(item => {
      const latest = item.last_scheduled[0] || null;
      return {
        project_name: item.project_name,
        count: item.count,
        last_scheduled_at: latest?.scheduled_at || null,
        last_scheduled_dates: item.last_scheduled.slice(0, 5).map(s => ({ scheduled_at: s.scheduled_at, label: formatSuggestedDate(s.scheduled_at), channel: s.channel || '', status: s.status || '' })),
      };
    }));
  }

  if (method === 'POST' && path === '/api/posts/bulk') {
    const p = await body(request);
    if (!p.project_name || !p.start_date) return json({ error: 'project_name and start_date required' }, 400);
    const start = parseDate(p.start_date); const end = p.end_date ? parseDate(p.end_date) : null;
    if (!start || (p.end_date && !end)) return json({ error: 'invalid date' }, 400);
    if (end && end < start) return json({ error: 'end_date must be on or after start_date' }, 400);
    const days = Array.isArray(p.days_of_week) ? p.days_of_week.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : [];
    const maxOccurrences = Math.min(Math.max(Number(p.occurrences) || 365, 1), 1000);
    const statements = []; const cursor = new Date(start); let count = 0;
    while ((end ? cursor <= end : count < maxOccurrences) && count < maxOccurrences) {
      if (days.length === 0 || days.includes(cursor.getDay())) {
        statements.push(db.prepare(`INSERT INTO posts (project_name, content_type, channel, platform, status, scheduled_at, created_by) VALUES (?, ?, ?, ?, 'Scheduled', ?, ?)`)
          .bind(p.project_name, p.content_type || null, p.channel || null, p.platform || null, cursor.toISOString(), p.created_by || null));
        count += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (statements.length) await db.batch(statements);
    const created = await db.prepare(`SELECT * FROM posts WHERE project_name = ? ORDER BY id DESC LIMIT ?`).bind(p.project_name, count).all();
    return json({ created_count: count, created: (created.results || []).reverse() }, 201);
  }

  if (method === 'GET' && path === '/api/templates') return json((await db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all()).results || []);
  if (method === 'POST' && path === '/api/templates') {
    const p = await body(request); if (!p.name) return json({ error: 'name required' }, 400);
    const result = await db.prepare(`INSERT INTO templates (name, content_type, channel, platform, project_id, created_by) VALUES (?, ?, ?, ?, ?, ?)`).bind(p.name, p.content_type || null, p.channel || null, p.platform || null, p.project_id || null, p.created_by || null).run();
    return json(await db.prepare('SELECT * FROM templates WHERE id = ?').bind(result.meta.last_row_id).first(), 201);
  }

  const templateMatch = path.match(/^\/api\/templates\/(\d+)$/);
  if (method === 'DELETE' && templateMatch) {
    const result = await db.prepare('DELETE FROM templates WHERE id = ?').bind(Number(templateMatch[1])).run();
    if (!result.meta.changes) return json({ error: 'template not found' }, 404);
    return json({ ok: true });
  }

  const notesMatch = path.match(/^\/api\/posts\/(\d+)\/notes$/);
  if (notesMatch) {
    const postId = Number(notesMatch[1]);
    if (method === 'GET') return json((await db.prepare(`SELECT pn.*, u.display_name AS user_name FROM post_notes pn LEFT JOIN users u ON pn.user_id = u.id WHERE pn.post_id = ? ORDER BY pn.created_at DESC`).bind(postId).all()).results || []);
    if (method === 'POST') {
      const p = await body(request); if (!String(p.message || '').trim()) return json({ error: 'message required' }, 400);
      const post = await db.prepare('SELECT id FROM posts WHERE id = ?').bind(postId).first(); if (!post) return json({ error: 'post not found' }, 404);
      const result = await db.prepare('INSERT INTO post_notes (post_id, user_id, message) VALUES (?, ?, ?)').bind(postId, p.user_id || null, String(p.message).trim()).run();
      return json(await db.prepare(`SELECT pn.*, u.display_name AS user_name FROM post_notes pn LEFT JOIN users u ON pn.user_id = u.id WHERE pn.id = ?`).bind(result.meta.last_row_id).first(), 201);
    }
  }

  if (method === 'GET' && path === '/api/dashboard/due-soon') return json((await db.prepare(`SELECT p.*, u.display_name AS owner FROM posts p LEFT JOIN users u ON p.created_by = u.id WHERE p.scheduled_at IS NOT NULL AND p.scheduled_at >= datetime('now') AND p.scheduled_at < datetime('now','+7 days') AND (p.status IS NULL OR p.status != 'Uploaded') ORDER BY p.scheduled_at ASC LIMIT 50`).all()).results || []);
  if (method === 'POST' && path === '/api/overdue/check') return json({ updated: (await db.prepare(`UPDATE posts SET is_overdue = CASE WHEN status = 'Scheduled' AND scheduled_at IS NOT NULL AND scheduled_at < datetime('now') THEN 1 ELSE 0 END`).run()).meta.changes });

  if (method === 'POST' && path === '/api/posts') {
    const p = await body(request); if (!p.project_name) return json({ error: 'project_name required' }, 400);
    if (p.scheduled_at && !parseDate(p.scheduled_at)) return json({ error: 'invalid scheduled_at' }, 400);
    const result = await db.prepare(`INSERT INTO posts (project_name, content_type, channel, platform, status, scheduled_at, uploaded_link, notes, created_by, recurring_rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(p.project_name, p.content_type || null, p.channel || null, p.platform || null, p.status || 'Listed', p.scheduled_at || null, p.uploaded_link || null, p.notes || null, p.created_by || null, p.recurring_rule || null).run();
    const row = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(result.meta.last_row_id).first();
    await db.prepare('INSERT INTO audit(post_id, action, payload, actor) VALUES (?, ?, ?, ?)').bind(row.id, 'create', JSON.stringify(row), p.created_by || 'system').run();
    return json(row, 201);
  }

  const postMatch = path.match(/^\/api\/posts\/(\d+)$/);
  if (postMatch) {
    const id = Number(postMatch[1]);
    if (method === 'PUT') {
      const p = await body(request); if (p.scheduled_at && !parseDate(p.scheduled_at)) return json({ error: 'invalid scheduled_at' }, 400);
      if (!(await db.prepare('SELECT id FROM posts WHERE id = ?').bind(id).first())) return json({ error: 'post not found' }, 404);
      await db.prepare(`UPDATE posts SET project_name=?, content_type=?, channel=?, platform=?, status=?, scheduled_at=?, uploaded_link=?, notes=?, recurring_rule=?, updated_at=datetime('now') WHERE id=?`).bind(p.project_name || null, p.content_type || null, p.channel || null, p.platform || null, p.status || null, p.scheduled_at || null, p.uploaded_link || null, p.notes || null, p.recurring_rule || null, id).run();
      const row = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
      await db.prepare('INSERT INTO audit(post_id, action, payload, actor) VALUES (?, ?, ?, ?)').bind(id, 'update', JSON.stringify(row), p.updated_by || 'system').run();
      return json(row);
    }
    if (method === 'DELETE') {
      const row = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first(); if (!row) return json({ error: 'post not found' }, 404);
      const p = await body(request); await db.prepare('INSERT INTO audit(post_id, action, payload, actor) VALUES (?, ?, ?, ?)').bind(id, 'delete', JSON.stringify(row), p.actor || 'system').run(); await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  const duplicateMatch = path.match(/^\/api\/posts\/(\d+)\/duplicate$/);
  if (method === 'POST' && duplicateMatch) {
    const id = Number(duplicateMatch[1]); const row = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first(); if (!row) return json({ error: 'post not found' }, 404);
    const p = await body(request); const result = await db.prepare(`INSERT INTO posts (project_name, content_type, channel, platform, status, scheduled_at, uploaded_link, notes, created_by, recurring_rule) VALUES (?, ?, ?, ?, 'Listed', NULL, NULL, ?, ?, ?)`).bind(row.project_name, row.content_type, row.channel, row.platform, row.notes, p.created_by || row.created_by, row.recurring_rule).run();
    return json(await db.prepare('SELECT * FROM posts WHERE id = ?').bind(result.meta.last_row_id).first(), 201);
  }

  const uploadedMatch = path.match(/^\/api\/posts\/(\d+)\/mark-uploaded$/);
  if (method === 'POST' && uploadedMatch) {
    const id = Number(uploadedMatch[1]); if (!(await db.prepare('SELECT id FROM posts WHERE id = ?').bind(id).first())) return json({ error: 'post not found' }, 404);
    const p = await body(request); await db.prepare("UPDATE posts SET status='Uploaded', uploaded_link=?, is_overdue=0, updated_at=datetime('now') WHERE id=?").bind(p.uploaded_link || null, id).run();
    return json(await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first());
  }

  if (method === 'GET' && path === '/api/settings') return json(settingObject((await db.prepare('SELECT key, value FROM settings').all()).results || []));
  const settingMatch = path.match(/^\/api\/settings\/([a-zA-Z0-9_-]+)$/);
  if (method === 'PUT' && settingMatch) {
    const p = await body(request); const values = Array.isArray(p) ? p.map(v => String(v).trim()).filter(Boolean) : [];
    await db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').bind(settingMatch[1], values.join(',')).run();
    return json({ key: settingMatch[1], values });
  }

  if (method === 'GET' && path === '/api/users') return json((await db.prepare('SELECT id, display_name, email, photo, role, created_at FROM users ORDER BY created_at DESC').all()).results || []);
  if (method === 'POST' && path === '/api/invite') {
    const p = await body(request); const email = String(p.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'valid email required' }, 400);
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); const token = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    const result = await db.prepare('INSERT INTO invites(email, role, token) VALUES (?, ?, ?)').bind(email, p.role || 'manager', token).run();
    return json(await db.prepare('SELECT id, email, role, status, created_at FROM invites WHERE id = ?').bind(result.meta.last_row_id).first(), 201);
  }
  if (method === 'GET' && path === '/api/invites') return json((await db.prepare('SELECT id, email, role, status, created_at FROM invites ORDER BY created_at DESC').all()).results || []);
  if (method === 'GET' && path === '/api/summary') {
    const [total, scheduledWeek, uploadedMonth, listedCount, overdue] = await db.batch([
      db.prepare('SELECT COUNT(*) AS c FROM posts'),
      db.prepare("SELECT COUNT(*) AS c FROM posts WHERE scheduled_at >= datetime('now') AND scheduled_at < datetime('now','+7 days')"),
      db.prepare("SELECT COUNT(*) AS c FROM posts WHERE status='Uploaded' AND strftime('%Y-%m', created_at)=strftime('%Y-%m','now')"),
      db.prepare("SELECT COUNT(*) AS c FROM posts WHERE status='Listed'"),
      db.prepare("SELECT COUNT(*) AS c FROM posts WHERE is_overdue=1"),
    ]);
    return json({ total: total.results[0]?.c || 0, scheduledWeek: scheduledWeek.results[0]?.c || 0, uploadedMonth: uploadedMonth.results[0]?.c || 0, listedCount: listedCount.results[0]?.c || 0, overdue: overdue.results[0]?.c || 0 });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  fetch(request, env) {
    return handle(request, env).catch(err => json({ error: err?.message || 'internal server error' }, 500));
  },
};
