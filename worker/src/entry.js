import api from './index.js';
import { handleChat } from './chat.js';
import { handleContents } from './contents.js';

const SCHEDULER_VERSION = '2026-09-05-auto-status-v4';
const DHAKA_OFFSET_MINUTES = 6 * 60;
const ASSISTANT_VERSION = '2026-09-24-ai-assistant-v5';

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
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
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
  const rows = await env.DB.prepare(`SELECT id, project_name, status, scheduled_at FROM posts WHERE lower(trim(COALESCE(status, ''))) = 'scheduled' AND scheduled_at IS NOT NULL`).all();
  const posts = rows.results || [];
  const result = { ok: true, scheduler_version: SCHEDULER_VERSION, timezone: 'Asia/Dhaka', now_dhaka: isoDhakaNow(), checked: posts.length, due: 0, updated: 0, errors: 0 };

  for (const post of posts) {
    try {
      const scheduledMs = parseScheduledAt(post.scheduled_at);
      if (scheduledMs === null) { console.warn('Invalid scheduled_at:', post.id, post.scheduled_at); continue; }
      if (scheduledMs > nowMs) continue;
      result.due += 1;

      await env.DB.prepare(`UPDATE posts SET status = 'Uploaded' WHERE id = ? AND lower(trim(COALESCE(status, ''))) = 'scheduled'`).bind(post.id).run();
      const verify = await env.DB.prepare(`SELECT status FROM posts WHERE id = ?`).bind(post.id).first();
      if (String(verify?.status || '').trim().toLowerCase() !== 'uploaded') throw new Error(`Status update verification failed for post ${post.id}`);
      result.updated += 1;

      await writeAudit(env.DB, post.id, 'automatic_status_update', {
        project_name: post.project_name,
        previous_status: post.status,
        new_status: 'Uploaded',
        scheduled_at: post.scheduled_at,
        automatic: true,
        scheduler_version: SCHEDULER_VERSION,
      });
    } catch (error) {
      result.errors += 1;
      console.error(`Scheduler failed for post ${post.id}:`, error?.message || error);
    }
  }

  console.log(JSON.stringify(result));
  return result;
}

function normalizeQuestion(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/[“”‘’]/g, "'").replace(/[।,!?;:()[\]{}"'`]/g, ' ').replace(/\s+/g, ' ').trim();
}

function questionHas(value, words) {
  const q = normalizeQuestion(value);
  return words.some((word) => q.includes(normalizeQuestion(word)));
}

function dhakaDate() {
  return new Date(Date.now() + DHAKA_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10);
}

function tomorrowDhakaDate() {
  return new Date(Date.now() + (24 * 60 + DHAKA_OFFSET_MINUTES) * 60 * 1000).toISOString().slice(0, 10);
}

function isExplicitScheduleQuestion(question) {
  return questionHas(question, [
    'scheduled', 'schedule', 'শিডিউল', 'শিডিউল করা', 'শিডিউল করা আছে',
    'কয়টি ভিডিও শিডিউল', 'কয়টা scheduled', 'scheduled post',
  ]);
}

function statusIsScheduled(row) {
  return String(row?.status || '').trim().toLowerCase() === 'scheduled';
}

function channelOf(row) {
  return String(row?.channel || '').trim().toUpperCase();
}

function typeOf(row) {
  return String(row?.content_type || row?.type || row?.post_type || '—').trim() || '—';
}

function nameOf(row) {
  return String(row?.project_name || row?.name || row?.title || `Post #${row?.id ?? '—'}`).trim();
}

function scheduledDate(row) {
  const value = String(row?.scheduled_at || '').trim();
  if (!value) return '';
  const local = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/);
  if (local) return local[1];
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return '';
  return new Date(ms + DHAKA_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10);
}

