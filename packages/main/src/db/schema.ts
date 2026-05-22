import type Database from "better-sqlite3";

export function migrate(database: Database.Database): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS kanban_boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      completion_column_id TEXT,
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
      description_markdown TEXT,
      description_json TEXT,
      description_text TEXT,
      subtasks_json TEXT NOT NULL DEFAULT '[]',
      comments_json TEXT NOT NULL DEFAULT '[]',
      priority TEXT NOT NULL DEFAULT 'none',
      due_date INTEGER,
      start_date INTEGER,
      end_date INTEGER,
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

    CREATE TABLE IF NOT EXISTS kanban_recurrence_series (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
      trigger_mode TEXT NOT NULL,
      cycle TEXT NOT NULL,
      active_baton_card_id TEXT REFERENCES kanban_cards(id) ON DELETE SET NULL,
      template_json TEXT NOT NULL,
      status TEXT NOT NULL,
      blocked_reason TEXT,
      last_occurrence_date INTEGER NOT NULL,
      anchor_day INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      stopped_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_kanban_recurrence_series_board
      ON kanban_recurrence_series(board_id, status);

    CREATE INDEX IF NOT EXISTS idx_kanban_recurrence_series_baton
      ON kanban_recurrence_series(active_baton_card_id, status);

    CREATE TABLE IF NOT EXISTS kanban_recurrence_occurrences (
      series_id TEXT NOT NULL REFERENCES kanban_recurrence_series(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
      occurrence_date INTEGER NOT NULL,
      generated_next_at INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (series_id, card_id)
    );

    CREATE INDEX IF NOT EXISTS idx_kanban_recurrence_occurrences_card
      ON kanban_recurrence_occurrences(card_id);
  `);

  ensureColumn(database, "kanban_boards", "completion_column_id", "TEXT");
  ensureColumn(database, "kanban_cards", "description_markdown", "TEXT");
  ensureColumn(database, "kanban_cards", "subtasks_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, "kanban_cards", "comments_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, "kanban_cards", "start_date", "INTEGER");
  ensureColumn(database, "kanban_cards", "end_date", "INTEGER");
  ensureColumn(database, "kanban_recurrence_series", "anchor_day", "INTEGER NOT NULL DEFAULT 1");
  database
    .prepare(
      `UPDATE kanban_cards
       SET description_markdown = description_text
       WHERE description_markdown IS NULL
         AND description_text IS NOT NULL`
    )
    .run();
  database
    .prepare(
      `UPDATE kanban_cards
       SET start_date = due_date,
           end_date = due_date
       WHERE due_date IS NOT NULL
         AND start_date IS NULL
         AND end_date IS NULL`
    )
    .run();
  database
    .prepare(
      `UPDATE kanban_boards
       SET completion_column_id = COALESCE(
         (SELECT id FROM kanban_columns
          WHERE board_id = kanban_boards.id
            AND archived_at IS NULL
            AND lower(name) = 'done'
          ORDER BY sort_order DESC
          LIMIT 1),
         (SELECT id FROM kanban_columns
          WHERE board_id = kanban_boards.id
            AND archived_at IS NULL
          ORDER BY sort_order DESC
          LIMIT 1)
       )
       WHERE completion_column_id IS NULL`
    )
    .run();
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}
