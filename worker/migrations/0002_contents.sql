-- Content production workflow
CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  full_video_status TEXT,
  short_ex_status TEXT,
  short_top_status TEXT,
  style_ex_status TEXT,
  style_top_status TEXT,
  poster_status TEXT,
  full_video TEXT,
  short_ex TEXT,
  short_top TEXT,
  style_ex TEXT,
  style_top TEXT,
  poster TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contents_created_at ON contents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contents_full_video_status ON contents(full_video_status);
CREATE INDEX IF NOT EXISTS idx_contents_video_statuses ON contents(short_ex_status, short_top_status, style_ex_status, style_top_status);
