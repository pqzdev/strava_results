-- Add admin_users table for Google OAuth whitelist
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  google_id TEXT,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at INTEGER
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

-- Add initial admins (using INSERT OR IGNORE to prevent errors if already exists)
INSERT OR IGNORE INTO admin_users (email, name) VALUES ('pedroqueiroz@gmail.com', 'Pedro Queiroz');
INSERT OR IGNORE INTO admin_users (email, name) VALUES ('woodstockresults@gmail.com', 'Woodstock Results');
