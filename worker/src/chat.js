const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const CHAT_VERSION = '2026-09-24-gemini-d1-assistant-v7';
const DHAKA_OFFSET_MINUTES = 360;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS });

function tokenFromRequest(request) {
  const header = String(request.headers.get('Authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function base64UrlDecode(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
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

    const user = await db
      .prepare(`
        SELECT id, display_name, email, photo, role, password_hash
        FROM users
        WHERE id = ?
        LIMIT 1
      `)
      .bind(id)
      .first();

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
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return sanitize(JSON.parse(trimmed));
      } catch {}
    }
  }

  return value;
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

async function loadCompleteDatabase(db) {
  const schemaResult = await db
    .prepare(`
      SELECT name, type, sql
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
        AND type IN ('table', 'view')
      ORDER BY type, name
    `)
    .all();

  const tables = {};
  const schemas = [];

  for (const item of schemaResult.results || []) {
    const name = String(item?.name || '').trim();
    if (!name) continue;

    schemas.push({
      name,
      type: String(item?.type || ''),
      sql: String(item?.sql || ''),
    });

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
    counts: Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, rows.length])
    ),
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
    count: includesAny(q, [
      'কয়টা', 'কতটি', 'কতগুলো', 'কত', 'কয়টি',
      'how many', 'count', 'total', 'number of',
    ]),
    list: includesAny(q, [
      'নাম', 'নামগুলো', 'list', 'show', 'দাও', 'দেখাও',
      'কে কে', 'which', 'what are', 'কোনগুলো', 'কী কী', 'কি কি',
    ]),
    schedule: includesAny(q, [
      'schedule', 'scheduled', 'শিডিউল', 'শিডিউল করা',
      'ক্যালেন্ডার', 'calendar', 'কবে', 'কখন', 'সময়', 'সময়', 'time',
    ]),
    upload: includesAny(q, [
      'upload', 'uploaded', 'আপলোড', 'আপলোড হয়েছে',
      'আপলোড হয়েছে', 'আপলোড করা', 'uploaded video',
    ]),
    recorder: includesAny(q, [
      'record', 'recorded', 'recorder', 'recording',
      'রেকর্ড', 'রেকর্ডার', 'রেকর্ড করা', 'রেকর্ড হয়েছে',
      'রেকর্ড হয়েছে',
    ]),
    running: includesAny(q, [
      'running', 'run', 'চলছে', 'রানিং', 'চলমান',
    ]),
    editing: includesAny(q, [
      'editing done', 'edited', 'edit done', 'editing',
      'এডিট', 'এডিটিং', 'এডিট করা', 'এডিট শেষ',
    ]),
    listed: includesAny(q, ['listed', 'লিস্টেড']),
    client: includesAny(q, ['client', 'ক্লায়েন্ট', 'ক্লায়েন্ট']),
    book: includesAny(q, ['book', 'বুক', 'বই']),
    post: includesAny(q, ['post', 'posts', 'পোস্ট', 'পোস্টগুলো']),
    content: includesAny(q, ['content', 'কনটেন্ট', 'কন্টেন্ট']),
    today: includesAny(q, ['আজ', 'আজকে', 'today']),
    tomorrow: includesAny(q, ['আগামীকাল', 'কাল', 'tomorrow']),
    channel:
      q.includes('hhd') ? 'HHD' :
      q.includes('bhd') ? 'BHD' :
      q.includes('dhd') ? 'DHD' : null,
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
  return Array.isArray(database?.tables?.contents)
    ? database.tables.contents
    : [];
}

function postRows(database) {
  return Array.isArray(database?.tables?.posts)
    ? database.tables.posts
    : [];
}

function rowChannel(row) {
  return String(row?.channel ?? '').trim().toUpperCase();
}

function rowName(row) {
  for (const key of [
    'name', 'project_name', 'project', 'title', 'content_name',
  ]) {
    if (
      row?.[key] !== null &&
      row?.[key] !== undefined &&
      String(row[key]).trim()
    ) {
      return String(row[key]).trim();
    }
  }
  return '';
}

