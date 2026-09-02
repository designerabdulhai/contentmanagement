import api from './index.js';

const SCHEDULER_VERSION = '2026-09-02-auto-status-v2';
const DHAKA_OFFSET_MINUTES = 6 * 60;

function isoDhakaNow() {
  const now = new Date(
    Date.now() + DHAKA_OFFSET_MINUTES * 60 * 1000
  );

  return now
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

function parseScheduledAt(value) {
  if (!value) return null;

  const text = String(value).trim();
  if (!text) return null;

  // Values with an explicit timezone are parsed directly.
  if (/Z$|[+-]\d\d:?\d\d$/.test(text)) {
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? null : ms;
  }

  // Values without a timezone are treated as Bangladesh local time (UTC+6).
  const normalized = text.replace('T', ' ');

  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) return null;

  const [, y, mo, d, h, mi, s = '00'] = match;

  return Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h) - 6,
    Number(mi),
    Number(s)
  );
}

async function writeAudit(db, postId, action, payload) {
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
        'scheduler'
      )
      .run();
  } catch (error) {
    console.warn(
      'Scheduler audit failed:',
      error?.message || error
    );
  }
}

/*
 * AUTOMATIC STATUS SCHEDULER
 *
 * IMPORTANT:
 * This does NOT upload anything to Facebook, Instagram,
 * YouTube, etc.
 *
 * It performs the exact status change requested:
 *
 * Scheduled -> Uploaded
 *
 * after scheduled_at has arrived.
 */
async function runScheduler(env) {
  if (!env?.DB) {
    throw new Error(
      'D1 binding DB is not configured'
    );
  }

  const nowMs = Date.now();

  const rows = await env.DB
    .prepare(`
      SELECT
        id,
        project_name,
        content_type,
        channel,
        platform,
        status,
        scheduled_at,
        uploaded_link,
        notes,
        is_overdue
      FROM posts
      WHERE lower(trim(COALESCE(status, ''))) = 'scheduled'
        AND scheduled_at IS NOT NULL
    `)
    .all();

  const posts = rows.results || [];

  const result = {
    ok: true,
    scheduler_version: SCHEDULER_VERSION,
    timezone: 'Asia/Dhaka',
    now_dhaka: isoDhakaNow(),
    checked: posts.length,
    due: 0,
    updated: 0,
  };

  for (const post of posts) {
    const scheduledMs = parseScheduledAt(
      post.scheduled_at
    );

    if (scheduledMs === null) {
      console.warn(
        'Invalid scheduled_at:',
        post.id,
        post.scheduled_at
      );
      continue;
    }

    if (scheduledMs > nowMs) {
      continue;
    }

    result.due += 1;

    /*
     * Re-check status inside UPDATE so repeated cron runs
     * cannot change the same post twice.
     */
    const updateResult = await env.DB
      .prepare(`
        UPDATE posts
        SET
          status = 'Uploaded',
          is_overdue = 0
        WHERE id = ?
          AND lower(trim(COALESCE(status, ''))) = 'scheduled'
      `)
      .bind(post.id)
      .run();

    const changed = Number(
      updateResult?.meta?.changes || 0
    );

    if (changed <= 0) {
      continue;
    }

    result.updated += changed;

    await writeAudit(
      env.DB,
      post.id,
      'automatic_status_update',
      {
        project_name: post.project_name,
        previous_status: post.status,
        new_status: 'Uploaded',
        scheduled_at: post.scheduled_at,
        automatic: true,
        scheduler_version: SCHEDULER_VERSION,
      }
    );
  }

  console.log(
    JSON.stringify(result)
  );

  return result;
}

export default {
  async fetch(request, env, ctx) {
    return api.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runScheduler(env).catch((error) => {
        console.error(
          'Automatic scheduled status update failed:',
          error?.message || error
        );
      })
    );
  },
};

export { runScheduler };
