ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN username TEXT;

CREATE UNIQUE INDEX users_username_lower_unique
  ON users (lower(username)) WHERE username IS NOT NULL;