function postType(row) {
  for (const key of ['content_type', 'type', 'post_type']) {
    if (row?.[key] !== null && row?.[key] !== undefined && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
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

  if (
    values.some((v) =>
      ['record', 'recorded', 'recorder', 'recording'].includes(v)
    )
  ) {
    return 'Recorder';
  }

  if (
    values.some(
      (v) =>
        v.includes('editing done') ||
        v === 'edited' ||
        v.includes('edit done')
    )
  ) {
    return 'Editing Done';
  }

  if (
    values.every((v) =>
      ['not set', 'none', 'null', 'n/a', 'listed', ''].includes(v)
    )
  ) {
    return 'Listed';
  }

  return 'Running';
}

function contentRowsForQuestion(database, intent) {
  let rows = contentRows(database);

  if (intent.channel) {
    rows = rows.filter((row) => rowChannel(row) === intent.channel);
  }

  if (intent.recorder) {
    rows = rows.filter((row) => contentVideoStatus(row) === 'Recorder');
  }
  if (intent.running) {
    rows = rows.filter((row) => contentVideoStatus(row) === 'Running');
  }
  if (intent.editing) {
    rows = rows.filter((row) => contentVideoStatus(row) === 'Editing Done');
  }
  if (intent.listed) {
    rows = rows.filter((row) => contentVideoStatus(row) === 'Listed');
  }

  return rows;
}

function localContentAnswer(question, database) {
  const intent = detectIntent(question);
  const rows = contentRowsForQuestion(database, intent);
  const videoQuestion =
    intent.recorder || intent.running || intent.editing || intent.listed;

  if (intent.count && videoQuestion) {
    const label =
      intent.recorder ? 'Recorder/Recorded' :
      intent.running ? 'Running' :
      intent.editing ? 'Editing Done' :
      'Listed';

    if (intent.channel) {
      return `${intent.channel}-এ মোট ${rows.length}টি ${label} video আছে।`;
    }

    return `মোট ${rows.length}টি ${label} video আছে।`;
  }

  if (intent.count && intent.channel && !videoQuestion && !intent.schedule) {
    return `${intent.channel} channel-এ মোট ${rows.length}টি content আছে।`;
  }

  if ((intent.list || intent.channel) && videoQuestion) {
    if (!rows.length) {
      return 'Live D1 data অনুযায়ী কোনো matching content পাওয়া যায়নি।';
    }

    return rows
      .slice(0, 100)
      .map(
        (row, index) =>
          `${index + 1}. ${rowName(row)} [${rowChannel(row)}] — Video: ${contentVideoStatus(row)}`
      )
      .join('\n');
  }

  return null;
}

function dhakaParts(date = new Date()) {
  const shifted = new Date(date.getTime() + DHAKA_OFFSET_MINUTES * 60000);
  const iso = shifted.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 19),
  };
}

function todayDhaka() {
  return dhakaParts(new Date()).date;
}

function tomorrowDhaka() {
  const d = new Date(Date.now() + 24 * 60 * 60000);
  return dhakaParts(d).date;
}

function dateFromValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  const text = String(value).trim();

  // The app stores many scheduled_at values as Asia/Dhaka local SQL datetime.
  const local = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/);
  if (local) {
    return {
      date: local[1],
      time: `${local[2]}${local[3] ? `:${local[3]}` : ''}`,
      raw: text,
    };
  }

  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return null;

  return {
    ...dhakaParts(new Date(ms)),
    raw: text,
  };
}

function postDateInfo(row) {
  for (const key of [
    'uploaded_at',
    'published_at',
    'scheduled_at',
    'created_at',
    'updated_at',
  ]) {
    const info = dateFromValue(row?.[key]);
    if (info) return { ...info, source: key };
  }
  return null;
}

function scheduledDateInfo(row) {
  return dateFromValue(row?.scheduled_at);
}

function normalizedPostStatus(row) {
  return statusValue(row?.status);
}

function isScheduledPost(row) {
  const status = normalizedPostStatus(row);
  return status === 'scheduled' || Boolean(row?.scheduled_at);
}

function isUploadedPost(row) {
  const status = normalizedPostStatus(row);
  return [
    'uploaded', 'upload', 'posted', 'published', 'listed',
  ].includes(status);
}

function formatPost(row) {
  const date = scheduledDateInfo(row) || postDateInfo(row);
  const channel = rowChannel(row) || '—';
  const type = postType(row) || '—';
  const status = String(row?.status || '—').trim();
  const name = rowName(row) || `Post #${row?.id ?? '—'}`;
  const when = date
    ? `${date.date} ${date.time.slice(0, 5)}`
    : 'date/time not set';

  return `${name} [${channel}] — ${type} — ${status} — ${when}`;
}

