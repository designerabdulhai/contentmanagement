const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function tokenFromRequest(request) {
  const header = String(request.headers.get('Authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
    const user = await db.prepare('SELECT id, email, password_hash FROM users WHERE id = ? LIMIT 1').bind(id).first();
    if (!user?.password_hash) return null;
    const expected = await sha256Hex(`${payload}.${String(user.password_hash)}`);
    return expected === parts[1] ? user : null;
  } catch {
    return null;
  }
}

function videoStatuses(item) {
  return [item.full_video_status, item.short_ex_status, item.short_top_status, item.style_ex_status, item.style_top_status].map((value) => String(value || '').trim());
}

function videoStage(item) {
  const statuses = videoStatuses(item);
  if (statuses.every((status) => !status)) return 'Listed';
  if (statuses.every((status) => status === 'Record')) return 'Recorder';
  return 'Running';
}

function compactContent(item) {
  const statuses = videoStatuses(item);
  return {
    id: item.id,
    name: item.name,
    channel: item.channel || '',
    stage: videoStage(item),
    full_video: statuses[0] || 'Not set',
    short_ex: statuses[1] || 'Not set',
    short_top: statuses[2] || 'Not set',
    style_ex: statuses[3] || 'Not set',
    style_top: statuses[4] || 'Not set',
    poster: item.poster_status || 'Not set',
  };
}

function extractText(response) {
  const chunks = [];
  for (const item of response?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && part?.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

export async function handleChat(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!env?.DB) return json({ error: 'D1 binding DB is not configured' }, 500);

  const user = await requireAuth(request, env.DB);
  if (!user) return json({ error: 'authentication required' }, 401);

  const payload = await request.json().catch(() => ({}));
  const question = String(payload?.message || '').trim();
  if (!question) return json({ error: 'message required' }, 400);
  if (question.length > 2000) return json({ error: 'message is too long' }, 400);

  const [contentsResult, postsResult] = await Promise.all([
    env.DB.prepare(`SELECT id,name,channel,full_video_status,short_ex_status,short_top_status,style_ex_status,style_top_status,poster_status FROM contents ORDER BY id DESC LIMIT 1000`).all(),
    env.DB.prepare(`SELECT id,project_name,content_type,channel,platform,status,scheduled_at,uploaded_link FROM posts ORDER BY id DESC LIMIT 500`).all(),
  ]);

  const contents = (contentsResult.results || []).map(compactContent);
  const posts = postsResult.results || [];
  const channels = ['HHD', 'BHD', 'DHD'];
  const channelSummary = Object.fromEntries(channels.map((channel) => {
    const rows = contents.filter((item) => String(item.channel).toUpperCase() === channel);
    return [channel, {
      total: rows.length,
      listed: rows.filter((item) => item.stage === 'Listed').length,
      recorder: rows.filter((item) => item.stage === 'Recorder').length,
      running: rows.filter((item) => item.stage === 'Running').length,
    }];
  }));

  const lower = question.toLowerCase();
  const wantsContent = /video|listed|record|recorder|running|content/.test(lower);
  const context = {
    channel_summary: channelSummary,
    contents: wantsContent ? contents : contents.slice(0, 200),
    posts: wantsContent ? posts.slice(0, 150) : posts.slice(0, 300),
  };

  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return json({ error: 'AI chatbot is not configured. Add OPENAI_API_KEY to the Cloudflare Worker secrets.' }, 503);

  const instructions = `You are the private assistant for a Content Schedule Manager web app. Answer questions using the supplied live database context and the app behavior described below. Be concise and practical. The user may write Bangla, English, or mixed Bangla-English; answer in the same style when possible. Never invent data. If the requested data is not in the context, say so.\n\nAPP BEHAVIOR:\n- Content has channels HHD, BHD, DHD.\n- Each content item has five video statuses: Full Video, Short Ex, Short Top, Style Ex, Style Top.\n- Listed Video means all five video statuses are Not set/empty.\n- Recorder Video means all five video statuses are Record.\n- Running Video means it is neither Listed nor Recorder and at least one video status has been changed.\n- Poster status is separate.\n- The app also has Dashboard, All Posts/List, Calendar, Settings, and Content pages.\n- Do not claim an action was performed; this chatbot is read-only.\n\nFor list requests, give the exact content names and channel, and optionally the relevant statuses. For counts, use channel_summary when applicable.\n\nLIVE DATABASE CONTEXT:\n${JSON.stringify(context)}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: String(env.OPENAI_MODEL || 'gpt-5.6-luna'),
      instructions,
      input: question,
      store: false,
      max_output_tokens: 1200,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = 'OpenAI request failed';
    try { detail = JSON.parse(text)?.error?.message || detail; } catch {}
    return json({ error: detail }, 502);
  }

  const result = JSON.parse(text);
  const answer = extractText(result);
  if (!answer) return json({ error: 'The AI returned an empty response.' }, 502);
  return json({ answer });
}
