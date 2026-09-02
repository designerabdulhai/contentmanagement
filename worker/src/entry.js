import api from './index.js';

const SCHEDULER_VERSION = '2026-09-02-scheduler-v1';
const DHAKA_OFFSET_MINUTES = 6 * 60;

function isoDhakaNow() {
  const now = new Date(Date.now() + DHAKA_OFFSET_MINUTES * 60 * 1000);
  return now.toISOString().slice(0, 19).replace('T', ' ');
}

function parseScheduledAt(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  // Values without an explicit timezone are treated as Bangladesh local time.
  if (/Z$|[+-]\d\d:\d\d$/.test(text)) {
    const ms = Date.parse(text);
    return Number.isNaN(ms) ? null : ms;
  }

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
    await db.prepare(`
      INSERT INTO audit (post_id, action, payload, actor)
      VALUES (?, ?, ?, ?)
    `).bind(
      postId ?? null,
      action,
      JSON.stringify(payload ?? null),
      'scheduler'
    ).run();
  } catch (error) {
    console.warn('Scheduler audit failed:', error?.message || error);
  }
}

async function notifyUploadWebhook(env, post) {
  const webhook = String(env.AUTO_UPLOAD_WEBHOOK_URL || '').trim();
  const secret = String(env.AUTO_UPLOAD_WEBHOOK_SECRET || '').trim();

  if (!webhook) {
    return {
      configured: false,
      uploaded: false,
      reason: 'AUTO_UPLOAD_WEBHOOK_URL is not configured',
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const response = await fetch(webhook, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      event: 'scheduled_post_due',
      scheduler_version: SCHEDULER_VERSION,
      timezone: 'Asia/Dhaka',
      post,
    }),
  });

  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}

  if (!response.ok) {
    throw new Error(
      `Auto-upload webhook HTTP ${response.status}: ${text.slice(0, 500)}`
    );
  }

  return {
    configured: true,
    uploaded: data?.uploaded === true || data?.ok === true,
    data,
    raw: data ? undefined : text.slice(0, 500),
  };
}

async function runScheduler(env) {
  if (!env?.DB) throw new Error('D1 binding DB is not configured');

  const nowMs = Date.now();
  const rows = await env.DB.prepare(`
    SELECT *
    FROM posts
    WHERE lower(trim(COALESCE(status, ''))) = 'scheduled'
      AND scheduled_at IS NOT NULL
  `).all();

  const due = (rows.results || []).filter((post) => {
    const scheduledMs = parseScheduledAt(post.scheduled_at);
    return scheduledMs !== null && scheduledMs <= nowMs;
  });

  const result = {
    ok: true,
    scheduler_version: SCHEDULER_VERSION,
    timezone: 'Asia/Dhaka',
    now_dhaka: isoDhakaNow(),
    checked: (rows.results || []).length,
    due: due.length,
    uploaded: 0,
    ready: 0,
    failed: 0,
  };

  for (const post of due) {
    try {
      const webhookResult = await notifyUploadWebhook(env, post);

      if (webhookResult.uploaded) {
        await env.DB.prepare(`
          UPDATE posts
          SET status = 'Uploaded', is_overdue = 0
          WHERE id = ?
            AND lower(trim(COALESCE(status, ''))) = 'scheduled'
        `).bind(post.id).run();

        await writeAudit(env.DB, post.id, 'auto_upload', {
          before_status: post.status,
          after_status: 'Uploaded',
          scheduled_at: post.scheduled_at,
          webhook: true,
        });
        result.uploaded += 1;
        continue;
      }

      // No uploader is configured yet. Never falsely mark a post as uploaded.
      await env.DB.prepare(`
        UPDATE posts
        SET status = 'Ready to Upload', is_overdue = 0
        WHERE id = ?
          AND lower(trim(COALESCE(status, ''))) = 'scheduled'
      `).bind(post.id).run();

      await writeAudit(env.DB, post.id, 'schedule_due', {
        before_status: post.status,
        after_status: 'Ready to Upload',
        scheduled_at: post.scheduled_at,
        webhook_configured: webhookResult.configured,
      });
      result.ready += 1;
    } catch (error) {
      await env.DB.prepare(`
        UPDATE posts
        SET status = 'Upload Failed', is_overdue = 1
        WHERE id = ?
          AND lower(trim(COALESCE(status, ''))) = 'scheduled'
      `).bind(post.id).run();

      await writeAudit(env.DB, post.id, 'auto_upload_failed', {
        scheduled_at: post.scheduled_at,
        error: error?.message || String(error),
      });
      result.failed += 1;
    }
  }

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
          'Scheduled upload worker failed:',
          error?.message || error
        );
      })
    );
  },
};

export { runScheduler };
