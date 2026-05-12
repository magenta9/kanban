import type Database from "better-sqlite3";

export function migrate(database: Database.Database): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS kanban_boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS kanban_columns (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT,
      sort_order REAL NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_kanban_columns_board_order
      ON kanban_columns(board_id, archived_at, sort_order);

    CREATE TABLE IF NOT EXISTS kanban_cards (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL REFERENCES kanban_columns(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      description_json TEXT,
      description_text TEXT,
      subtasks_json TEXT NOT NULL DEFAULT '[]',
      comments_json TEXT NOT NULL DEFAULT '[]',
      priority TEXT NOT NULL DEFAULT 'none',
      due_date INTEGER,
      sort_order REAL NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_kanban_cards_board_column
      ON kanban_cards(board_id, column_id, archived_at, sort_order);

    CREATE TABLE IF NOT EXISTS kanban_labels (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kanban_card_labels (
      card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES kanban_labels(id) ON DELETE CASCADE,
      PRIMARY KEY (card_id, label_id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value BLOB NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('save', 'delete')),
      changed_fields_json TEXT,
      created_at INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_outbox_created_at
      ON sync_outbox(created_at);

    CREATE TABLE IF NOT EXISTS sync_tombstones (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      deleted_at INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS ck_record_metadata (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      record_name TEXT NOT NULL,
      metadata BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (entity_type, entity_id),
      UNIQUE (record_name)
    );
  `);

  ensureColumn(database, "kanban_cards", "subtasks_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, "kanban_cards", "comments_json", "TEXT NOT NULL DEFAULT '[]'");
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}
