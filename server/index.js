const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const db = new Database('data.sqlite');
const PORT = Number(process.env.PORT) || 4000;
const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || '1mb';

// Basic production hardening. Set CORS_ORIGIN to the exact frontend origin in production.
const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: MAX_BODY_SIZE }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const isValidId = (value) => /^\d+$/.test(String(value));
const requireId = (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  next();
};

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/posts', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.display_name AS owner
    FROM posts p LEFT JOIN users u ON p.created_by = u.id
    ORDER BY p.scheduled_at IS NULL, p.scheduled_at
  `).all();
  res.json(rows);
});

app.get('/api/posts/project-suggestions', (req, res) => {
  const q = String(req.query.query || '').trim();
  if (!q) return res.json([]);
  const rows = db.prepare(`
    SELECT project_name, scheduled_at, content_type, channel, status FROM posts
    WHERE project_name IS NOT NULL AND lower(project_name) LIKE ?
    ORDER BY scheduled_at IS NULL, scheduled_at DESC
  `).all(`%${q.toLowerCase()}%`);
  const map = {};
  for (const r of rows) {
    const name = r.project_name;
    if (!map[name]) map[name] = { project_name: name, last_scheduled: [], count: 0 };
    map[name].count += 1;
    if (r.scheduled_at) map[name].last_scheduled.push(r);
  }
  res.json(Object.values(map).map(item => {
    const latest = item.last_scheduled[0] || null;
    return {
      project_name: item.project_name,
      count: item.count,
      last_scheduled_at: latest?.scheduled_at || null,
      last_scheduled_dates: item.last_scheduled.slice(0, 5).map(s => ({
        scheduled_at: s.scheduled_at,
        content_type: s.content_type || '',
        channel: s.channel || '',
        status: s.status || ''
      }))
    };
  }));
});

app.post('/api/posts/bulk', (req, res) => {
  const { project_name, content_type, channel, platform, start_date, end_date, days_of_week, occurrences } = req.body;
  if (!project_name || !start_date) return res.status(400).json({ error: 'project_name and start_date required' });
  const start = new Date(start_date);
  const end = end_date ? new Date(end_date) : null;
  if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) return res.status(400).json({ error: 'invalid date' });
  if (end && end < start) return res.status(400).json({ error: 'end_date must be on or after start_date' });

  const requestedDays = Array.isArray(days_of_week) ? days_of_week.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : [];
  const maxOccurrences = Math.min(Math.max(Number(occurrences) || 365, 1), 1000);
  const created = [];
  let cursor = new Date(start);
  const insert = db.prepare(`INSERT INTO posts (project_name, content_type, channel, platform, status, scheduled_at, created_by) VALUES (?,?,?,?,?,?,?)`);
  db.transaction(() => {
    while ((end ? cursor <= end : created.length < maxOccurrences) && created.length < maxOccurrences) {
      if (requestedDays.length === 0 || requestedDays.includes(cursor.getDay())) {
        const info = insert.run(project_name, content_type || null, channel || null, platform || null, 'Scheduled', cursor.toISOString(), null);
        created.push(db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  })();
  res.status(201).json({ created_count: created.length, created });
});

app.get('/api/templates', (req, res) => res.json(db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all()));

app.post('/api/templates', (req, res) => {
  const { name, content_type, channel, platform, project_id, created_by } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare(`INSERT INTO templates (name, content_type, channel, platform, project_id, created_by) VALUES (?,?,?,?,?,?)`).run(name, content_type || null, channel || null, platform || null, project_id || null, created_by || null);
  res.status(201).json(db.prepare('SELECT * FROM templates WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/templates/:id', requireId, (req, res) => {
  const info = db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'template not found' });
  res.json({ ok: true });
});

app.get('/api/posts/:id/notes', requireId, (req, res) => {
  res.json(db.prepare(`
    SELECT pn.*, u.display_name AS user_name FROM post_notes pn
    LEFT JOIN users u ON pn.user_id = u.id WHERE pn.post_id = ? ORDER BY pn.created_at DESC
  `).all(req.params.id));
});

app.post('/api/posts/:id/notes', requireId, (req, res) => {
  const post_id = Number(req.params.id);
  const { user_id, message } = req.body;
  if (!String(message || '').trim()) return res.status(400).json({ error: 'message required' });
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(post_id)) return res.status(404).json({ error: 'post not found' });
  const info = db.prepare('INSERT INTO post_notes (post_id, user_id, message) VALUES (?,?,?)').run(post_id, user_id || null, String(message).trim());
  res.status(201).json(db.prepare(`SELECT pn.*, u.display_name AS user_name FROM post_notes pn LEFT JOIN users u ON pn.user_id = u.id WHERE pn.id = ?`).get(info.lastInsertRowid));
});

app.get('/api/dashboard/due-soon', (req, res) => {
  res.json(db.prepare(`
    SELECT p.*, u.display_name AS owner FROM posts p LEFT JOIN users u ON p.created_by = u.id
    WHERE p.scheduled_at IS NOT NULL AND p.scheduled_at >= datetime('now')
      AND p.scheduled_at < datetime('now','+7 days') AND (p.status IS NULL OR p.status != 'Uploaded')
    ORDER BY p.scheduled_at ASC LIMIT 50
  `).all());
});

app.post('/api/overdue/check', (req, res) => {
  const info = db.prepare(`UPDATE posts SET is_overdue = CASE WHEN status = 'Scheduled' AND scheduled_at IS NOT NULL AND scheduled_at < datetime('now') THEN 1 ELSE 0 END`).run();
  res.json({ updated: info.changes });
});

app.post('/api/posts', (req, res) => {
  const p = req.body || {};
  if (!p.project_name) return res.status(400).json({ error: 'project_name required' });
  if (p.scheduled_at && Number.isNaN(new Date(p.scheduled_at).getTime())) return res.status(400).json({ error: 'invalid scheduled_at' });
  const info = db.prepare(`INSERT INTO posts (project_name, content_type, channel, platform, status, scheduled_at, uploaded_link, notes, created_by, recurring_rule) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(p.project_name, p.content_type || null, p.channel || null, p.platform || null, p.status || 'Listed', p.scheduled_at || null, p.uploaded_link || null, p.notes || null, p.created_by || null, p.recurring_rule || null);
  const newRow = db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
  db.prepare('INSERT INTO audit(post_id, action, payload, actor) VALUES (?,?,?,?)').run(newRow.id, 'create', JSON.stringify(newRow), p.created_by || 'system');
  res.status(201).json(newRow);
});

