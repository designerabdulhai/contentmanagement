const crypto = require('crypto');
const Database = require('better-sqlite3');

const db = new Database('data.sqlite');
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
const safeEqual = (a, b) => {
  const aa = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};

module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = db.prepare('SELECT id, display_name, email, photo, role, password_hash, password_salt FROM users WHERE lower(email)=?').get(email);
  if (!user || !user.password_hash || !user.password_salt || !safeEqual(hashPassword(password, user.password_salt), user.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const publicUser = { id: user.id, display_name: user.display_name, email: user.email, photo: user.photo, role: user.role };
  sessions.set(token, { user: publicUser, expiresAt: Date.now() + SESSION_TTL_MS });
  return res.json({ token, user: publicUser });
};
