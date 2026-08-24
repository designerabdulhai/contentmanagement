export async function syncAllToGoogleSheets(env) {
  const webhook = String(env.GSHEET_WEBHOOK_URL || '').trim();
  const secret = String(env.GSHEET_SYNC_SECRET || '').trim();
  if (!webhook || !secret || !env.DB) return;

  try {
    const tableRows = await env.DB.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT IN ('sessions')
      ORDER BY name
    `).all();

    const tables = {};

    for (const item of tableRows.results || []) {
      const table = String(item.name || '');
      if (!/^[A-Za-z0-9_]+$/.test(table)) continue;

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

    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, tables })
    });
  } catch (error) {
    console.error('Google Sheets sync failed:', error?.message || error);
  }
}
