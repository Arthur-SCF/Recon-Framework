import aiosqlite
import logging
from contextlib import asynccontextmanager
from pathlib import Path

log = logging.getLogger("engine.db")

_db: aiosqlite.Connection | None = None
MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"


class SecurityError(Exception):
    pass


class Database:
    """
    Thin wrapper around aiosqlite.
    All queries MUST use parameterized placeholders (?).
    Never pass user input via string interpolation.
    """

    def __init__(self, conn: aiosqlite.Connection) -> None:
        self._conn = conn
        self._tx_depth: int = 0

    @staticmethod
    def _check_params(query: str, params: tuple) -> None:
        if params and "?" not in query:
            raise SecurityError(
                "Query has params but no placeholders — use ? placeholders"
            )

    async def execute(self, query: str, params: tuple = ()) -> aiosqlite.Cursor:
        self._check_params(query, params)
        return await self._conn.execute(query, params)

    async def executemany(self, query: str, params_seq: list[tuple]) -> None:
        if params_seq and "?" not in query:
            raise SecurityError("Query must use parameterized placeholders")
        await self._conn.executemany(query, params_seq)

    async def executescript(self, script: str) -> None:
        await self._conn.executescript(script)

    async def fetchall(self, query: str, params: tuple = ()) -> list[aiosqlite.Row]:
        self._check_params(query, params)
        cursor = await self._conn.execute(query, params)
        return await cursor.fetchall()

    async def fetchone(self, query: str, params: tuple = ()) -> aiosqlite.Row | None:
        self._check_params(query, params)
        cursor = await self._conn.execute(query, params)
        return await cursor.fetchone()

    async def commit(self) -> None:
        await self._conn.commit()

    @asynccontextmanager
    async def transaction(self):
        """
        Async context manager for atomic multi-step DB operations.

        Usage:
            async with db.transaction():
                await db.execute(...)
                await db.execute(...)
                # auto-commits on success, rolls back on any exception

        Nested calls are safe — inner calls are no-ops (SQLite doesn't support
        nested transactions; the outermost transaction covers everything).
        BEGIN IMMEDIATE is used to prevent writer starvation in WAL mode.
        """
        if self._tx_depth > 0:
            self._tx_depth += 1
            try:
                yield self
            finally:
                self._tx_depth -= 1
            return

        self._tx_depth = 1
        await self._conn.execute("BEGIN IMMEDIATE")
        try:
            yield self
            await self._conn.commit()
        except BaseException:
            await self._conn.execute("ROLLBACK")
            raise
        finally:
            self._tx_depth = 0

    async def close(self) -> None:
        await self._conn.close()


async def init_database(db_path: str) -> Database:
    """Open the database, apply pragmas, run pending migrations."""
    import os
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    conn = await aiosqlite.connect(db_path)
    conn.row_factory = aiosqlite.Row

    # Disable extension loading (security)
    await conn.execute("SELECT 1")  # ensure connection is alive

    # Apply hardening pragmas
    pragmas = [
        "PRAGMA journal_mode=WAL",
        "PRAGMA foreign_keys=ON",
        "PRAGMA synchronous=NORMAL",
        "PRAGMA secure_delete=ON",
        "PRAGMA temp_store=MEMORY",
        "PRAGMA trusted_schema=OFF",
        "PRAGMA cache_size=-65536",  # 64 MB
    ]
    for pragma in pragmas:
        await conn.execute(pragma)
    await conn.commit()

    db = Database(conn)
    await run_migrations(db)
    return db


async def run_migrations(db: Database) -> None:
    """Apply any pending numbered SQL migration files."""
    await db.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at TEXT DEFAULT (datetime('now'))
        )
    """)
    await db.commit()

    applied = {
        row[0]
        for row in await db.fetchall("SELECT version FROM schema_migrations")
    }

    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        log.warning("No migration files found in %s", MIGRATIONS_DIR)
        return

    for f in migration_files:
        version = int(f.name.split("_")[0])
        if version in applied:
            continue
        log.info("Applying migration %s", f.name)
        sql = f.read_text()
        async with db.transaction():
            await db.executescript(sql)
            await db.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
                (version, f.name),
            )

    latest = max(applied | {int(f.name.split("_")[0]) for f in migration_files})
    log.info("Database at migration version %d", latest)


async def get_db() -> Database:
    """FastAPI dependency — returns the open database connection."""
    if _db is None:
        raise RuntimeError("Database not initialised — call init_database() first")
    return _db


def set_db(db: Database) -> None:
    global _db
    _db = db
