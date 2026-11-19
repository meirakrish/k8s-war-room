/**
 * The board's whole state lives in three tables.
 *
 * tasks   mutable work items (a small state machine: open -> claimed -> done | failed)
 * posts   what agents say about a task: findings, hypotheses, questions, decisions
 * events  append-only log of every state change; the audit trail, and what a live UI will tail
 *
 * Design notes:
 * - The status machine is enforced by CHECK constraints, so a bug in application code cannot write garbage.
 * - `events` is made append-only by triggers rather than by convention: UPDATE and DELETE raise.
 * - input / result / evidence / payload are JSON text. The board does not interpret them; agents agree on shapes.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'done', 'failed')),
  claimed_by  TEXT,
  parent_id   INTEGER REFERENCES tasks(id),
  input       TEXT NOT NULL DEFAULT 'null',
  result      TEXT NOT NULL DEFAULT 'null',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  -- an open task has no owner; every other state has one
  CHECK ((status = 'open') = (claimed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS tasks_by_status ON tasks(status, type);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id),
  agent       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('finding', 'hypothesis', 'question', 'decision')),
  content     TEXT NOT NULL,
  evidence    TEXT NOT NULL DEFAULT 'null',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_by_task ON posts(task_id);

CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  actor     TEXT NOT NULL,
  type      TEXT NOT NULL,
  task_id   INTEGER,
  payload   TEXT NOT NULL DEFAULT 'null'
);

CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
`;
