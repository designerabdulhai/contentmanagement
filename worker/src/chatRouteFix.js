import { handleChat } from './chat.js';

const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const VERSION = '2026-09-24-chat-route-fix-v1';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS });

function tokenFromRequest(request) {
  const header = String(request.headers.get('Authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
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
      FROM users WHERE id = ? LIMIT 1
    `).bind(id).first();
    if (!user?.password_hash) return null;

    const expected = await sha256(`${payload}.${String(user.password_hash)}`);
    return expected === parts[1] ? user : null;
  } catch {
    return null;
  }
}

function norm(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[“”‘’]/g, "'")
    .replace(/[।,!?;:()[\]{}"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function has(text, words) {
  const q = norm(text);
  return words.some((word) => q.includes(norm(word)));
}

function dateFromQuestion(question) {
  const q = norm(question);

  const iso = q.match(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;

  const numeric = q.match(/\b(\d{1,2})[-\/](\d{1,2})(?:[-\/](20\d{2}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = numeric[3] ? Number(numeric[3]) : new Date().getFullYear();
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const months = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
    april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
    august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10,
    november: 11, nov: 11, december: 12, dec: 12,
    'জানুয়ারি': 1, 'জানুয়ারি': 1, 'ফেব্রুয়ারি': 2, 'ফেব্রুয়ারি': 2,
    'মার্চ': 3, 'এপ্রিল': 4, 'মে': 5, 'জুন': 6, 'জুলাই': 7,
    'আগস্ট': 8, 'সেপ্টেম্বর': 9, 'অক্টোবর': 10, 'নভেম্বর': 11, 'ডিসেম্বর': 12,
  };

  const monthPattern = Object.keys(months).sort((a, b) => b.length - a.length).join('|');
  const first = q.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthPattern})(?:\\s+(20\\d{2}))?\\b`, 'i'));
  if (first) {
    const day = Number(first[1]);
    const month = months[first[2].toLowerCase()];
    const year = first[3] ? Number(first[3]) : new Date().getFullYear();
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const second = q.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:\\s*,?\\s*(20\\d{2}))?\\b`, 'i'));
  if (second) {
    const month = months[second[1].toLowerCase()];
    const day = Number(second[2]);
    const year = second[3] ? Number(second[3]) : new Date().getFullYear();
    if (month && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  if (has(q, ['আজ', 'আজকে', 'today'])) {
    const now = new Date(Date.now() + 6 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  }

  if (has(q, ['আগামীকাল', 'tomorrow'])) {
    const now = new Date(Date.now() + 6 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  }

  return null;
}

function classify(question) {
  const q = norm(question);
  return {
    schedule: has(q, ['schedule', 'scheduled', 'শিডিউল', 'শিডিউল করা']),
    uploaded: has(q, ['upload', 'uploaded', 'আপলোড']),
    posted: has(q, ['posted', 'post হয়েছে', 'পোস্ট হয়েছে', 'published', 'পোস্ট করা']),
    date: dateFromQuestion(q),
    channel: q.includes('hhd') ? 'HHD' : q.includes('bhd') ? 'BHD' : q.includes('dhd') ? 'DHD' : null,
  };
}

function parseDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T]/);
  return match ? match[1] : null;
}

function formatTime(value) {
  const match = String(value ?? '').trim().match(/[ T](\d{2}:\d{2})/);
  return match ? match[1] : '';
}

function first(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined && String(row[key]).trim()) return String(row[key]).trim();
  }
  return '—';
}

async function exactPostAnswer(request, env, question) {
  const intent = classify(question);
  const looksLikePostQuestion =
    intent.schedule || intent.uploaded || intent.posted || intent.date;

  if (!looksLikePostQuestion) return null;

  const user = await requireAuth(request, env.DB);
  if (!user) return json({ error: 'authentication required' }, 401);

  let sql = `SELECT * FROM posts`;
  const conditions = [];
  const params = [];

  if (intent.schedule) {
    // IMPORTANT: scheduled means the Calendar's Scheduled status only.
    // Having scheduled_at alone is NOT enough.
    conditions.push(`lower(trim(COALESCE(status, ''))) = 'scheduled'`);
  } else if (intent.uploaded) {
    conditions.push(`lower(trim(COALESCE(status, ''))) IN ('uploaded', 'upload')`);
  } else if (intent.posted) {
    conditions.push(`lower(trim(COALESCE(status, ''))) IN ('posted', 'published')`);
  }

  if (intent.date) {
    conditions.push(`substr(CAST(scheduled_at AS TEXT), 1, 10) = ?`);
    params.push(intent.date);
  }

  if (intent.channel) {
    conditions.push(`upper(trim(COALESCE(channel, ''))) = ?`);
    params.push(intent.channel);
  }

  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
  sql += ` ORDER BY scheduled_at ASC, id ASC`;

  const result = await env.DB.prepare(sql).bind(...params).all();
  const rows = result.results || [];

  const label = intent.schedule ? 'scheduled' : intent.uploaded ? 'uploaded' : intent.posted ? 'posted' : 'calendar';
  const dateLabel = intent.date ? ` (${intent.date})` : '';

  if (!rows.length) {
    return json({
      ok: true,
      answer: `Live Calendar data অনুযায়ী ${dateLabel ? dateLabel + ' তারিখে ' : ''}কোনো ${label} post পাওয়া যায়নি।`,
      model: 'deterministic-calendar-d1',
      data_source: 'live_d1',
      assistant_version: VERSION,
    });
  }

  const lines = rows.slice(0, 100).map((row, i) => {
    const name = first(row, ['project_name', 'name', 'title', 'content_name']);
    const channel = first(row, ['channel']);
    const type = first(row, ['content_type', 'type', 'post_type']);
    const status = first(row, ['status']);
    const date = parseDate(row?.scheduled_at) || parseDate(row?.uploaded_at) || parseDate(row?.published_at);
    const time = formatTime(row?.scheduled_at);
    const when = date ? `${date}${time ? ` ${time}` : ''}` : 'date/time not set';
    return `${i + 1}. ${name} [${channel}] — ${type} — ${status} — ${when}`;
  });

  const header = intent.date
    ? `${intent.date} তারিখে মোট ${rows.length}টি ${label} post:`
    : `মোট ${rows.length}টি ${label} post:`;

  return json({
    ok: true,
    answer: `${header}\n${lines.join('\n')}`,
    model: 'deterministic-calendar-d1',
    data_source: 'live_d1',
    assistant_version: VERSION,
  });
}

export async function handleChatRoute(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!env?.DB) return json({ error: 'D1 binding DB is not configured' }, 500);

  // Read a clone so the original request can still be passed to the existing assistant.
  const body = await request.clone().json().catch(() => ({}));
  const question = String(body.message || '').trim();

  try {
    const exact = await exactPostAnswer(request, env, question);
    if (exact) return exact;
  } catch (error) {
    console.error('Exact calendar route failed:', error?.message || error);
    return json({ error: 'calendar data read failed', details: error?.message || String(error), assistant_version: VERSION }, 500);
  }

  return handleChat(request, env);
}
