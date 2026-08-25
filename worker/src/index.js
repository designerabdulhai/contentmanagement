/*
 * Content Management API
 * Cloudflare Worker + D1
 *
 * IMPORTANT:
 * - ES Module Worker: export default is at the bottom.
 * - D1 binding name must be DB.
 * - Existing D1 data is NOT deleted, reset, migrated, or recreated.
 * - Google Sheets sync is kept in this same file so there is no module import.
 */

const WORKER_VERSION = '2026-08-25-esm-stable-v6';
const GOOGLE_SHEETS_SYNC_VERSION = '2026-08-25-v4';

const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS,
  });
}

function empty() {
  return new Response(null, {
    status: 204,
    headers: CORS,
  });
}

async function readJson(request) {
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
  const header = String(
    request.headers.get('Authorization') || ''
  );

  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
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
    normalized +
      '='.repeat((4 - (normalized.length % 4)) % 4)
  );
}

async function passwordMatches(password, salt, storedHash) {
  const p = String(password ?? '');
  const s = String(salt ?? '').trim();
  const h = String(storedHash ?? '').trim().toLowerCase();

  if (!p || !h) return false;

  const salted = await sha256Hex(`${p}${s}`);
  if (salted.toLowerCase() === h) return true;

  const plain = await sha256Hex(p);
  return plain.toLowerCase() === h;
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

    if (!Number.isInteger(id)) return null;
    if (!Number.isFinite(exp)) return null;
    if (exp <= Math.floor(Date.now() / 1000)) return null;

    const user = await db
      .prepare(`
        SELECT
          id,
          display_name,
          email,
          photo,
          role,
          password_hash
        FROM users
        WHERE id = ?
        LIMIT 1
      `)
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

async function writeAudit(db, postId, action, payload, actor) {
  try {
    await db
      .prepare(`
        INSERT INTO audit
        (post_id, action, payload, actor)
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        postId ?? null,
        action,
        JSON.stringify(payload ?? null),
        actor || 'system'
      )
      .run();
  } catch {
    // Audit must never break the primary request.
  }
}

function normalizePath(pathname) {
  let path = String(pathname || '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '') || '/';

  if (!path.startsWith('/api')) {
    path = `/api${path}`;
  }

  return path;
}

function settingsObject(rows) {
  const output = {};

  for (const row of rows || []) {
    output[row.key] = String(row.value || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return output;
}

async function syncAllToGoogleSheets(env, actor = null) {
  const webhook = String(env.GSHEET_WEBHOOK_URL || '').trim();
  const secret = String(env.GSHEET_SYNC_SECRET || '').trim();

  if (!env.DB || !webhook || !secret) {
    return {
      ok: false,
      version: GOOGLE_SHEETS_SYNC_VERSION,
      error: 'Google Sheets sync is not configured',
    };
  }

  const queries = {
    posts: 'SELECT * FROM posts',
    templates: 'SELECT * FROM templates',
    settings: 'SELECT * FROM settings',
    invites: 'SELECT * FROM invites',
    audit: 'SELECT * FROM audit',
    users: `
      SELECT
        id,
        display_name,
        email,
        photo,
        role,
        created_at
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
      actor,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Google Apps Script HTTP ${response.status}: ${text.slice(0, 1000)}`
    );
  }

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    result = { raw: text.slice(0, 1000) };
  }

  if (result?.ok === false) {
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
}

async function handle(request, env) {
  if (request.method === 'OPTIONS') {
    return empty();
  }

  if (!env?.DB) {
    return json(
      {
        error: 'D1 binding DB is not configured',
        worker: 'contentmanagement-api',
        version: WORKER_VERSION,
      },
      500
    );
  }

  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();
  const db = env.DB;

  // -------------------------------------------------------
  // PUBLIC HEALTH
  // -------------------------------------------------------
  if (method === 'GET' && path === '/api/health') {
    try {
      await db.prepare('SELECT 1 AS ok').first();

      return json({
        ok: true,
        database: 'D1',
        worker: 'contentmanagement-api',
        version: WORKER_VERSION,
      });
    } catch (error) {
      return json(
        {
          ok: false,
          database: 'D1',
          worker: 'contentmanagement-api',
          version: WORKER_VERSION,
          error: error?.message || String(error),
        },
        500
      );
    }
  }

  // -------------------------------------------------------
  // LOGIN
  // -------------------------------------------------------
  if (method === 'POST' && path === '/api/auth/login') {
    const payload = await readJson(request);
    const email = String(payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '');

    if (!email || !password) {
      return json(
        { error: 'email and password required' },
        400
      );
    }

    const user = await db
      .prepare(`
        SELECT
          id,
          display_name,
          email,
          photo,
          role,
          password_hash,
          password_salt
        FROM users
        WHERE lower(trim(email)) = ?
        LIMIT 1
      `)
      .bind(email)
      .first();

    if (!user) {
      return json(
        { error: 'invalid email or password' },
        401
      );
    }

    const valid = await passwordMatches(
      password,
      user.password_salt,
      user.password_hash
    );

    if (!valid) {
      return json(
        { error: 'invalid email or password' },
        401
      );
    }

    const token = await createAuthToken(user);

    return json({
      ok: true,
      token,
      user: {
        id: user.id,
        display_name: user.display_name,
        email: user.email,
        photo: user.photo,
        role: user.role,
      },
    });
  }

  // -------------------------------------------------------
  // AUTH ME
  // -------------------------------------------------------
  if (method === 'GET' && path === '/api/auth/me') {
    const user = await requireAuth(request, db);

    if (!user) {
      return json(
        { error: 'authentication required' },
        401
      );
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

  // -------------------------------------------------------
  // LOGOUT
  // -------------------------------------------------------
  if (method === 'POST' && path === '/api/auth/logout') {
    return json({ ok: true });
  }

  // Everything else is protected.
  const user = await requireAuth(request, db);

  if (!user) {
    return json(
      { error: 'authentication required' },
      401
    );
  }

  // -------------------------------------------------------
  // POSTS - LIST
  // -------------------------------------------------------
  if (method === 'GET' && path === '/api/posts') {
    const result = await db
      .prepare(`
        SELECT
          p.*,
          u.display_name AS owner
        FROM posts p
        LEFT JOIN users u
          ON p.created_by = u.id
        ORDER BY
          p.scheduled_at IS NULL,
          p.scheduled_at
      `)
      .all();

    return json(result.results || []);
  }

  // -------------------------------------------------------
  // CREATE POST
  // -------------------------------------------------------
  if (method === 'POST' && path === '/api/posts') {
    const payload = await readJson(request);

    if (!String(payload.project_name || '').trim()) {
      return json(
        { error: 'project_name required' },
        400
      );
    }

    const result = await db
      .prepare(`
        INSERT INTO posts
        (
          project_name,
          content_type,
          channel,
          platform,
          status,
          scheduled_at,
          uploaded_link,
          notes,
          created_by,
          recurring_rule
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        payload.project_name,
        payload.content_type || null,
        payload.channel || null,
        payload.platform || null,
        payload.status || 'Listed',
        payload.scheduled_at || null,
        payload.uploaded_link || null,
        payload.notes || null,
        user.id,
        payload.recurring_rule || null
      )
      .run();

    const row = await db
      .prepare('SELECT * FROM posts WHERE id = ?')
      .bind(result.meta.last_row_id)
      .first();

    await writeAudit(
      db,
      row?.id,
      'create',
      row,
      user.email
    );

    return json(row, 201);
  }

  // -------------------------------------------------------
  // POST DELETE
  // POST /api/posts/:id/delete
  // POST /api/posts/:id/remove
  // -------------------------------------------------------
  const postDeleteMatch = path.match(
    /^\/api\/posts\/(\d+)\/(delete|remove)$/
  );

  if (
    method === 'POST' &&
    postDeleteMatch
  ) {
    const id = Number(postDeleteMatch[1]);

    const row = await db
      .prepare('SELECT * FROM posts WHERE id = ? LIMIT 1')
      .bind(id)
      .first();

    if (!row) {
      return json(
        { error: 'post not found', id },
        404
      );
    }

    await writeAudit(
      db,
      id,
      'delete',
      row,
      user.email
    );

    await db
      .prepare('DELETE FROM posts WHERE id = ?')
      .bind(id)
      .run();

    return json({
      ok: true,
      deleted: true,
      id,
    });
  }

  // -------------------------------------------------------
  // SINGLE POST
  // GET /api/posts/:id
  // PUT /api/posts/:id
  // DELETE /api/posts/:id
  // -------------------------------------------------------
  const singlePostMatch = path.match(
    /^\/api\/posts\/(\d+)$/
  );

  if (singlePostMatch) {
    const id = Number(singlePostMatch[1]);

    if (method === 'GET') {
      const row = await db
        .prepare(`
          SELECT
            p.*,
            u.display_name AS owner
          FROM posts p
          LEFT JOIN users u
            ON p.created_by = u.id
          WHERE p.id = ?
          LIMIT 1
        `)
        .bind(id)
        .first();

      return row
        ? json(row)
        : json(
            { error: 'post not found', id },
            404
          );
    }

    if (method === 'PUT') {
      const payload = await readJson(request);

      const existing = await db
        .prepare('SELECT * FROM posts WHERE id = ? LIMIT 1')
        .bind(id)
        .first();

      if (!existing) {
        return json(
          { error: 'post not found', id },
          404
        );
      }

      await db
        .prepare(`
          UPDATE posts
          SET
            project_name = ?,
            content_type = ?,
            channel = ?,
            platform = ?,
            status = ?,
            scheduled_at = ?,
            uploaded_link = ?,
            notes = ?,
            recurring_rule = ?
          WHERE id = ?
        `)
        .bind(
          payload.project_name ?? existing.project_name,
          payload.content_type ?? existing.content_type,
          payload.channel ?? existing.channel,
          payload.platform ?? existing.platform,
          payload.status ?? existing.status,
          payload.scheduled_at ?? existing.scheduled_at,
          payload.uploaded_link ?? existing.uploaded_link,
          payload.notes ?? existing.notes,
          payload.recurring_rule ?? existing.recurring_rule,
          id
        )
        .run();

      const updated = await db
        .prepare('SELECT * FROM posts WHERE id = ?')
        .bind(id)
        .first();

      await writeAudit(
        db,
        id,
        'update',
        updated,
        user.email
      );

      return json(updated);
    }

    if (method === 'DELETE') {
      const row = await db
        .prepare('SELECT * FROM posts WHERE id = ? LIMIT 1')
        .bind(id)
        .first();

      if (!row) {
        return json(
          { error: 'post not found', id },
          404
        );
      }

      await writeAudit(
        db,
        id,
        'delete',
        row,
        user.email
      );

      const result = await db
        .prepare('DELETE FROM posts WHERE id = ?')
        .bind(id)
        .run();

      return json({
        ok: result.meta.changes > 0,
        deleted: true,
        id,
      });
    }
  }

  // -------------------------------------------------------
  // SETTINGS
  // -------------------------------------------------------
  if (method === 'GET' && path === '/api/settings') {
    const result = await db
      .prepare('SELECT key, value FROM settings')
      .all();

    return json(settingsObject(result.results || []));
  }

  // -------------------------------------------------------
  // TEMPLATES
  // -------------------------------------------------------
  if (method === 'GET' && path === '/api/templates') {
    const result = await db
      .prepare(`
        SELECT *
        FROM templates
        ORDER BY created_at DESC
      `)
      .all();

    return json(result.results || []);
  }

  // -------------------------------------------------------
  // USERS
  // -------------------------------------------------------
  if (method === 'GET' && path === '/api/users') {
    const result = await db
      .prepare(`
        SELECT
          id,
          display_name,
          email,
          photo,
          role,
          created_at
        FROM users
        ORDER BY created_at DESC
      `)
      .all();

    return json(result.results || []);
  }

  // -------------------------------------------------------
  // INVITES
  // -------------------------------------------------------
  if (method === 'GET' && path === '/api/invites') {
    const result = await db
      .prepare(`
        SELECT
          id,
          email,
          role,
          status,
          created_at
        FROM invites
        ORDER BY created_at DESC
      `)
      .all();

    return json(result.results || []);
  }

  // -------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------
  if (method === 'GET' && path === '/api/summary') {
    const [total, scheduled, uploaded, listed, overdue] =
      await db.batch([
        db.prepare('SELECT COUNT(*) AS c FROM posts'),
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM posts
          WHERE scheduled_at >= datetime('now')
            AND scheduled_at < datetime('now', '+7 days')
        `),
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM posts
          WHERE status = 'Uploaded'
        `),
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM posts
          WHERE status = 'Listed'
        `),
        db.prepare(`
          SELECT COUNT(*) AS c
          FROM posts
          WHERE is_overdue = 1
        `),
      ]);

    return json({
      total: total.results?.[0]?.c || 0,
      scheduledWeek: scheduled.results?.[0]?.c || 0,
      uploaded: uploaded.results?.[0]?.c || 0,
      listedCount: listed.results?.[0]?.c || 0,
      overdue: overdue.results?.[0]?.c || 0,
    });
  }

  // -------------------------------------------------------
  // GOOGLE SHEETS SYNC
  // -------------------------------------------------------
  if (
    method === 'POST' &&
    path === '/api/google-sheets/sync'
  ) {
    try {
      const result = await syncAllToGoogleSheets(
        env,
        user.email
      );

      return json(
        result,
        result.ok ? 200 : 502
      );
    } catch (error) {
      return json(
        {
          ok: false,
          error: error?.message || String(error),
        },
        502
      );
    }
  }

  // -------------------------------------------------------
  // FALLBACK
  // -------------------------------------------------------
  return json(
    {
      error: 'not found',
      path,
      method,
      worker: 'contentmanagement-api',
      version: WORKER_VERSION,
    },
    404
  );
}

/* =========================================================
   ES MODULE WORKER ENTRY POINT
   DO NOT REMOVE THIS.
========================================================= */
export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (error) {
      console.error(
        'Worker error:',
        error?.message || error
      );

      return json(
        {
          ok: false,
          error: 'internal server error',
          message: error?.message || String(error),
          worker: 'contentmanagement-api',
          version: WORKER_VERSION,
        },
        500
      );
    }
  },
};
