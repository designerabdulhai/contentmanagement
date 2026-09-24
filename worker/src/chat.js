const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const CHAT_VERSION = '2026-09-24-gemini-d1-assistant-v6';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS });

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
    if (!Number.isInteger(id) || !Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
    const user = await db.prepare(`SELECT id, display_name, email, photo, role, password_hash FROM users WHERE id = ? LIMIT 1`).bind(id).first();
    if (!user?.password_hash) return null;
    const expected = await sha256(`${payload}.${String(user.password_hash)}`);
    return expected === parts[1] ? user : null;
  } catch {
    return null;
  }
}

const SENSITIVE_KEY = /password|password_hash|password_salt|token|secret|api[_-]?key|authorization|cookie/i;

function sanitize(value, key = '') {
  if (SENSITIVE_KEY.test(String(key))) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitize(v, k);
    return out;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return sanitize(JSON.parse(trimmed)); } catch {}
    }
  }
  return value;
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

async function loadCompleteDatabase(db) {
  const schemaResult = await db.prepare(`SELECT name, type, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view') ORDER BY type, name`).all();
  const tables = {};
  const schemas = [];

  for (const item of schemaResult.results || []) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    schemas.push({ name, type: String(item?.type || ''), sql: String(item?.sql || '') });
    try {
      const result = await db.prepare(`SELECT * FROM ${quoteIdent(name)}`).all();
      tables[name] = (result.results || []).map((row) => sanitize(row));
    } catch (error) {
      tables[name] = [];
      console.warn(`Could not read ${name}:`, error?.message || error);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    schemas,
    counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    tables,
  };
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[“”‘’]/g, "'")
    .replace(/[।,!?;:()[\]{}"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, words) {
  const value = normalizeText(text);
  return words.some((word) => value.includes(normalizeText(word)));
}

function detectIntent(question) {
  const q = normalizeText(question);
  return {
    count: includesAny(q, ['কয়টা', 'কতটি', 'কতগুলো', 'কত', 'how many', 'count', 'total', 'number of', 'কয়টি']),
    list: includesAny(q, ['নাম', 'নামগুলো', 'list', 'show', 'দাও', 'দেখাও', 'কে কে', 'which', 'what are', 'কোনগুলো']),
    schedule: includesAny(q, ['schedule', 'scheduled', 'শিডিউল', 'শিডিউল করা', 'ক্যালেন্ডার', 'calendar', 'কবে', 'কখন', 'সময়', 'time']),
    upload: includesAny(q, ['upload', 'uploaded', 'আপলোড', 'আপলোড হয়েছে', 'আপলোড করা']),
    recorder: includesAny(q, ['record', 'recorded', 'recorder', 'recording', 'রেকর্ড', 'রেকর্ডার', 'রেকর্ড করা', 'রেকর্ড হয়েছে']),
    running: includesAny(q, ['running', 'run', 'চলছে', 'রানিং', 'চলমান']),
    editing: includesAny(q, ['editing done', 'edited', 'edit done', 'editing', 'এডিট', 'এডিটিং', 'এডিট করা', 'এডিট শেষ']),
    listed: includesAny(q, ['listed', 'লিস্টেড']),
    client: includesAny(q, ['client', 'ক্লায়েন্ট', 'ক্লায়েন্ট']),
    book: includesAny(q, ['book', 'বুক', 'বই']),
    post: includesAny(q, ['post', 'posts', 'পোস্ট', 'পোস্টগুলো']),
    content: includesAny(q, ['content', 'কনটেন্ট', 'কন্টেন্ট']),
    today: includesAny(q, ['আজ', 'আজকে', 'today']),
    channel: q.includes('hhd') ? 'HHD' : q.includes('bhd') ? 'BHD' : q.includes('dhd') ? 'DHD' : null,
  };
}

const VIDEO_STATUS_COLUMNS = [
  'full_video_status',
  'short_ex_status',
  'short_top_status',
  'style_ex_status',
  'style_top_status',
];

function contentRows(database) {
  return Array.isArray(database?.tables?.contents) ? database.tables.contents : [];
}

function rowChannel(row) {
  return String(row?.channel ?? '').trim().toUpperCase();
}

function rowName(row) {
  for (const key of ['name', 'project_name', 'project', 'title', 'content_name']) {
    if (row?.[key] !== null && row?.[key] !== undefined && String(row[key]).trim()) return String(row[key]).trim();
  }
  return '';
}

function statusValue(value) {
  return normalizeText(value).replace(/_/g, ' ').trim();
}

function contentVideoStatus(row) {
  const values = VIDEO_STATUS_COLUMNS
    .map((key) => statusValue(row?.[key]))
    .filter(Boolean);

  if (!values.length) return 'Listed';

  if (values.some((v) => ['record', 'recorded', 'recorder', 'recording'].includes(v))) return 'Recorder';
  if (values.some((v) => v.includes('editing done') || v === 'edited' || v.includes('edit done'))) return 'Editing Done';
  if (values.every((v) => ['not set', 'none', 'null', 'n/a', 'listed', ''].includes(v))) return 'Listed';
  return 'Running';
}

function contentRowsForQuestion(database, intent) {
  let rows = contentRows(database);

  if (intent.channel) {
    rows = rows.filter((row) => rowChannel(row) === intent.channel);
  }

  if (intent.recorder) rows = rows.filter((row) => contentVideoStatus(row) === 'Recorder');
  if (intent.running) rows = rows.filter((row) => contentVideoStatus(row) === 'Running');
  if (intent.editing) rows = rows.filter((row) => contentVideoStatus(row) === 'Editing Done');
  if (intent.listed) rows = rows.filter((row) => contentVideoStatus(row) === 'Listed');

  return rows;
}

function localContentAnswer(question, database) {
  const intent = detectIntent(question);
  const rows = contentRowsForQuestion(database, intent);

  const videoQuestion = intent.recorder || intent.running || intent.editing || intent.listed;

  if (intent.count && videoQuestion) {
    const label = intent.recorder ? 'Recorder/Recorded' : intent.running ? 'Running' : intent.editing ? 'Editing Done' : 'Listed';
    if (intent.channel) return `${intent.channel}-এ মোট ${rows.length}টি ${label} video আছে।`;
    return `মোট ${rows.length}টি ${label} video আছে।`;
  }

  if (intent.count && intent.channel && !videoQuestion) {
    return `${intent.channel} channel-এ মোট ${rows.length}টি content আছে।`;
  }

  if ((intent.list || intent.channel) && videoQuestion) {
    if (!rows.length) return 'Live D1 data অনুযায়ী কোনো matching content পাওয়া যায়নি।';
    return rows.slice(0, 100).map((row, index) => `${index + 1}. ${rowName(row)} [${rowChannel(row)}] — Video: ${contentVideoStatus(row)}`).join('\n');
  }

  return null;
}

function generalLocalAnswer(question, database) {
  const intent = detectIntent(question);
  if (intent.content || intent.channel || intent.recorder || intent.running || intent.editing || intent.listed) {
    const answer = localContentAnswer(question, database);
    if (answer) return answer;
  }
  return null;
}

function geminiModelCandidates(env) {
  const configured = String(env.GEMINI_MODEL || '').trim();
  return [configured || 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']
    .filter((v, i, a) => v && a.indexOf(v) === i);
}

function extractGeminiText(data) {
  return (data?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => typeof part?.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function askGemini(env, systemInstruction, input) {
  const key = String(env.GEMINI_API_KEY || env.Gemini_API_Key || env.Gemini_API_KEY || '').trim();
  if (!key) {
    const error = new Error('Gemini API key is not configured. Add Cloudflare Worker Secret GEMINI_API_KEY.');
    error.code = 'missing_gemini_key';
    throw error;
  }

  let lastError = null;
  for (const model of geminiModelCandidates(env)) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: input }] }],
          generationConfig: { maxOutputTokens: 4000 },
        }),
      });

      const raw = await response.text();
      if (response.ok) {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { throw new Error('Gemini returned invalid JSON.'); }
        const answer = extractGeminiText(parsed);
        if (!answer) throw new Error('Gemini returned an empty answer.');
        return { answer, model };
      }

      let message = `Gemini request failed (${response.status})`;
      let code = '';
      try {
        const parsed = JSON.parse(raw);
        message = parsed?.error?.message || message;
        code = parsed?.error?.status || parsed?.error?.code || '';
      } catch {
        if (raw) message += `: ${raw.slice(0, 500)}`;
      }

      const error = new Error(message);
      error.status = response.status;
      error.code = code;
      lastError = error;

      if (response.status === 400 || response.status === 404) continue;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Gemini request failed.');
}

