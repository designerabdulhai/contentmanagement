import api from './index.js';
import { handleChat } from './chat.js';
import { handleContents } from './contents.js';

const SCHEDULER_VERSION = '2026-09-05-auto-status-v4';
const DHAKA_OFFSET_MINUTES = 6 * 60;
const ASSISTANT_VERSION = '2026-09-24-ai-assistant-v6';

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

function dateFromQuestion(question) {
  const q = normalizeQuestion(question);

  const iso = q.match(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;

  const numeric = q.match(/\b(\d{1,2})[-\/](\d{1,2})(?:[-\/](20\d{2}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = numeric[3] ? Number(numeric[3]) : new Date().getFullYear();
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

  const first = q.match(new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(${monthPattern})(?:\\s+(20\\d{2}))?(?:$|\\s)`, 'i'));
  if (first) {
    const day = Number(first[1]);
    const month = months[first[2].toLowerCase()];
    const year = first[3] ? Number(first[3]) : new Date().getFullYear();
    if (month && day >= 1 && day <= 31) return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const second = q.match(new RegExp(`(?:^|\\s)(${monthPattern})\\s+(\\d{1,2})(?:\\s*,?\\s*(20\\d{2}))?(?:$|\\s)`, 'i'));
  if (second) {
    const month = months[second[1].toLowerCase()];
    const day = Number(second[2]);
    const year = second[3] ? Number(second[3]) : new Date().getFullYear();
    if (month && day >= 1 && day <= 31) return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  if (questionHas(q, ['আজ', 'আজকে', 'today'])) return dhakaDate();
  if (questionHas(q, ['আগামীকাল', 'tomorrow'])) return tomorrowDhakaDate();
  return null;
}

function isDatePostQuestion(question) {
  if (!dateFromQuestion(question)) return false;
  return questionHas(question, [
    'post', 'posts', 'পোস্ট', 'পোস্টগুলো', 'ভিডিও', 'video', 'videos',
    'কি কি', 'কী কী', 'কোনগুলো', 'which', 'show', 'দেখাও', 'নাম', 'list', 'কয়টা', 'কয়টি', 'কতটি', 'কতগুলো',
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

async function exactCalendarAnswer(request, env) {
  let body;
  try { body = await request.clone().json(); } catch { return null; }
  const question = String(body?.message || '').trim();
  if (!question || !env?.DB) return null;

  const scheduleQuestion = isExplicitScheduleQuestion(question);
  const datePostQuestion = isDatePostQuestion(question);
  if (!scheduleQuestion && !datePostQuestion) return null;

  // Authenticate before reading Calendar data directly.
  const authResponse = await handleChat(request.clone(), env);
  if (!authResponse?.ok) return authResponse;

  const rowsResult = await env.DB.prepare(`SELECT id, project_name, channel, content_type, status, scheduled_at FROM posts WHERE scheduled_at IS NOT NULL ORDER BY scheduled_at ASC, id ASC`).all();
  let rows = rowsResult.results || [];

  const q = normalizeQuestion(question);
  const channel = q.includes('hhd') ? 'HHD' : q.includes('bhd') ? 'BHD' : q.includes('dhd') ? 'DHD' : null;

  // Scheduled questions must match Calendar's Scheduled tab exactly.
  // Date-only post questions show all Calendar items for that date.
  if (scheduleQuestion) rows = rows.filter(statusIsScheduled);

  if (channel) rows = rows.filter((row) => channelOf(row) === channel);

  const targetDate = dateFromQuestion(question);
  if (targetDate) rows = rows.filter((row) => scheduledDate(row) === targetDate);

  const asksCount = questionHas(question, ['কয়টা', 'কয়টি', 'কতটি', 'কতগুলো', 'how many', 'count', 'total']);
  const asksDetails = questionHas(question, ['কবে', 'কখন', 'সময়', 'সময়', 'time', 'নাম', 'কী কী', 'কি কি', 'list', 'show', 'দেখাও', 'কোনগুলো', 'which']);

  const label = scheduleQuestion ? 'scheduled' : 'calendar';
  if (asksCount && !asksDetails) {
    return new Response(JSON.stringify({ ok: true, answer: `${targetDate ? `${targetDate} তারিখে ` : ''}${rows.length}টি ${label} post আছে${channel ? ` ${channel}-এ` : ''}.`, assistant_version: ASSISTANT_VERSION, source: scheduleQuestion ? 'live_posts_status_scheduled' : 'live_calendar_posts' }), { status: 200, headers: { ...CORS } });
  }

  if (!rows.length) {
    return new Response(JSON.stringify({ ok: true, answer: `${targetDate ? `${targetDate} তারিখে ` : ''}কোনো ${label} post পাওয়া যায়নি।`, assistant_version: ASSISTANT_VERSION, source: scheduleQuestion ? 'live_posts_status_scheduled' : 'live_calendar_posts' }), { status: 200, headers: { ...CORS } });
  }

  const scope = targetDate ? `${targetDate} তারিখে` : 'মোট';
  const answer = `${scope} ${rows.length}টি ${label} post:\n${rows.slice(0, 100).map((row, i) => `${i + 1}. ${nameOf(row)} [${channelOf(row) || '—'}] — ${typeOf(row)} — ${String(row?.status || '—').trim()} — ${scheduledDate(row)} ${scheduledTime(row)}`).join('\n')}`;
  return new Response(JSON.stringify({ ok: true, answer, assistant_version: ASSISTANT_VERSION, source: scheduleQuestion ? 'live_posts_status_scheduled' : 'live_calendar_posts' }), { status: 200, headers: { ...CORS } });
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/api/chat' || pathname === '/chat') {
      try {
        const exact = await exactCalendarAnswer(request, env);
        if (exact) return exact;
        return await handleChat(request, env);
      } catch (error) {
        console.error('Assistant route failed:', error?.message || error);
        return new Response(JSON.stringify({ ok: false, error: 'assistant route failed', message: error?.message || String(error), assistant_version: ASSISTANT_VERSION }), {
          status: 500,
          headers: { ...CORS },
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

const CORS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