app.put('/api/posts/:id', requireId, (req, res) => {
  const id = Number(req.params.id), p = req.body || {};
  if (p.scheduled_at && Number.isNaN(new Date(p.scheduled_at).getTime())) return res.status(400).json({ error: 'invalid scheduled_at' });
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(id)) return res.status(404).json({ error: 'post not found' });
  db.prepare(`UPDATE posts SET project_name=?, content_type=?, channel=?, platform=?, status=?, scheduled_at=?, uploaded_link=?, notes=?, recurring_rule=?, updated_at=datetime('now') WHERE id=?`).run(p.project_name || null, p.content_type || null, p.channel || null, p.platform || null, p.status || null, p.scheduled_at || null, p.uploaded_link || null, p.notes || null, p.recurring_rule || null, id);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  db.prepare('INSERT INTO audit(post_id, action, payload, actor) VALUES (?,?,?,?)').run(id, 'update', JSON.stringify(row), p.updated_by || 'system');
  res.json(row);
});

app.post('/api/posts/:id/duplicate', requireId, (req, res) => {
  const id = Number(req.params.id), row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'post not found' });
  const info = db.prepare(`INSERT INTO posts (project_name, content_type, channel, platform, status, scheduled_at, uploaded_link, notes, created_by, recurring_rule) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(row.project_name, row.content_type, row.channel, row.platform, 'Listed', null, null, row.notes, req.body.created_by || row.created_by, row.recurring_rule);
  res.status(201).json(db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid));
});

app.post('/api/posts/:id/mark-uploaded', requireId, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(id)) return res.status(404).json({ error: 'post not found' });
  db.prepare("UPDATE posts SET status='Uploaded', uploaded_link=?, is_overdue=0, updated_at=datetime('now') WHERE id=?").run(req.body.uploaded_link || null, id);
  res.json(db.prepare('SELECT * FROM posts WHERE id = ?').get(id));
});

app.delete('/api/posts/:id', requireId, (req, res) => {
  const id = Number(req.params.id), row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'post not found' });
  db.prepare('INSERT INTO audit(post_id, action, payload, actor) VALUES (?,?,?,?)').run(id, 'delete', JSON.stringify(row), req.body?.actor || 'system');
  db.prepare('DELETE FROM posts WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/settings', (req, res) => {
  const obj = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => { obj[r.key] = r.value.split(',').map(s => s.trim()).filter(Boolean); });
  res.json(obj);
});

app.put('/api/settings/:key', (req, res) => {
  const key = String(req.params.key || '').trim();
  if (!/^[a-z0-9_-]+$/i.test(key)) return res.status(400).json({ error: 'invalid setting key' });
  const values = Array.isArray(req.body) ? req.body.map(v => String(v).trim()).filter(Boolean) : [];
  db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?,?)').run(key, values.join(','));
  res.json({ key, values });
});

app.get('/api/users', (req, res) => res.json(db.prepare('SELECT * FROM users ORDER BY created_at DESC').all()));

app.post('/api/invite', (req, res) => {
  const { email, role } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return res.status(400).json({ error: 'valid email required' });
  const token = crypto.randomBytes(32).toString('hex');
  const info = db.prepare('INSERT INTO invites(email, role, token) VALUES (?,?,?)').run(normalizedEmail, role || 'manager', token);
  res.status(201).json(db.prepare('SELECT id, email, role, status, created_at FROM invites WHERE id = ?').get(info.lastInsertRowid));
});

app.get('/api/invites', (req, res) => res.json(db.prepare('SELECT id, email, role, status, created_at FROM invites ORDER BY created_at DESC').all()));

app.get('/api/summary', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM posts').get().c;
  const scheduledWeek = db.prepare("SELECT COUNT(*) AS c FROM posts WHERE scheduled_at >= datetime('now') AND scheduled_at < datetime('now','+7 days')").get().c;
  const uploadedMonth = db.prepare("SELECT COUNT(*) AS c FROM posts WHERE status='Uploaded' AND strftime('%Y-%m', created_at)=strftime('%Y-%m','now')").get().c;
  const listedCount = db.prepare("SELECT COUNT(*) AS c FROM posts WHERE status='Listed'").get().c;
  const overdue = db.prepare("SELECT COUNT(*) AS c FROM posts WHERE is_overdue=1").get().c;
  res.json({ total, scheduledWeek, uploadedMonth, listedCount, overdue });
});

const clientDist = path.resolve(__dirname, '../client/dist');
app.use(express.static(clientDist, { index: 'index.html' }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next(err);
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));