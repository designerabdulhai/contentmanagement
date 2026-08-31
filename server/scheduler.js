const Database = require('better-sqlite3');

// Runs inside the same Node process as the API server.
// When a scheduled time arrives, Scheduled -> Uploaded automatically,
// regardless of whether an upload link has been added yet.
const db = new Database('data.sqlite');

function syncScheduledPosts() {
  const info = db.prepare(`
    UPDATE posts
    SET status = 'Uploaded',
        is_overdue = 0,
        updated_at = datetime('now')
    WHERE status = 'Scheduled'
      AND scheduled_at IS NOT NULL
      AND datetime(scheduled_at) <= datetime('now')
  `).run();

  return { promoted: info.changes };
}

module.exports = { syncScheduledPosts };