function scheduledTime(row) {
  const value = String(row?.scheduled_at || '').trim();
  const local = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (local) {
    let hour = Number(local[2]);
    const minute = local[3];
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${hour}:${minute} ${suffix}`;
  }
  return '—';
}

async function exactScheduledAnswer(request, env) {
  let body;
  try { body = await request.clone().json(); } catch { return null; }
  const question = String(body?.message || '').trim();
  if (!question || !isExplicitScheduleQuestion(question) || !env?.DB) return null;

  // First pass keeps the existing auth/error behavior of handleChat.
  const authResponse = await handleChat(request.clone(), env);
  if (!authResponse?.ok) return authResponse;

  const rowsResult = await env.DB.prepare(`SELECT id, project_name, channel, content_type, status, scheduled_at FROM posts WHERE scheduled_at IS NOT NULL ORDER BY scheduled_at ASC, id ASC`).all();
  let rows = (rowsResult.results || []).filter(statusIsScheduled);

  const q = normalizeQuestion(question);
  const channel = q.includes('hhd') ? 'HHD' : q.includes('bhd') ? 'BHD' : q.includes('dhd') ? 'DHD' : null;
  if (channel) rows = rows.filter((row) => channelOf(row) === channel);

  const today = questionHas(question, ['আজ', 'আজকে', 'today']);
  const tomorrow = questionHas(question, ['আগামীকাল', 'tomorrow']);
  if (today) rows = rows.filter((row) => scheduledDate(row) === dhakaDate());
  else if (tomorrow) rows = rows.filter((row) => scheduledDate(row) === tomorrowDhakaDate());

  const asksCount = questionHas(question, ['কয়টা', 'কয়টি', 'কতটি', 'কতগুলো', 'how many', 'count', 'total']);
  const asksDetails = questionHas(question, ['কবে', 'কখন', 'সময়', 'সময়', 'time', 'নাম', 'কী কী', 'কি কি', 'list', 'show', 'দেখাও']);

  if (asksCount && !asksDetails) {
    const scope = today ? `আজ (${dhakaDate()})` : tomorrow ? `আগামীকাল (${tomorrowDhakaDate()})` : 'মোট';
    return new Response(JSON.stringify({ ok: true, answer: `${scope} ${rows.length}টি scheduled post আছে${channel ? ` ${channel}-এ` : ''}.`, assistant_version: ASSISTANT_VERSION, source: 'live_posts_status_scheduled' }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
  }

  if (!rows.length) {
    const scope = today ? `আজ (${dhakaDate()})` : tomorrow ? `আগামীকাল (${tomorrowDhakaDate()})` : 'বর্তমানে';
    return new Response(JSON.stringify({ ok: true, answer: `${scope} কোনো scheduled post পাওয়া যায়নি।`, assistant_version: ASSISTANT_VERSION, source: 'live_posts_status_scheduled' }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
  }

  const scope = today ? `আজ (${dhakaDate()})` : tomorrow ? `আগামীকাল (${tomorrowDhakaDate()})` : 'মোট';
  const answer = `${scope} ${rows.length}টি scheduled post:\n${rows.slice(0, 100).map((row, i) => `${i + 1}. ${nameOf(row)} [${channelOf(row) || '—'}] — ${typeOf(row)} — Scheduled — ${scheduledDate(row)} ${scheduledTime(row)}`).join('\n')}`;
  return new Response(JSON.stringify({ ok: true, answer, assistant_version: ASSISTANT_VERSION, source: 'live_posts_status_scheduled' }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/api/chat' || pathname === '/chat') {
      try {
        const exact = await exactScheduledAnswer(request, env);
        if (exact) return exact;
        return await handleChat(request, env);
      } catch (error) {
        console.error('Assistant route failed:', error?.message || error);
        return new Response(JSON.stringify({ ok: false, error: 'assistant route failed', message: error?.message || String(error), assistant_version: ASSISTANT_VERSION }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
        });
      }
    }

    if (pathname === '/api/contents' || pathname === '/contents' || /^\/api\/contents\/\d+$/.test(pathname) || /^\/contents\/\d+$/.test(pathname)) {
      return handleContents(request, env);
    }

    return api.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    console.log(`Cron started: ${event?.cron || 'unknown'} at ${event?.scheduledTime || Date.now()}`);
    await runScheduler(env);
  },
};

export { runScheduler };
