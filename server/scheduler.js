const Database = require('better-sqlite3');

// Runs inside the same Node process as the API server. It promotes posts whose
// scheduled time has arrived from Scheduled -> Uploaded only when an upload
// link is already present; otherwise it leaves them Scheduled and marks them
// overdue so the UI can still show that the upload is due.
const db = new Database('data.sqlite');

function syncScheduledPosts() {
  const due = db.prepare(`
    SELECT id, status, scheduled_at, uploaded_link
    FROM posts
    WHERE status = 'Scheduled'
      AND scheduled_at IS NOT NULL
      AND datetime(scheduled_at) <= datetime('now')
  `).all();

  let promoted = 0;
  let overdue = 0;

  const promote = db.prepare(`
    UPDATE posts
    SET status = 'Uploaded', is_overdue = 0, updated_at = datetime('now')
    WHERE id = ? AND status = 'Scheduled'
  `);

  const markDue = db.prepare(`
    UPDATE posts
    SET is_overdue = 1, updated_at = datetime('now')
    WHERE id = ? AND status = 'Scheduled'
  `);

  const tx = db.transaction((rows) => {
    for (const post of rows) {
      if (post.uploaded_link) {
        promoted += promote.run(post.id).changes;
      } else {
        overdue += markDue.run(post.id).changes;
      }
    }
  });

  tx(due);
  return { checked: due.length, promoted, overdue };
}

module.exports = { syncScheduledPosts };
