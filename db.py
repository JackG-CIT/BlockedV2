"""Database access for Blocked.

By default everything is stored in a local SQLite file (blocked.db), so the
game runs with no setup. Set DATABASE_URL to a Postgres connection string
(for example a free Neon database) to use Postgres instead.

Queries are written with ? placeholders; they're converted to %s for Postgres.
"""
import os
import sqlite3

from flask import g


def database_url():
    return os.environ.get("DATABASE_URL", "").strip()


def is_postgres():
    return database_url().startswith(("postgres://", "postgresql://"))


def sqlite_path():
    default = os.path.join(os.path.dirname(os.path.abspath(__file__)), "blocked.db")
    return os.environ.get("SQLITE_PATH", default)


def connect():
    if is_postgres():
        import psycopg2
        import psycopg2.extras
        return psycopg2.connect(database_url(), cursor_factory=psycopg2.extras.RealDictCursor)
    conn = sqlite3.connect(sqlite_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    if "db" not in g:
        g.db = connect()
    return g.db


def close_db(exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def _sql(sql):
    return sql.replace("?", "%s") if is_postgres() else sql


def query(sql, args=(), one=False):
    cur = get_db().cursor()
    cur.execute(_sql(sql), args)
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    if one:
        return rows[0] if rows else None
    return rows


def execute(sql, args=()):
    cur = get_db().cursor()
    cur.execute(_sql(sql), args)
    cur.close()


def insert(sql, args=()):
    """Runs an INSERT and returns the new row's id."""
    cur = get_db().cursor()
    if is_postgres():
        cur.execute(_sql(sql) + " RETURNING id", args)
        new_id = cur.fetchone()["id"]
    else:
        cur.execute(sql, args)
        new_id = cur.lastrowid
    cur.close()
    return new_id


def commit():
    get_db().commit()


# ----------------- SCHEMA -----------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS blocked_users (
    id {pk},
    username VARCHAR(40) NOT NULL UNIQUE,
    email VARCHAR(120),
    password VARCHAR(200) NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS blocked_levels (
    id {pk},
    name VARCHAR(80) NOT NULL,
    notes TEXT,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_by INTEGER REFERENCES blocked_users(id) ON DELETE SET NULL,
    published INTEGER NOT NULL DEFAULT 0,
    in_campaign INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    difficulty INTEGER,
    par_moves INTEGER,
    transition_line TEXT,
    solution TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS blocked_tiles (
    id {pk},
    level_id INTEGER NOT NULL REFERENCES blocked_levels(id) ON DELETE CASCADE,
    tile_type VARCHAR(20) NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    direction VARCHAR(10),
    ax INTEGER,
    ay INTEGER
);
CREATE TABLE IF NOT EXISTS blocked_completions (
    id {pk},
    user_id INTEGER NOT NULL REFERENCES blocked_users(id) ON DELETE CASCADE,
    level_id INTEGER NOT NULL REFERENCES blocked_levels(id) ON DELETE CASCADE,
    finish_ms INTEGER NOT NULL,
    total_moves INTEGER NOT NULL,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS blocked_tiles_level ON blocked_tiles (level_id);
CREATE INDEX IF NOT EXISTS blocked_completions_level ON blocked_completions (level_id, user_id)
"""


def create_tables():
    pk = "SERIAL PRIMARY KEY" if is_postgres() else "INTEGER PRIMARY KEY AUTOINCREMENT"
    conn = connect()
    cur = conn.cursor()
    for statement in SCHEMA.format(pk=pk).split(";"):
        if statement.strip():
            cur.execute(statement)
    # Columns added after the first release: add them to older databases.
    for column, kind in (('difficulty', 'INTEGER'), ('par_moves', 'INTEGER'), ('transition_line', 'TEXT'), ('solution', 'TEXT')):
        if is_postgres():
            cur.execute(f'ALTER TABLE blocked_levels ADD COLUMN IF NOT EXISTS {column} {kind}')
        else:
            cur.execute('PRAGMA table_info(blocked_levels)')
            if column not in [row[1] for row in cur.fetchall()]:
                cur.execute(f'ALTER TABLE blocked_levels ADD COLUMN {column} {kind}')
    conn.commit()
    cur.close()
    conn.close()


def init_app(app):
    app.teardown_appcontext(close_db)
    create_tables()
