const WORKER_VERSION = '2026-08-25-stable-v3';
const GOOGLE_SHEETS_SYNC_VERSION = '2026-08-25-v3';

const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS });

const noContent = () => new Response(null, { status: 204, headers: CORS });

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

const encoder = new TextEncoder();

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(String(value))
  );

  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function tokenFromRequest(request) {
  const auth = String(request.headers.get('Authorization') || '');
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function base64UrlEncode(value) {
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  return atob(
    normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  );
}

async function passwordMatches(password, salt, storedHash) {
  const p = String(password ?? '');
  const s = String(salt ?? '').trim();
  const h = String(storedHash ?? '').trim().toLowerCase();

  if (!p || !h) return false;

  return (await sha256Hex(p + s)).toLowerCase() === h;
}

async function createAuthToken(user) {
  const expires = Math.floor(Date.now() / 1000) + 7 * 86400;
  const payload = `${user.id}.${expires}`;
  const signature = await sha256Hex(
    `${payload}.${String(user.password_hash || '')}`
  );

  return `${base64UrlEncode(payload)}.${signature}`;
}

async function requireAuth(request, db) {
  const token = tokenFromRequest(request);
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  try {
    const payload = base64UrlDecode(parts[0]);
    const [idText, expText] = payload.split('.');
    const id = Number(idText);
    const exp = Number(expText);

    if (
      !Number.isInteger(id) ||
      !Number.isFinite(exp) ||
      exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    const user = await db
      .prepare(
        `SELECT id,display_name,email,photo,role,password_hash
         FROM users WHERE id=? LIMIT 1`
      )
      .bind(id)
      .first();

    if (!user?.password_hash) return null;

    const expected = await sha256Hex(
      `${payload}.${String(user.password_hash)}`
    );

    return expected === parts[1] ? user : null;
  } catch {
    return null;
  }
}

function settingsObject(rows) {
  const out = {};

  for (const row of rows) {
    out[row.key] = String(row.value || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return out;
}

// Google Sheets sync is intentionally kept inside this single Worker file.
// This avoids the previous missing googleSheets.js module problem.
async function syncAllToGoogleSheets(env, options = {}) {
  const webhook = String(env.GSHEET_WEBHOOK_URL || '').trim();
  const secret = String(env.GSHEET_SYNC_SECRET || '').trim();

  if (!env.DB || !webhook || !secret) {
    return {
      ok: false,
      version: GOOGLE_SHEETS_SYNC_VERSION,
      error: 'Google Sheets sync is not configured',
    };
  }

  try {
    const queries = {
      posts: 'SELECT * FROM posts',
      templates: 'SELECT * FROM templates',
      settings: 'SELECT * FROM settings',
      invites: 'SELECT * FROM invites',
      audit: 'SELECT * FROM audit',
      users: `
        SELECT id,display_name,email,photo,role,created_at
        FROM users
      `,
    };

    const tables = {};

    for (const [name, sql] of Object.entries(queries)) {
      try {
        const result = await env.DB.prepare(sql).all();
        tables[name] = result.results || [];
      } catch (error) {
        if (['templates', 'settings', 'invites', 'audit'].includes(name)) {
          console.warn(`Skipping ${name}:`, error?.message || error);
          continue;
        }
        throw error;
      }
    }

    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        secret,
        tables,
        version: GOOGLE_SHEETS_SYNC_VERSION,
        mode: options.mode || 'manual',
        actor: options.actor || null,
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Google Apps Script HTTP ${response.status}: ${responseText.slice(0, 1000)}`
      );
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { raw: responseText.slice(0, 1000) };
    }

    if (result && result.ok === false) {
      throw new Error(
        result.error || 'Google Apps Script rejected the sync'
      );
    }

    return {
      ok: true,
      version: GOOGLE_SHEETS_SYNC_VERSION,
      tables: Object.keys(tables),
      counts: Object.fromEntries(
        Object.entries(tables).map(([name, rows]) => [name, rows.length])
      ),
      response: result,
    };
  } catch (error) {
    console.error(
      'Google Sheets sync failed:',
      error?.message || error
    );

    return {
      ok: false,
      version: GOOGLE_SHEETS_SYNC_VERSION,
      error: error?.message || String(error),
    };
  }
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') return noContent();

  if (!env.DB) {
    return json({ error: 'D1 binding DB is not configured' }, 500);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const db = env.DB;

  // Public health endpoints.
  if (method === 'GET' && path === '/') {
    return json({
      ok: true,
      service: 'contentmanagement-api',
      database: 'D1',
      version: WORKER_VERSION,
    });
  }

  if (method === 'GET' && path === '/api/health') {
    return json({
      ok: true,
      database: 'D1',
      worker: 'contentmanagement-api',
      version: WORKER_VERSION,
      routes: {
        login: 'POST /api/auth/login',
        posts: 'GET /api/posts',
        createPost: 'POST /api/posts',
        updatePost: 'PUT /api/posts/:id',
        deletePost: 'DELETE /api/posts/:id',
        deletePostPost: 'POST /api/posts/:id/delete',
      },
    });
  }

  // Login.
  if (method === 'POST' && path === '/api/auth/login') {
    const p = await body(request);
    const email = String(p.email || '').trim().toLowerCase();
    const password = String(p.password || '');

    if (!email || !password) {
      return json({ error: 'email and password required' }, 400);
    }

    const user = await db
      .prepare(
        `SELECT id,display_name,email,photo,role,password_hash,password_salt
         FROM users
         WHERE lower(trim(email))=?
         LIMIT 1`
      )
      .bind(email)
      .first();

    if (
      !user ||
      !(await passwordMatches(
        password,
        user.password_salt,
        user.password_hash
      ))
    ) {
      return json({ error: 'invalid email or password' }, 401);
    }

    return json({
      ok: true,
      token: await createAuthToken(user),
      user: {
        id: user.id,
        display_name: user.display_name,
        email: user.email,
        photo: user.photo,
        role: user.role,
      },
    });
  }

  if (method === 'GET' && path === '/api/auth/me') {
    const user = await requireAuth(request, db);

    if (!user) {
      return json({ error: 'authentication required' }, 401);
    }

    return json({
      user: {
        id: user.id,
        display_name: user.display_name,
        email: user.email,
        photo: user.photo,
        role: user.role,
      },
    });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    return json({ ok: true });
  }

  // Google Sheets.
  if (method === 'POST' && path === '/api/google-sheets/sync') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error: 'authentication required' }, 401);

    const result = await syncAllToGoogleSheets(env, {
      mode: 'manual',
      actor: user.email,
    });

    return json(result, result.ok ? 200 : 502);
  }

  // List posts.
  if (method === 'GET' && path === '/api/posts') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error: 'authentication required' }, 401);

    const result = await db
      .prepare(
        `SELECT p.*, u.display_name AS owner
         FROM posts p
         LEFT JOIN users u ON p.created_by=u.id
         ORDER BY p.scheduled_at IS NULL, p.scheduled_at`
      )
      .all();

    return json(result.results || []);
  }

  // Create post.
  if (method === 'POST' && path === '/api/posts') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error: 'authentication required' }, 401);

    const p = await body(request);

    if (!p.project_name) {
      return json({ error: 'project_name required' }, 400);
    }

    const result = await db
      .prepare(
        `INSERT INTO posts
        (project_name,content_type,channel,platform,status,scheduled_at,
         uploaded_link,notes,created_by,recurring_rule)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        p.project_name,
        p.content_type || null,
        p.channel || null,
        p.platform || null,
        p.status || 'Listed',
        p.scheduled_at || null,
        p.uploaded_link || null,
        p.notes || null,
        user.id,
        p.recurring_rule || null
      )
      .run();

    const row = await db
      .prepare('SELECT * FROM posts WHERE id=?')
      .bind(result.meta.last_row_id)
      .first();

    return json(row, 201);
  }

  // Post ID actions. Supports both /api/posts/:id and /posts/:id so
  // an upstream rewrite cannot break delete/update operations.
  const postActionMatch = path.match(
    /(?:^|\/)posts\/(\d+)(?:\/(delete|remove))?$/
  );

  if (postActionMatch) {
    const id = Number(postActionMatch[1]);
    const action = postActionMatch[2] || '';
    const user = await requireAuth(request, db);

    if (!user) {
      return json({ error: 'authentication required' }, 401);
    }

    // DELETE /api/posts/:id
    // POST  /api/posts/:id/delete
    // POST  /api/posts/:id/remove
    if (
      (method === 'DELETE' && !action) ||
      (method === 'POST' && (action === 'delete' || action === 'remove'))
    ) {
      const existing = await db
        .prepare('SELECT id FROM posts WHERE id=? LIMIT 1')
        .bind(id)
        .first();

      if (!existing) {
        return json({ error: 'post not found', id }, 404);
      }

      await db.prepare('DELETE FROM posts WHERE id=?').bind(id).run();

      return json({
        ok: true,
        deleted: true,
        id,
      });
    }

    // GET /api/posts/:id
    if (method === 'GET' && !action) {
      const row = await db
        .prepare(
          `SELECT p.*,u.display_name AS owner
           FROM posts p
           LEFT JOIN users u ON p.created_by=u.id
           WHERE p.id=?
           LIMIT 1`
        )
        .bind(id)
        .first();

      return row
        ? json(row)
        : json({ error: 'post not found', id }, 404);
    }

    // PUT /api/posts/:id
    if (method === 'PUT' && !action) {
      const p = await body(request);

      const existing = await db
        .prepare('SELECT * FROM posts WHERE id=? LIMIT 1')
        .bind(id)
        .first();

      if (!existing) {
        return json({ error: 'post not found', id }, 404);
      }

      await db
        .prepare(
          `UPDATE posts SET
           project_name=?,
           content_type=?,
           channel=?,
           platform=?,
           status=?,
           scheduled_at=?,
           uploaded_link=?,
           notes=?,
           recurring_rule=?
           WHERE id=?`
        )
        .bind(
          p.project_name ?? existing.project_name,
          p.content_type ?? existing.content_type,
          p.channel ?? existing.channel,
          p.platform ?? existing.platform,
          p.status ?? existing.status,
          p.scheduled_at ?? existing.scheduled_at,
          p.uploaded_link ?? existing.uploaded_link,
          p.notes ?? existing.notes,
          p.recurring_rule ?? existing.recurring_rule,
          id
        )
        .run();

      return json(
        await db.prepare('SELECT * FROM posts WHERE id=?').bind(id).first()
      );
    }
  }

  if (method === 'GET' && path === '/api/settings') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error: 'authentication required' }, 401);

    const result = await db.prepare('SELECT key,value FROM settings').all();
    return json(settingsObject(result.results || []));
  }

  if (method === 'GET' && path === '/api/templates') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error: 'authentication required' }, 401);

    const result = await db
      .prepare('SELECT * FROM templates ORDER BY created_at DESC')
      .all();

    return json(result.results || []);
  }

  if (method === 'GET' && path === '/api/users') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error: 'authentication required' }, 401);

    const result = await db
      .prepare(
        `SELECT id,display_name,email,photo,role,created_at
         FROM users ORDER BY created_at DESC`
      )
      .all();

    return json(result.results || []);
  }

  if (method === 'GET' && path === '/api/invites') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error: 'authentication required' }, 401);

    const result = await db
      .prepare(
        `SELECT id,email,role,status,created_at
         FROM invites ORDER BY created_at DESC`
      )
      .all();

    return json(result.results || []);
  }

  if (method === 'GET' && path === '/api/summary') {
    const user = await requireAuth(request, db);
    if (!user) return json({ error: 'authentication required' }, 401);

    const [a, b, c, d, e] = await db.batch([
      db.prepare('SELECT COUNT(*) AS c FROM posts'),
      db.prepare(
        `SELECT COUNT(*) AS c FROM posts
         WHERE scheduled_at>=datetime('now')
         AND scheduled_at<datetime('now','+7 days')`
      ),
      db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE status='Uploaded'`),
      db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE status='Listed'`),
      db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE is_overdue=1`),
    ]);

    return json({
      total: a.results[0]?.c || 0,
      scheduledWeek: b.results[0]?.c || 0,
      uploadedMonth: c.results[0]?.c || 0,
      listedCount: d.results[0]?.c || 0,
      overdue: e.results[0]?.c || 0,
    });
  }

  return json({ error: 'not found', path, method }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error('Worker error:', error?.message || error);
      return json(
        { error: error?.message || String(error), worker: WORKER_VERSION },
        500
      );
    }
  },
};