function localScheduleAnswer(question, database) {
  const intent = detectIntent(question);
  const rows = postRows(database);

  let filtered = rows.filter((row) => isScheduledPost(row));

  if (intent.channel) {
    filtered = filtered.filter((row) => rowChannel(row) === intent.channel);
  }

  if (intent.today) {
    const target = todayDhaka();
    filtered = filtered.filter((row) => scheduledDateInfo(row)?.date === target);
  } else if (intent.tomorrow) {
    const target = tomorrowDhaka();
    filtered = filtered.filter((row) => scheduledDateInfo(row)?.date === target);
  }

  filtered.sort((a, b) => {
    const da = scheduledDateInfo(a)?.raw || '';
    const db = scheduledDateInfo(b)?.raw || '';
    return String(da).localeCompare(String(db));
  });

  const asksSchedule = intent.schedule;
  const asksCount = intent.count;
  const asksList = intent.list || intent.today || intent.tomorrow;

  if (!asksSchedule) return null;

  if (asksCount && !asksList) {
    return `মোট ${filtered.length}টি scheduled post আছে${intent.channel ? ` ${intent.channel}-এ` : ''}.`;
  }

  if (!filtered.length) {
    return intent.today
      ? `আজ (${todayDhaka()}) কোনো scheduled post পাওয়া যায়নি।`
      : 'Live D1 data অনুযায়ী কোনো scheduled post পাওয়া যায়নি।';
  }

  const header = intent.today
    ? `আজ (${todayDhaka()}) মোট ${filtered.length}টি scheduled post:`
    : intent.tomorrow
      ? `আগামীকাল (${tomorrowDhaka()}) মোট ${filtered.length}টি scheduled post:`
      : `মোট ${filtered.length}টি scheduled post:`;

  return `${header}\n${filtered
    .slice(0, 100)
    .map((row, index) => `${index + 1}. ${formatPost(row)}`)
    .join('\n')}`;
}

function localTodayAnswer(question, database) {
  const intent = detectIntent(question);
  if (!intent.today || intent.schedule) return null;

  const rows = postRows(database);
  const target = todayDhaka();
  let filtered = rows.filter((row) => {
    const info = postDateInfo(row);
    return info?.date === target;
  });

  if (intent.channel) {
    filtered = filtered.filter((row) => rowChannel(row) === intent.channel);
  }

  if (intent.upload) {
    filtered = filtered.filter((row) => isUploadedPost(row));
  }

  if (intent.count) {
    const label = intent.upload ? 'uploaded' : 'post';
    return `আজ (${target}) মোট ${filtered.length}টি ${label} আছে${intent.channel ? ` ${intent.channel}-এ` : ''}.`;
  }

  if (intent.list || intent.upload) {
    if (!filtered.length) {
      return intent.upload
        ? `আজ (${target}) কোনো uploaded video/post পাওয়া যায়নি।`
        : `আজ (${target}) কোনো post পাওয়া যায়নি।`;
    }

    const label = intent.upload ? 'uploaded' : 'today';
    return `আজ (${target}) ${label} data:\n${filtered
      .slice(0, 100)
      .map((row, index) => `${index + 1}. ${formatPost(row)}`)
      .join('\n')}`;
  }

  return null;
}

function localUploadAnswer(question, database) {
  const intent = detectIntent(question);
  if (!intent.upload || intent.today) return null;

  let rows = postRows(database).filter((row) => isUploadedPost(row));

  if (intent.channel) {
    rows = rows.filter((row) => rowChannel(row) === intent.channel);
  }

  if (intent.count) {
    return `মোট ${rows.length}টি uploaded post/video আছে${intent.channel ? ` ${intent.channel}-এ` : ''}.`;
  }

  if (intent.list || intent.upload) {
    if (!rows.length) return 'Live D1 data অনুযায়ী কোনো uploaded post/video পাওয়া যায়নি।';
    return `মোট ${rows.length}টি uploaded post/video:\n${rows
      .slice(0, 100)
      .map((row, index) => `${index + 1}. ${formatPost(row)}`)
      .join('\n')}`;
  }

  return null;
}

function generalLocalAnswer(question, database) {
  const intent = detectIntent(question);

  const scheduleAnswer = localScheduleAnswer(question, database);
  if (scheduleAnswer) return scheduleAnswer;

  const todayAnswer = localTodayAnswer(question, database);
  if (todayAnswer) return todayAnswer;

  const uploadAnswer = localUploadAnswer(question, database);
  if (uploadAnswer) return uploadAnswer;

  if (
    intent.content ||
    intent.channel ||
    intent.recorder ||
    intent.running ||
    intent.editing ||
    intent.listed
  ) {
    const answer = localContentAnswer(question, database);
    if (answer) return answer;
  }

  return null;
}

function geminiModelCandidates(env) {
  const configured = String(env.GEMINI_MODEL || '').trim();
  return [
    configured,
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
  ].filter((v, i, a) => v && a.indexOf(v) === i);
}

