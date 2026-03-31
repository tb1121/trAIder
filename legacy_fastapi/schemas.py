from pydantic import BaseModel, Field


def empty_profile() -> dict[str, str | None]:
    return {
        "experience_level": None,
        "preferred_assets": None,
        "strategy_style": None,
        "risk_tolerance": None,
        "trading_goal": None,
    }


class AuthPayload(BaseModel):
    email: str
    password: str
    display_name: str | None = None


class UserView(BaseModel):
    id: str
    email: str
    display_name: str


class MessageView(BaseModel):
    role: str
    content: str


class BootstrapResponse(BaseModel):
    authenticated: bool
    user: UserView | None = None
    session_id: str | None = None
    profile: dict[str, str | None] = Field(default_factory=empty_profile)
    messages: list[MessageView] = Field(default_factory=list)
    workspace_intro: str | None = None


class ChatReply(BaseModel):
    session_id: str
    assistant_message: str
    profile: dict[str, str | None]
