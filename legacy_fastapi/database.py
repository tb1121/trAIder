from collections.abc import Generator
from pathlib import Path
import sqlite3

from sqlmodel import Session, SQLModel, create_engine


DATABASE_URL = "sqlite:///./traider.db"
DATABASE_PATH = Path("traider.db")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)
    migrate_existing_db()


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def migrate_existing_db() -> None:
    if not DATABASE_PATH.exists():
        return

    with sqlite3.connect(DATABASE_PATH) as connection:
        chat_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(chatsession)").fetchall()
        }
        if chat_columns and "user_id" not in chat_columns:
            connection.execute("ALTER TABLE chatsession ADD COLUMN user_id VARCHAR")

        connection.execute(
            "CREATE INDEX IF NOT EXISTS ix_chatsession_user_id ON chatsession (user_id)"
        )
        connection.commit()
