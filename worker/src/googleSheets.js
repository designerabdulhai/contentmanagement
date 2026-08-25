const GOOGLE_SHEETS_SYNC_VERSION = '2026-08-25-v1';

export async function syncAllToGoogleSheets(env) {
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
    // Do not query sqlite_master. Cloudflare D1 can expose protected
    // internal tables such as _cf_KV, which application code cannot read.
    const queries = {
      posts: 'SELECT * FROM posts',
      templates: 'SELECT * FROM templates',
      settings: 'SELECT * FROM settings',
      invites: 'SELECT * FROM invites',
      audit: 'SELECT * FROM audit',
      // Never export password_hash/password_salt.
      users: `
        SELECT
          id,
          display_name,
          email,
          photo,
          role,
          created_at
        FROM users
      `,
    };

    const tables = {};

    for (const [name, sql] of Object.entries(queries)) {
      try {
        const result = await env.DB.prepare(sql).all();
        tables[name] = result.results || [];
      } catch (error) {
        // These tables are optional for older schemas.
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
        'Accept': 'application/json',
      },
      redirect: 'follow',
      body: JSON.stringify({
        secret,
        tables,
        version: GOOGLE_SHEETS_SYNC_VERSION,
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Google Apps Script HTTP ${response.status}: ${responseText.slice(0, 500)}`
      );
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { raw: responseText.slice(0, 500) };
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