function extractGeminiText(data) {
  return (data?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function askGemini(env, systemInstruction, input) {
  const key = String(
    env.GEMINI_API_KEY ||
    env.Gemini_API_Key ||
    env.Gemini_API_KEY ||
    ''
  ).trim();

  if (!key) {
    const error = new Error(
      'Gemini API key is not configured. Add Cloudflare Worker Secret GEMINI_API_KEY.'
    );
    error.code = 'missing_gemini_key';
    throw error;
  }

  let lastError = null;

  for (const model of geminiModelCandidates(env)) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: input }],
              },
            ],
            generationConfig: {
              maxOutputTokens: 4000,
              temperature: 0.1,
            },
          }),
        }
      );

      const raw = await response.text();

      if (response.ok) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error('Gemini returned invalid JSON.');
        }

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

      // Try the next valid model for model-not-found/bad-request responses.
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

SOURCE OF TRUTH:
- LIVE DATABASE SNAPSHOT is the only source of truth for application data.
- Never invent, estimate, infer, or guess a database value.
- When the user asks for an exact count, date, time, name, ID, channel, type or status, use the supplied database values exactly.
- Understand Bangla, Banglish and English. Reply in the user's language/style.

DATA MODEL:
- contents = video/content production records.
- posts = scheduled/listed/uploaded/post records used by the Calendar and Dashboard.
- HHD, BHD and DHD are channels.
- A content row is one content/video item. Do not count each status column as a separate video.

CONTENTS VIDEO STATUS:
- Video status columns: full_video_status, short_ex_status, short_top_status, style_ex_status, style_top_status.
- If any relevant video-status value is Record/Recorded/Recorder/Recording, dashboard video status is Recorder.
- Else if any relevant value is Editing Done/Edited/Edit Done, dashboard video status is Editing Done.
- Else if all relevant values are Listed/Not Set/None/null/N/A, dashboard video status is Listed.
- Otherwise dashboard video status is Running.

POSTS / CALENDAR:
- Calendar scheduling information comes from the posts table, especially scheduled_at, project_name, content_type, channel and status.
- If a question asks what is scheduled today, tomorrow, on a date, or at what time, use posts.scheduled_at.
- Preserve the exact project_name/content type/channel/status/date/time from the database.
- Do not confuse a scheduled post with a content-production status in contents.

IMPORTANT:
- If LOCAL DATABASE INTERPRETATION is present, it is deterministic and must be trusted for exact counts/lists covered by that interpretation.
- Never reveal passwords, password hashes, password salts, API keys, tokens, secrets, authorization values or cookies.
- You are READ-ONLY. Never claim that you changed database data.
`;

export async function handleChat(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') {
    return json(
      { error: 'method not allowed', version: CHAT_VERSION },
      405
    );
  }

  if (!env?.DB) {
    return json(
      { error: 'D1 binding DB is not configured', version: CHAT_VERSION },
      500
    );
  }

  const user = await requireAuth(request, env.DB);
  if (!user) return json({ error: 'authentication required' }, 401);

  const body = await request.json().catch(() => ({}));
  const question = String(body.message || '').trim();
  const history = Array.isArray(body.history)
    ? body.history.slice(-20)
    : [];

  if (!question) return json({ error: 'message required' }, 400);
  if (question.length > 3000) {
    return json({ error: 'message is too long' }, 400);
  }

  let database;
  try {
    database = await loadCompleteDatabase(env.DB);
  } catch (error) {
    console.error('Chat database load failed:', error);
    return json(
      {
        error: 'database read failed',
        details: error?.message || String(error),
        version: CHAT_VERSION,
      },
      500
    );
  }

  const deterministic = generalLocalAnswer(question, database);
  const intent = detectIntent(question);

  // Exact application-data questions should never be rewritten by Gemini.
  // This is what keeps Calendar/Dashboard counts aligned with D1.
  if (deterministic && (intent.count || intent.schedule || intent.today || intent.upload)) {
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

  const localInterpretation =
    deterministic || 'No deterministic interpretation was required.';

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

    const fallback =
      deterministic ||
      'Live D1 data পাওয়া গেছে, কিন্তু এই প্রশ্নের উত্তর তৈরি করা যায়নি।';

    const message = String(error?.message || '').toLowerCase();
    const status = Number(error?.status || 0);
    const code = String(error?.code || '').toLowerCase();

    let reason = 'gemini_unavailable';
    if (
      code === 'missing_gemini_key' ||
      message.includes('gemini api key')
    ) {
      reason = 'gemini_key_missing';
    } else if (status === 401 || status === 403) {
      reason = 'gemini_authentication';
    } else if (
      status === 429 ||
      message.includes('quota') ||
      message.includes('rate limit') ||
      message.includes('resource exhausted')
    ) {
      reason = 'gemini_quota_or_rate_limit';
    }

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
