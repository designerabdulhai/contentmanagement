const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const CHAT_VERSION = '2026-09-24-gemini-d1-assistant-v5';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS });

const tokenFromRequest = (request) => {
  const header = String(request.headers.get('Authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

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
  return String(value ?? '').toLowerCase().normalize('NFKC').replace(/[“”‘’]/g, "'").replace(/[।,!?;:()[\]{}"'`]/g, ' ').replace(/\s+/g, ' ').trim();
}

function includesAny(text, words) {
  const value = normalizeText(text);
  return words.some((word) => value.includes(normalizeText(word)));
}

function detectIntent(question) {
  const q = normalizeText(question);
  return {
    count: includesAny(q, ['কয়টা','কতটি','কতগুলো','কত','how many','count','total','number of','কয়টি']),
    list: includesAny(q, ['নাম','নামগুলো','list','show','দাও','দেখাও','কে কে','which','what are','কোনগুলো']),
    schedule: includesAny(q, ['schedule','scheduled','শিডিউল','শিডিউল করা','ক্যালেন্ডার','calendar','কবে','কখন','সময়','time']),
    upload: includesAny(q, ['upload','uploaded','আপলোড','আপলোড হয়েছে','আপলোড করা']),
    recorder: includesAny(q, ['record','recorded','recorder','recording','রেকর্ড','রেকর্ডার','রেকর্ড করা','রেকর্ড হয়েছে']),
    running: includesAny(q, ['running','run','চলছে','রানিং','চলমান']),
    editing: includesAny(q, ['editing done','edited','edit done','editing','এডিট','এডিটিং','এডিট করা','এডিট শেষ']),
    listed: includesAny(q, ['listed','list','লিস্টেড','লিস্ট']),
    client: includesAny(q, ['client','ক্লায়েন্ট','ক্লায়েন্ট']),
    book: includesAny(q, ['book','বুক','বই']),
    post: includesAny(q, ['post','posts','পোস্ট','পোস্টগুলো']),
    content: includesAny(q, ['content','কনটেন্ট','কন্টেন্ট']),
    today: includesAny(q, ['আজ','আজকে','today']),
    channel: q.includes('hhd') ? 'HHD' : q.includes('bhd') ? 'BHD' : q.includes('dhd') ? 'DHD' : null,
  };
}

function rowText(row) {
  return normalizeText(Object.entries(row || {}).map(([key, value]) => `${key} ${value}`).join(' '));
}

function rowName(row) {
  for (const key of ['project_name','project','name','title','content_name','client_name','book_name','display_name']) {
    if (row?.[key] !== null && row?.[key] !== undefined && String(row[key]).trim()) return String(row[key]).trim();
  }
  return '';
}

function rowChannel(row) {
  const key = Object.keys(row || {}).find((name) => /channel/i.test(name));
  return key ? String(row[key] ?? '').trim() : '';
}

function rowStatus(row) {
  const key = Object.keys(row || {}).find((name) => /^status$|status/i.test(name));
  return key ? String(row[key] ?? '').trim() : '';
}

function rowContentType(row) {
  const key = Object.keys(row || {}).find((name) => /content.?type|^type$/i.test(name));
  return key ? String(row[key] ?? '').trim() : '';
}

function videoFields(row) {
  return Object.keys(row || {}).filter((key) => {
    const k = key.toLowerCase().replace(/[\s-]/g, '_');
    return ['full_video','fullvideo','short_ex','short_ex_video','short_top','short_top_video','style_ex','style_ex_video','style_top','style_top_video'].includes(k);
  });
}

function videoStatus(row) {
  const fields = videoFields(row).map((key) => ({ key, value: row[key] })).filter((item) => item.value !== null && item.value !== undefined && String(item.value).trim() !== '');
  if (!fields.length) return null;
  const values = fields.map((item) => normalizeText(item.value));
  if (values.some((value) => value.includes('editing done') || value.includes('edited') || value.includes('edit done'))) return 'Editing Done';
  if (values.some((value) => value === 'record' || value.includes('recorded') || value.includes('recorder'))) return 'Recorder';
  if (values.every((value) => !value || value === 'not set' || value === 'none' || value === 'null' || value === 'n/a')) return 'Listed';
  return 'Running';
}

function allRows(database) {
  const output = [];
  for (const [table, rows] of Object.entries(database.tables || {})) for (const row of rows || []) output.push({ table, row });
  return output;
}

function filterRows(database, question) {
  const intent = detectIntent(question);
  let rows = allRows(database);
  if (intent.channel) rows = rows.filter((item) => rowChannel(item.row).toUpperCase().includes(intent.channel));
  if (intent.recorder) rows = rows.filter((item) => videoStatus(item.row) === 'Recorder');
  if (intent.running) rows = rows.filter((item) => videoStatus(item.row) === 'Running');
  if (intent.editing) rows = rows.filter((item) => videoStatus(item.row) === 'Editing Done');
  if (intent.listed && !intent.list) rows = rows.filter((item) => videoStatus(item.row) === 'Listed');
  if (intent.upload) rows = rows.filter((item) => normalizeText(rowStatus(item.row)).includes('upload') || rowText(item.row).includes('uploaded'));
  if (intent.schedule) rows = rows.filter((item) => {
    const keys = Object.keys(item.row || {});
    const text = rowText(item.row);
    return keys.some((key) => /scheduled_at|schedule|calendar/i.test(key)) || text.includes('scheduled') || text.includes('schedule');
  });
  if (intent.today) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    rows = rows.filter((item) => rowText(item.row).includes(today));
  }
  return { rows, intent };
}

function formatRow(item) {
  const row = item.row;
  const parts = [];
  const name = rowName(row), channel = rowChannel(row), type = rowContentType(row), status = rowStatus(row), vStatus = videoStatus(row);
  if (name) parts.push(name);
  if (channel) parts.push(`[${channel}]`);
  if (type) parts.push(`— ${type}`);
  if (status) parts.push(`— Status: ${status}`);
  if (vStatus) parts.push(`— Video: ${vStatus}`);
  return parts.join(' ');
}

function localAnswer(question, database) {
  const { rows, intent } = filterRows(database, question);
  if (intent.count) {
    if (intent.recorder) return `মোট ${rows.length}টি Recorder/Recorded video পাওয়া গেছে।`;
    if (intent.editing) return `মোট ${rows.length}টি Editing Done video পাওয়া গেছে।`;
    if (intent.running) return `মোট ${rows.length}টি Running video পাওয়া গেছে।`;
    if (intent.upload) return `মোট ${rows.length}টি Uploaded matching record পাওয়া গেছে।`;
    if (intent.schedule) return `মোট ${rows.length}টি Scheduled matching record পাওয়া গেছে।`;
    if (intent.channel) return `${intent.channel} channel-এ ${rows.length}টি matching record পাওয়া গেছে।`;
    return `Live D1 database-এ ${rows.length}টি matching record পাওয়া গেছে।`;
  }
  if (intent.list || intent.schedule || intent.channel) {
    if (!rows.length) return 'Live D1 data অনুযায়ী কোনো matching record পাওয়া যায়নি।';
    const lines = rows.slice(0, 100).map((item, index) => `${index + 1}. ${formatRow(item)}`);
    let answer = lines.join('\n');
    if (rows.length > 100) answer += `\n\nআরও ${rows.length - 100}টি record আছে।`;
    return answer;
  }
  if (rows.length) return rows.slice(0, 50).map((item, index) => `${index + 1}. ${formatRow(item)}`).join('\n');
  return 'এই প্রশ্নের সাথে কোনো matching live database record পাওয়া যায়নি।';
}

function geminiModelCandidates(env) {
  const configured = String(env.GEMINI_MODEL || '').trim();
  return [configured || 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'].filter((v, i, a) => v && a.indexOf(v) === i);
}

function extractGeminiText(data) {
  return (data?.candidates || []).flatMap((candidate) => candidate?.content?.parts || []).map((part) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
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
      let message = `Gemini request failed (${response.status})`, code = '';
      try { const parsed = JSON.parse(raw); message = parsed?.error?.message || message; code = parsed?.error?.status || parsed?.error?.code || ''; } catch { if (raw) message += `: ${raw.slice(0, 500)}`; }
      const error = new Error(message); error.status = response.status; error.code = code; lastError = error;
      if (response.status === 400 || response.status === 404) continue;
      break;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Gemini request failed.');
}

const INSTRUCTIONS = `
You are the private AI assistant for the Content Schedule Manager application.
The LIVE DATABASE SNAPSHOT in every request is the source of truth for application data. It is read directly from the current Cloudflare D1 database immediately before the AI call.
Use ONLY the supplied LIVE DATABASE SNAPSHOT for application-data questions. Never invent, guess, or use old application data.
Understand Bangla, Banglish and English naturally. Reply in Bangla for Bangla/Banglish questions and English for English questions.
The database can contain posts, content, clients, books, schedules, users and other application tables. Search ALL supplied tables when necessary.
HHD, BHD and DHD are channels.
Common terms: কয়টা/কতটি/how many/count=count; রেকর্ড/record/recorded/recorder=recording; এডিট/editing/edited/editing done=editing; শিডিউল/scheduled/calendar=schedule; আপলোড/upload/uploaded=upload; পোস্ট/post=post; কনটেন্ট/content=content; ক্লায়েন্ট/client=client; বুক/book=book.
For counts, calculate from the supplied LIVE D1 rows. For lists, return relevant exact records and preserve exact IDs/names/channels/types/statuses/dates/times. Do not confuse dashboard summary numbers with raw D1 row counts.
Use recent conversation context for follow-up questions. If ambiguous, use the database and recent conversation to infer the intended subject. If unavailable, clearly say so.
Never reveal passwords, password hashes, password salts, API keys, tokens, secrets, authorization values or cookies. You are READ-ONLY.
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

  const local = localAnswer(question, database);
  const conversation = history.filter((item) => item?.role && item?.text).map((item) => `${String(item.role).toUpperCase()}: ${String(item.text)}`).join('\n');
  const input = ['CURRENT USER QUESTION:', question, '', 'RECENT CONVERSATION:', conversation || 'none', '', 'LIVE DATABASE SNAPSHOT:', JSON.stringify(database), '', 'LOCAL DATABASE INTERPRETATION:', local].join('\n');

  try {
    const result = await askGemini(env, INSTRUCTIONS, input);
    return json({ ok: true, answer: result.answer, model: result.model, provider: 'google_gemini', data_source: 'live_d1', assistant_version: CHAT_VERSION, ai_available: true, table_counts: database.counts });
  } catch (error) {
    console.error('Gemini unavailable; using live D1 fallback:', error);
    const message = String(error?.message || '').toLowerCase();
    const status = Number(error?.status || 0);
    const code = String(error?.code || '').toLowerCase();
    let reason = 'gemini_unavailable';
    if (code === 'missing_gemini_key' || message.includes('gemini api key')) reason = 'gemini_key_missing';
    else if (status === 401 || status === 403) reason = 'gemini_authentication';
    else if (status === 429 || message.includes('quota') || message.includes('rate limit') || message.includes('resource exhausted')) reason = 'gemini_quota_or_rate_limit';
    return json({ ok: true, answer: local, model: 'local-d1-fallback', provider: 'google_gemini', data_source: 'live_d1', assistant_version: CHAT_VERSION, ai_available: false, ai_reason: reason, table_counts: database.counts });
  }
}
