const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bodyParser = require('express').json;
const db = new Database('data.sqlite');

const app = express();
app.use(cors());
app.use(bodyParser());

// Helpers
const getSetting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value.split(',').map(s => s.trim()) : [];
};

// Posts
app.get('/api/posts', (req, res) => {
  const rows = db.prepare('SELECT p.*, u.display_name as owner FROM posts p LEFT JOIN users u ON p.created_by = u.id ORDER BY scheduled_at IS NULL, scheduled_at').all();
  res.json(rows);
});

// Project name suggestions with recent schedules
app.get('/api/posts/project-suggestions', (req, res) => {
  const q = (req.query.query || '').trim();
  if (!q) return res.json([]);
  // case-insensitive partial match on project_name
  const like = `%${q.toLowerCase()}%`;
  const rows = db.prepare("SELECT project_name, scheduled_at, channel, status FROM posts WHERE project_name IS NOT NULL AND lower(project_name) LIKE ? ORDER BY scheduled_at DESC").all(like);

  // group by project_name
  const map = {};
  for (const r of rows) {
    const name = r.project_name;
    if (!map[name]) map[name] = { project_name: name, last_scheduled: [], count: 0 };
    map[name].count += 1;
    if (r.scheduled_at) map[name].last_scheduled.push({ scheduled_at: r.scheduled_at, channel: r.channel, status: r.status });
  }

  const result = Object.values(map).map(item => {
    const last_scheduled_dates = item.last_scheduled.slice(0,5).map(s => {
      // format like: Aug 12, 2026 · Instagram · Uploaded
      let label = s.scheduled_at;
      try {
        const d = new Date(s.scheduled_at);
        label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } catch (e) {}
      return `${label} · ${s.channel||''} · ${s.status||''}`;
    });
    return { project_name: item.project_name, last_scheduled_dates, count: item.count };
  });

  res.json(result);
});

// Bulk create scheduled posts
app.post('/api/posts/bulk', (req, res) => {
  const { project_name, content_type, channel, platform, start_date, end_date, days_of_week, occurrences } = req.body;
  if (!project_name || !start_date) return res.status(400).json({ error: 'project_name and start_date required' });

  const start = new Date(start_date);
  const end = end_date ? new Date(end_date) : null;
  const max = occurrences || 365;
  const created = [];
  let cursor = new Date(start);
  let count = 0;
  while ((end ? cursor <= end : count < max) && count < 1000) {
    const dow = cursor.getDay(); // 0-6
    if ((!days_of_week || days_of_week.length===0) || days_of_week.includes(dow)) {
      // create post for this date
      const scheduled_at = cursor.toISOString();
      const info = db.prepare(`INSERT INTO posts (project_name, content_type, channel, platform, status, scheduled_at, created_by) VALUES (?,?,?,?,?,?,?)`).run(project_name, content_type, channel, platform, 'Scheduled', scheduled_at, null);
      const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
      created.push(row);
      count++;
      if (occurrences && count>=occurrences) break;
    }
    // advance cursor by one day
    cursor.setDate(cursor.getDate()+1);
  }
  res.json({ created_count: created.length, created });
});

// Templates
app.get('/api/templates', (req, res) => {
  const rows = db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all();
  res.json(rows);
});

app.post('/api/templates', (req, res) => {
  const { name, content_type, channel, platform, project_id, created_by } = req.body;
  const info = db.prepare('INSERT INTO templates (name, content_type, channel, platform, project_id, created_by) VALUES (?,?,?,?,?,?)').run(name, content_type, channel, platform || null, project_id || null, created_by || null);
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(info.lastInsertRowid);
  res.json(row);
});

app.delete('/api/templates/:id', (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ ok:true });
});

// Notes for posts
app.get('/api/posts/:id/notes', (req, res) => {
  const rows = db.prepare('SELECT pn.*, u.display_name as user_name FROM post_notes pn LEFT JOIN users u ON pn.user_id = u.id WHERE pn.post_id = ? ORDER BY pn.created_at DESC').all(req.params.id);
  res.json(rows);
});

app.post('/api/posts/:id/notes', (req, res) => {
  const post_id = req.params.id;
  const { user_id, message } = req.body;
  const info = db.prepare('INSERT INTO post_notes (post_id, user_id, message) VALUES (?,?,?)').run(post_id, user_id||null, message||'');
  const row = db.prepare('SELECT pn.*, u.display_name as user_name FROM post_notes pn LEFT JOIN users u ON pn.user_id = u.id WHERE pn.id = ?').get(info.lastInsertRowid);

  // simple mention detection: @email or @name (very naive)
  const mentions = [];
  const mentionRegex = /@([\w\.\-\+@]+)/g;
  let m;
  while ((m = mentionRegex.exec(message || '')) !== null) {
    mentions.push(m[1]);
  }
  if (mentions.length) console.log('Mentions detected for post', post_id, mentions);

  res.json(row);
});

