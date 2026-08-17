CREATE TABLE IF NOT EXISTS project_readmes (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
