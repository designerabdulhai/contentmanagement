const GOOGLE_SHEETS_SYNC_VERSION = '2026-08-25-v2';

export async function syncAllToGoogleSheets(env, options = {}) {
  const webhook = String(env.GSHEET_WEBHOOK_URL || '').trim();
  const secret = String(env.GSHEET_SYNC_SECRET || '').trim();

  if (!env.DB || !webhook || !secret) {
    return {
      ok: false,
      version: GOOGLE_SHEETS_SYNC_VERSION,
      error: 'Google Sheets sync is not configured',
    };
  }

  try {
    const queries = {
      posts: 'SELECT * FROM posts',
      templates: 'SELECT * FROM templates',
      settings: 'SELECT * FROM settings',
      invites: 'SELECT * FROM invites',
      audit: 'SELECT * FROM audit',
      users: `
        SELECT id, display_name, email, photo, role, created_at
        FROM users
      `,
    };

    const tables = {};

    for (const [name, sql] of Object.entries(queries)) {
      try {
        const result = await env.DB.prepare(sql).all();
        tables[name] = result.results || [];
      } catch (error) {
        if (['templates', 'settings', 'invites', 'audit'].includes(name)) {
          console.warn(`Skipping ${name}:`, error?.message || error);
          continue;
        }
        throw error;
      }
    }

    const response = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        secret,
        tables,
        version: GOOGLE_SHEETS_SYNC_VERSION,
        mode: options.mode || 'manual',
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Google Apps Script HTTP ${response.status}: ${responseText.slice(0, 1000)}`
      );
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { raw: responseText.slice(0, 1000) };
    }

    if (result && result.ok === false) {
      throw new Error(
        result.error || 'Google Apps Script rejected the sync'
      );
    }

    return {
      ok: true,
      version: GOOGLE_SHEETS_SYNC_VERSION,
      tables: Object.keys(tables),
      counts: Object.fromEntries(
        Object.entries(tables).map(([name, rows]) => [name, rows.length])
      ),
      response: result,
    };
  } catch (error) {
    console.error(
      'Google Sheets sync failed:',
      error?.message || error
    );

    return {
      ok: false,
      version: GOOGLE_SHEETS_SYNC_VERSION,
      error: error?.message || String(error),
    };
  }
}
