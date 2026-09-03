const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database('data.sqlite');

const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
};

db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT, email TEXT UNIQUE, photo TEXT, role TEXT DEFAULT 'owner', password_hash TEXT, password_salt TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, project_name TEXT, content_type TEXT, channel TEXT, platform TEXT, status TEXT, scheduled_at TEXT, uploaded_link TEXT, notes TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), is_overdue INTEGER DEFAULT 0, recurring_rule TEXT, FOREIGN KEY(created_by) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS contents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, full_video_status TEXT, short_ex_status TEXT, short_top_status TEXT, style_ex_status TEXT, style_top_status TEXT, poster_status TEXT, full_video TEXT, short_ex TEXT, short_top TEXT, style_ex TEXT, style_top TEXT, poster TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), FOREIGN KEY(created_by) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS invites (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, role TEXT, token TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, action TEXT, payload TEXT, actor TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, content_type TEXT, channel TEXT, platform TEXT, project_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS post_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, user_id INTEGER, message TEXT, created_at TEXT DEFAULT (datetime('now')));
INSERT OR IGNORE INTO settings(key, value) VALUES ('content_types', 'Reel,Post,Blog,Video,Carousel,Story');
INSERT OR IGNORE INTO settings(key, value) VALUES ('channels', 'Instagram,YouTube,Website,Newsletter');
INSERT OR IGNORE INTO settings(key, value) VALUES ('platforms', 'Meta,Google,TikTok,Direct');
INSERT OR IGNORE INTO settings(key, value) VALUES ('statuses', 'Listed,Scheduled,Uploaded');
`);
try { db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE users ADD COLUMN password_salt TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE contents ADD COLUMN poster_status TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE contents ADD COLUMN full_video TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE contents ADD COLUMN short_ex TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE contents ADD COLUMN short_top TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE contents ADD COLUMN style_ex TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE contents ADD COLUMN style_top TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE contents ADD COLUMN poster TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE contents ADD COLUMN created_by INTEGER'); } catch (_) {}
try { db.exec("ALTER TABLE contents ADD COLUMN created_at TEXT DEFAULT (datetime('now'))"); } catch (_) {}
try { db.exec("ALTER TABLE contents ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))"); } catch (_) {}

const email = 'rubel.bhd1@gmail.com';
const password = process.env.INIT_ADMIN_PASSWORD;
if (password) {
  const existing = db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(email);
  const { hash, salt } = hashPassword(password);
  if (existing) db.prepare('UPDATE users SET display_name=?, role=?, password_hash=?, password_salt=? WHERE id=?').run('Rubel', 'owner', hash, salt, existing.id);
  else db.prepare('INSERT INTO users(display_name,email,role,password_hash,password_salt) VALUES (?,?,?,?,?)').run('Rubel', email, 'owner', hash, salt);
}
console.log('Initialized database: data.sqlite');
