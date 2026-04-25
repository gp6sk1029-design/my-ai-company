-- ライフプランくん D1 同期スキーマ
-- 方針:
--   householdId でマルチテナント分離
--   updatedAt(UNIX秒) で last-write-wins
--   deletedAt(UNIX秒, NULL=未削除) で論理削除
--   payload に JSON 文字列でストア別のオブジェクトをまるごと格納

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER
);

CREATE TABLE IF NOT EXISTS members (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_members_updatedAt ON members(householdId, updatedAt);

CREATE TABLE IF NOT EXISTS income (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_income_updatedAt ON income(householdId, updatedAt);

CREATE TABLE IF NOT EXISTS expense (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_expense_updatedAt ON expense(householdId, updatedAt);

CREATE TABLE IF NOT EXISTS education (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_education_updatedAt ON education(householdId, updatedAt);

CREATE TABLE IF NOT EXISTS assets (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_assets_updatedAt ON assets(householdId, updatedAt);

CREATE TABLE IF NOT EXISTS events (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_events_updatedAt ON events(householdId, updatedAt);

CREATE TABLE IF NOT EXISTS mfSnapshots (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_mfSnapshots_updatedAt ON mfSnapshots(householdId, updatedAt);
