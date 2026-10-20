export async function initializeSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS recipes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  toml text NOT NULL,
  user_id bigint REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS images (
  id uuid PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime text NOT NULL,
  data bytea NOT NULL CHECK (octet_length(data) <= 5242880)
);
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS user_id bigint REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS recipes_user_id_idx ON recipes(user_id);
`);
}
