-- 献立くん D1 同期用スキーマ
-- 設計方針:
--   - 全テーブルに householdId を付与してマルチテナント化
--   - updatedAt（UNIX秒）で last-write-wins マージ
--   - 論理削除は deletedAt（UNIX秒、NULL=未削除）
--   - payload は JSON文字列（レシピの ingredients/steps など複雑な構造をまとめて格納）
--   - PRIMARY KEY は (householdId, id) の複合にして他世帯への影響を遮断

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY NOT NULL,
  avoidMode TEXT DEFAULT 'any',
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER
);

CREATE TABLE IF NOT EXISTS members (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,          -- JSON: {name, kind, age, allergies, dislikes, likes}
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_members_updatedAt ON members(householdId, updatedAt);

CREATE TABLE IF NOT EXISTS recipes (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,          -- JSON: レシピ全体
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_recipes_updatedAt ON recipes(householdId, updatedAt);

CREATE TABLE IF NOT EXISTS cookHistory (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_cookHistory_updatedAt ON cookHistory(householdId, updatedAt);

CREATE TABLE IF NOT EXISTS shopping (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_shopping_updatedAt ON shopping(householdId, updatedAt);

CREATE TABLE IF NOT EXISTS stock (
  householdId TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  deletedAt INTEGER,
  PRIMARY KEY (householdId, id)
);
CREATE INDEX IF NOT EXISTS idx_stock_updatedAt ON stock(householdId, updatedAt);
