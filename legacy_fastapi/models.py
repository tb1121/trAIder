from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class UserAccount(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    display_name: str = Field(default="Trader")
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)
    experience_level: str | None = Field(default=None)
    preferred_assets: str | None = Field(default=None)
    strategy_style: str | None = Field(default=None)
    risk_tolerance: str | None = Field(default=None)
    trading_goal: str | None = Field(default=None)


class ChatSession(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str | None = Field(default=None, foreign_key="useraccount.id", index=True)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=utc_now, nullable=False)
    experience_level: str | None = Field(default=None)
    preferred_assets: str | None = Field(default=None)
    strategy_style: str | None = Field(default=None)
    risk_tolerance: str | None = Field(default=None)
    trading_goal: str | None = Field(default=None)


class Message(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(foreign_key="chatsession.id", index=True)
    role: str = Field(index=True)
    content: str
    attachment_name: str | None = Field(default=None)
    attachment_media_type: str | None = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)