const INSTRUCTIONS = `
You are the private AI assistant for the Content Schedule Manager application.
The LIVE DATABASE SNAPSHOT is the source of truth for application data.
Use ONLY the supplied live D1 data. Never invent or guess application data.
Understand Bangla, Banglish and English. Reply in the same language style as the user.

IMPORTANT VIDEO RULES:
- Video production data is stored in the contents table.
- The dashboard counts one content row as one video/content item, NOT each individual video-status column.
- Video status columns are: full_video_status, short_ex_status, short_top_status, style_ex_status, style_top_status.
- If a content row has a Record/Recorded/Recorder value in its video-status columns, its dashboard video status is Recorder.
- If it has Editing Done/Edited/Edit Done and no Record status, its dashboard video status is Editing Done.
- If all relevant status values are Listed/Not Set/None/null/N/A, its dashboard video status is Listed.
- Otherwise its dashboard video status is Running.
- HHD, BHD and DHD are channels.
- For questions such as “BHD-এ কয়টা ভিডিও রেকর্ড করা আছে?”, return the exact count of BHD rows in contents whose dashboard video status is Recorder.
- NEVER add HHD and BHD together when the user asks for one channel.
- NEVER count individual status columns as separate videos.
- For exact counts, trust the deterministic LOCAL DATABASE INTERPRETATION supplied with the request.

For application-data questions, preserve exact names, IDs, channels, types, statuses, dates and times from the database.
Never reveal passwords, password hashes, password salts, API keys, tokens, secrets, authorization values or cookies.
You are READ-ONLY.
`;