// Dashboard due-soon
app.get('/api/dashboard/due-soon', (req, res) => {
  // posts within next 7 days and status != 'Uploaded'
  const rows = db.prepare("SELECT p.*, u.display_name as owner FROM posts p LEFT JOIN users u ON p.created_by = u.id WHERE p.scheduled_at IS NOT NULL AND p.scheduled_at >= datetime('now') AND p.scheduled_at < datetime('now','+7 days') AND (p.status IS NULL OR p.status != 'Uploaded') ORDER BY p.scheduled_at ASC LIMIT 50").all();
  res.json(rows);
});

// Overdue background check endpoint (can be called by cron)
app.post('/api/overdue/check', (req, res) => {
  const info = db.prepare("UPDATE posts SET is_overdue = CASE WHEN status = 'Scheduled' AND scheduled_at IS NOT NULL AND scheduled_at < datetime('now') THEN 1 ELSE 0 END").run();
  res.json({ updated: info.changes });
});

app.post('/api/posts', (req, res) => {
  const p = req.body;
  const stmt = db.prepare(`INSERT INTO posts (project_name, content_type, channel, platform, status, scheduled_at, uploaded_link, notes, created_by, recurring_rule) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const info = stmt.run(p.project_name||null, p.content_type||null, p.channel||null, p.platform||null, p.status||null, p.scheduled_at||null, p.uploaded_link||null, p.notes||null, p.created_by||null, p.recurring_rule||null);
  const newRow = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  db.prepare('INSERT INTO audit(post_id, action, payload, actor) VALUES (?,?,?,?)').run(newRow.id, 'create', JSON.stringify(newRow), p.created_by||'system');
  res.json(newRow);
});

app.put('/api/posts/:id', (req, res) => {
  const id = req.params.id;
  const p = req.body;
  db.prepare(`UPDATE posts SET project_name=?, content_type=?, channel=?, platform=?, status=?, scheduled_at=?, uploaded_link=?, notes=?, recurring_rule=?, updated_at=datetime('now') WHERE id=?`).run(p.project_name||null, p.content_type||null, p.channel||null, p.platform||null, p.status||null, p.scheduled_at||null, p.uploaded_link||null, p.notes||null, p.recurring_rule||null, id);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  db.prepare('INSERT INTO audit(post_id, action, payload, actor) VALUES (?,?,?,?)').run(id, 'update', JSON.stringify(row), p.updated_by||'system');
  res.json(row);
});

app.post('/api/posts/:id/duplicate', (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if(!row) return res.status(404).json({error:'not found'});
  const stmt = db.prepare(`INSERT INTO posts (project_name, content_type, channel, platform, status, scheduled_at, uploaded_link, notes, created_by, recurring_rule) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const info = stmt.run(row.project_name, row.content_type, row.channel, row.platform, 'Listed', null, null, row.notes, req.body.created_by||row.created_by, row.recurring_rule);
  const newRow = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  res.json(newRow);
});

app.post('/api/posts/:id/mark-uploaded', (req, res) => {
  const id = req.params.id;
  db.prepare('UPDATE posts SET status = ?, uploaded_link = ?, updated_at=datetime(\'now\') WHERE id = ?').run('Uploaded', req.body.uploaded_link||null, id);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  res.json(row);
});

app.delete('/api/posts/:id', (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  db.prepare('INSERT INTO audit(post_id, action, payload, actor) VALUES (?,?,?,?)').run(id, 'delete', '', req.body.actor||'system');
  res.json({ok:true});
});

// Settings
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  rows.forEach(r => obj[r.key] = r.value.split(',').map(s=>s.trim()));
  res.json(obj);
});

app.put('/api/settings/:key', (req, res) => {
  const key = req.params.key;
  const values = Array.isArray(req.body) ? req.body : [];
  db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?,?)').run(key, values.join(','));
  res.json({key, values});
});

// Users / Invites (simplified)
app.get('/api/users', (req, res) => {
  const rows = db.prepare('SELECT * FROM users').all();
  res.json(rows);
});

app.post('/api/invite', (req, res) => {
  const {email, role} = req.body;
  const token = Math.random().toString(36).slice(2,9);
  const info = db.prepare('INSERT INTO invites(email, role, token) VALUES (?,?,?)').run(email, role||'manager', token);
  const invite = db.prepare('SELECT * FROM invites WHERE id = ?').get(info.lastInsertRowid);
  res.json(invite);
});

app.get('/api/invites', (req, res) => {
  const rows = db.prepare('SELECT * FROM invites ORDER BY created_at DESC').all();
  res.json(rows);
});

// Simple dashboard summaries
app.get('/api/summary', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM posts').get().c;
  const scheduledWeek = db.prepare("SELECT COUNT(*) as c FROM posts WHERE scheduled_at >= date('now') AND scheduled_at < date('now','+7 days')").get().c;
  const uploadedMonth = db.prepare("SELECT COUNT(*) as c FROM posts WHERE status = 'Uploaded' AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')").get().c;
  const listedCount = db.prepare("SELECT COUNT(*) as c FROM posts WHERE status = 'Listed'").get().c;
  res.json({total, scheduledWeek, uploadedMonth, listedCount});
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('Server listening on', PORT));
