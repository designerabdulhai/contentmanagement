const Database = require('better-sqlite3');
const db = new Database('data.sqlite');

db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT,
  email TEXT UNIQUE,
  photo TEXT,
  role TEXT DEFAULT 'owner',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT,
  content_type TEXT,
  channel TEXT,
  platform TEXT,
  status TEXT,
  scheduled_at TEXT,
  uploaded_link TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  is_overdue INTEGER DEFAULT 0,
  recurring_rule TEXT,
  FOREIGN KEY(created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  role TEXT,
  token TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  action TEXT,
  payload TEXT,
  actor TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  content_type TEXT,
  channel TEXT,
  platform TEXT,
  project_id INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  user_id INTEGER,
  message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed some default settings
INSERT OR IGNORE INTO settings(key, value) VALUES ('content_types', 'Reel,Post,Blog,Video,Carousel,Story');
INSERT OR IGNORE INTO settings(key, value) VALUES ('channels', 'Instagram,YouTube,Website,Newsletter');
INSERT OR IGNORE INTO settings(key, value) VALUES ('platforms', 'Meta,Google,TikTok,Direct');
INSERT OR IGNORE INTO settings(key, value) VALUES ('statuses', 'Listed,Scheduled,Uploaded');
`);

console.log('Initialized database: data.sqlite');
