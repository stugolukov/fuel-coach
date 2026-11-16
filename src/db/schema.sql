CREATE TABLE IF NOT EXISTS profiles (
  chat_id BIGINT PRIMARY KEY,
  height_cm INTEGER NOT NULL DEFAULT 186,
  birth_date DATE NOT NULL DEFAULT '1987-02-01',
  sex TEXT NOT NULL DEFAULT 'm',
  preferences TEXT NOT NULL DEFAULT '',
  allergies TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Для баз, створених попередньою версією схеми
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birth_date DATE NOT NULL DEFAULT '1987-02-01';
ALTER TABLE profiles ALTER COLUMN height_cm SET DEFAULT 186;
ALTER TABLE profiles DROP COLUMN IF EXISTS age;

CREATE TABLE IF NOT EXISTS processed_activities (
  activity_id TEXT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  date DATE NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manual_logs (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  date DATE NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL,
  kcal INTEGER NOT NULL DEFAULT 0,
  alcohol_g REAL NOT NULL DEFAULT 0,
  carbs_g INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manual_logs_chat_date ON manual_logs(chat_id, date);

CREATE TABLE IF NOT EXISTS recommendations (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  date DATE NOT NULL,
  kind TEXT NOT NULL,            -- breakfast | daily | evening | rest_day | weekly | morning
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recommendations_chat_date ON recommendations(chat_id, date, kind);

CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  recipe_name TEXT NOT NULL,
  rating INTEGER NOT NULL,       -- 1 = сподобалось, -1 = ні
  created_at TIMESTAMPTZ DEFAULT now()
);