export async function handleChat(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method not allowed', version: CHAT_VERSION }, 405);
  if (!env?.DB) return json({ error: 'D1 binding DB is not configured', version: CHAT_VERSION }, 500);

  const user = await requireAuth(request, env.DB);
  if (!user) return json({ error: 'authentication required' }, 401);

  const body = await request.json().catch(() => ({}));
  const question = String(body.message || '').trim();
  const history = Array.isArray(body.history) ? body.history.slice(-20) : [];

  if (!question) return json({ error: 'message required' }, 400);
  if (question.length > 3000) return json({ error: 'message is too long' }, 400);

  let database;
  try {
    database = await loadCompleteDatabase(env.DB);
  } catch (error) {
    console.error('Chat database load failed:', error);
    return json({ error: 'database read failed', details: error?.message || String(error), version: CHAT_VERSION }, 500);
  }

  const deterministic = generalLocalAnswer(question, database);

  // Exact content/video counts must not be rewritten by an LLM.
  // This guarantees the assistant matches the Content dashboard.
  if (deterministic && detectIntent(question).count) {
    return json({
      ok: true,
      answer: deterministic,
      model: 'deterministic-d1',
      provider: 'google_gemini',
      data_source: 'live_d1',
      assistant_version: CHAT_VERSION,
      ai_available: true,
      table_counts: database.counts,
    });
  }

  const conversation = history
    .filter((item) => item?.role && item?.text)
    .map((item) => `${String(item.role).toUpperCase()}: ${String(item.text)}`)
    .join('\n');

  const localInterpretation = deterministic || 'No deterministic interpretation was required.';
  const input = [
    'CURRENT USER QUESTION:', question,
    '',
    'RECENT CONVERSATION:', conversation || 'none',
    '',
    'LIVE DATABASE SNAPSHOT:', JSON.stringify(database),
    '',
    'LOCAL DATABASE INTERPRETATION:', localInterpretation,
  ].join('\n');

  try {
    const result = await askGemini(env, INSTRUCTIONS, input);
    return json({
      ok: true,
      answer: result.answer,
      model: result.model,
      provider: 'google_gemini',
      data_source: 'live_d1',
      assistant_version: CHAT_VERSION,
      ai_available: true,
      table_counts: database.counts,
    });
  } catch (error) {
    console.error('Gemini unavailable; using live D1 fallback:', error);
    const fallback = deterministic || 'Live D1 data পাওয়া গেছে, কিন্তু এই প্রশ্নের উত্তর তৈরি করা যায়নি।';
    const message = String(error?.message || '').toLowerCase();
    const status = Number(error?.status || 0);
    const code = String(error?.code || '').toLowerCase();
    let reason = 'gemini_unavailable';
    if (code === 'missing_gemini_key' || message.includes('gemini api key')) reason = 'gemini_key_missing';
    else if (status === 401 || status === 403) reason = 'gemini_authentication';
    else if (status === 429 || message.includes('quota') || message.includes('rate limit') || message.includes('resource exhausted')) reason = 'gemini_quota_or_rate_limit';

    return json({
      ok: true,
      answer: fallback,
      model: 'local-d1-fallback',
      provider: 'google_gemini',
      data_source: 'live_d1',
      assistant_version: CHAT_VERSION,
      ai_available: false,
      ai_reason: reason,
      table_counts: database.counts,
    });
  }
}
