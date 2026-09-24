const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function empty() {
  return new Response(null, { status: 204, headers: CORS });
}

function tokenFromRequest(request) {
  const header = String(request.headers.get('Authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value))
  );
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
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

    if (!Number.isInteger(id) || !Number.isFinite(exp)) return null;
    if (exp <= Math.floor(Date.now() / 1000)) return null;

    const user = await db.prepare(`
      SELECT id, display_name, email, photo, role, password_hash
      FROM users
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

    if (!user?.password_hash) return null;

    const expected = await sha256(`${payload}.${String(user.password_hash)}`);
    return expected === parts[1] ? user : null;
  } catch {
    return null;
  }
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

async function contentColumns(db) {
  const result = await db.prepare('PRAGMA table_info(contents)').all();
  return new Set((result.results || []).map((row) => String(row.name)));
}

const WRITABLE_FIELDS = [
  'name',
  'channel',
  'emergency',
  'full_video_status',
  'short_ex_status',
  'short_top_status',
  'style_ex_status',
  'style_top_status',
  'poster_status',
  'full_video',
  'short_ex',
  'short_top',
  'style_ex',
  'style_top',
  'poster',
  'document_link',
  'file_path',
];

function valueFor(field, payload) {
  if (field === 'emergency') return Number(payload?.[field]) === 1 ? 1 : 0;
  const value = payload?.[field];
  return value === undefined || value === '' ? null : value;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// Do not JOIN users here. The Content screen only needs the contents rows,
// and the existing D1 database can contain older contents schemas where the
// optional owner relationship is not available. A simple SELECT keeps the
// list endpoint compatible with the real production D1 schema.
async function listContents(db) {
  // Read the actual D1 schema so older databases remain readable while the
  // migration is being rolled out.
  const columns = await contentColumns(db);
  const hasCreatedAt = columns.has('created_at');
  const orderBy = hasCreatedAt ? 'created_at DESC, id DESC' : 'id DESC';

  const result = await db.prepare(`
    SELECT *
    FROM contents
    ORDER BY ${orderBy}
  `).all();

  return json(result.results || []);
}

async function createContent(request, db, user) {
  const payload = await readBody(request);
  const name = String(payload?.name || '').trim();

  if (!name) return json({ error: 'name required' }, 400);

  const columns = await contentColumns(db);
  if (!columns.has('name')) {
    return json({ error: 'contents table is missing the name column' }, 500);
  }

  const fields = WRITABLE_FIELDS.filter((field) => columns.has(field));
  if (columns.has('created_by')) fields.push('created_by');

  const values = fields.map((field) =>
    field === 'name' ? name :
    field === 'created_by' ? user.id :
    valueFor(field, payload)
  );

  const placeholders = fields.map(() => '?').join(', ');

  const result = await db.prepare(`
    INSERT INTO contents (${fields.map(quoteIdent).join(', ')})
    VALUES (${placeholders})
  `).bind(...values).run();

  const row = await db.prepare('SELECT * FROM contents WHERE id = ? LIMIT 1')
    .bind(result.meta.last_row_id)
    .first();

  return json(row, 201);
}

async function updateContent(request, db, user, id) {
  const payload = await readBody(request);
  const existing = await db.prepare('SELECT * FROM contents WHERE id = ? LIMIT 1')
    .bind(id)
    .first();

  if (!existing) return json({ error: 'content not found', id }, 404);

  const columns = await contentColumns(db);
  const fields = WRITABLE_FIELDS.filter((field) => columns.has(field));

  if (columns.has('name')) {
    const nextName = String(payload?.name ?? existing.name ?? '').trim();
    if (!nextName) return json({ error: 'name required' }, 400);
  }

  const sets = [];
  const values = [];

  for (const field of fields) {
    sets.push(`${quoteIdent(field)} = ?`);
    values.push(
      field === 'name'
        ? String(payload?.name ?? existing.name ?? '').trim()
        : payload?.[field] === undefined
          ? existing[field]
          : valueFor(field, payload)
    );
  }

  if (columns.has('updated_at')) {
    sets.push('updated_at = datetime(\'now\')');
  }

  if (!sets.length) return json({ error: 'no writable content fields found' }, 500);

  values.push(id);

  await db.prepare(`
    UPDATE contents
    SET ${sets.join(', ')}
    WHERE id = ?
  `).bind(...values).run();

  const row = await db.prepare('SELECT * FROM contents WHERE id = ? LIMIT 1')
    .bind(id)
    .first();

  return json(row);
}

async function deleteContent(db, id) {
  const result = await db.prepare('DELETE FROM contents WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return json({ error: 'content not found', id }, 404);
  return json({ ok: true, deleted: true, id });
}

export async function handleContents(request, env) {
  if (request.method === 'OPTIONS') return empty();
  if (!env?.DB) return json({ error: 'D1 binding DB is not configured' }, 500);

  const user = await requireAuth(request, env.DB);
  if (!user) return json({ error: 'authentication required' }, 401);

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const match = pathname.match(/^\/(?:api\/)?contents(?:\/(\d+))?$/);

  if (!match) return json({ error: 'not found' }, 404);

  const id = match[1] ? Number(match[1]) : null;
  const method = request.method.toUpperCase();

  try {
    if (!id && method === 'GET') return await listContents(env.DB);
    if (!id && method === 'POST') return await createContent(request, env.DB, user);
    if (id && method === 'PUT') return await updateContent(request, env.DB, user, id);
    if (id && method === 'DELETE') return await deleteContent(env.DB, id);

    return json({ error: 'method not allowed' }, 405);
  } catch (error) {
    console.error('Contents API error:', error?.message || error);
    return json({
      error: 'content request failed',
      message: error?.message || String(error),
    }, 500);
  }
}
