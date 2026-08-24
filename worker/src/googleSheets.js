const GOOGLE_SHEETS_SYNC_VERSION = '2026-08-24-v6';

export async function syncAllToGoogleSheets(env) {
  const webhook = String(env.GSHEET_WEBHOOK_URL || '').trim();
  const secret = String(env.GSHEET_SYNC_SECRET || '').trim();

  if (!webhook || !secret || !env.DB) {
    return {
      ok: false,
      error: 'Google Sheets sync is not configured',
      version: GOOGLE_SHEETS_SYNC_VERSION,
    };
  }

  try {
    // Only read application tables. Cloudflare D1 may expose internal
    // tables such as _cf_KV that are intentionally not queryable.
    const tableRows = await env.DB.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%'
        AND name NOT IN ('sessions')
      ORDER BY name
    `).all();

    const tables = {};

    for (const item of tableRows.results || []) {
      const table = String(item.name || '');

      if (!/^[A-Za-z0-9_]+$/.test(table)) {
        continue;
      }

      const result = await env.DB
        .prepare(`SELECT * FROM "${table}"`)
        .all();

      let rows = result.results || [];

      // Never export password hashes/salts to Google Sheets.
      if (table === 'users') {
        rows = rows.map(({ password_hash, password_salt, ...safe }) => safe);
      }

      tables[table] = rows;
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

    let result = null;
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
