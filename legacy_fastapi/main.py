from __future__ import annotations

import os
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from starlette.middleware.sessions import SessionMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, select

from app.database import create_db_and_tables, get_session
from app.models import ChatSession, Message, UserAccount, utc_now
from app.schemas import AuthPayload, BootstrapResponse, ChatReply, MessageView, UserView, empty_profile
from app.services.auth import build_display_name, hash_password, normalize_email, verify_password
from app.services.coach import extract_profile_updates, generate_coach_reply, summarize_profile


BASE_DIR = Path(__file__).resolve().parent
SESSION_SECRET = os.getenv("SESSION_SECRET", "traider-dev-session-secret")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

app = FastAPI(title="trAIder")
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, same_site="lax")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.on_event("startup")
def on_startup() -> None:
    create_db_and_tables()


def profile_from_user(user: UserAccount) -> dict[str, str | None]:
    return {
        "experience_level": user.experience_level,
        "preferred_assets": user.preferred_assets,
        "strategy_style": user.strategy_style,
        "risk_tolerance": user.risk_tolerance,
        "trading_goal": user.trading_goal,
    }


def sync_profile(user: UserAccount, session: ChatSession, profile: dict[str, str | None]) -> None:
    user.experience_level = profile["experience_level"]
    user.preferred_assets = profile["preferred_assets"]
    user.strategy_style = profile["strategy_style"]
    user.risk_tolerance = profile["risk_tolerance"]
    user.trading_goal = profile["trading_goal"]
    user.updated_at = utc_now()

    session.experience_level = profile["experience_level"]
    session.preferred_assets = profile["preferred_assets"]
    session.strategy_style = profile["strategy_style"]
    session.risk_tolerance = profile["risk_tolerance"]
    session.trading_goal = profile["trading_goal"]
    session.updated_at = utc_now()


def get_current_user(request: Request, db: Session) -> UserAccount | None:
    user_id = request.session.get("user_id")
    if not user_id:
        return None

    user = db.get(UserAccount, user_id)
    if user is None:
        request.session.clear()
    return user


def require_current_user(request: Request, db: Session) -> UserAccount:
    user = get_current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return user


def get_latest_session(db: Session, user_id: str) -> ChatSession | None:
    return db.exec(
        select(ChatSession)
        .where(ChatSession.user_id == user_id)
        .order_by(ChatSession.updated_at.desc(), ChatSession.created_at.desc())
    ).first()


def session_messages(db: Session, session_id: str) -> list[MessageView]:
    rows = db.exec(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    ).all()
    return [MessageView(role=row.role, content=row.content) for row in rows]


def bootstrap_response(user: UserAccount, db: Session) -> BootstrapResponse:
    session = get_latest_session(db, user.id)
    messages = session_messages(db, session.id) if session else []
    profile = profile_from_user(user)
    return BootstrapResponse(
        authenticated=True,
        user=UserView(id=user.id, email=user.email, display_name=user.display_name),
        session_id=session.id if session else None,
        profile=profile,
        messages=messages,
        workspace_intro=default_workspace_message(user, profile, messages),
    )


def default_workspace_message(
    user: UserAccount,
    profile: dict[str, str | None],
    messages: list[MessageView],
) -> str:
    summary = summarize_profile(profile)
    if not messages and not any(profile.values()):
        return (
            f"{user.display_name}, I'm trAIder, your AI trading coach. "
            "Send a setup, screenshot, trade idea, or question and I'll help you think through it clearly "
            "while I build your trading profile with you."
        )

    parts = [
        f"Welcome back, {user.display_name}.",
        "I'm trAIder, your AI trading coach.",
        summary,
        "Send over a setup, screenshot, or trade question and I'll coach it with your saved profile in mind.",
    ]
    return " ".join(part for part in parts if part)


@app.get("/", response_class=HTMLResponse)
def index(request: Request, db: Session = Depends(get_session)) -> Response:
    user = get_current_user(request, db)
    if user is not None:
        return RedirectResponse(url="/app", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, db: Session = Depends(get_session)) -> Response:
    user = get_current_user(request, db)
    if user is not None:
        return RedirectResponse(url="/app", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/app", response_class=HTMLResponse)
def app_page(request: Request, db: Session = Depends(get_session)) -> Response:
    user = get_current_user(request, db)
    if user is None:
        return RedirectResponse(url="/", status_code=303)
    initial_bootstrap = bootstrap_response(user, db).model_dump()
    return templates.TemplateResponse(
        "app.html",
        {
            "request": request,
            "initial_bootstrap": initial_bootstrap,
        },
    )


@app.get("/api/bootstrap", response_model=BootstrapResponse)
def bootstrap(request: Request, db: Session = Depends(get_session)) -> BootstrapResponse:
    user = get_current_user(request, db)
    if user is None:
        return BootstrapResponse(authenticated=False, profile=empty_profile())
    return bootstrap_response(user, db)


@app.post("/api/auth/register", response_model=BootstrapResponse)
def register(
    payload: AuthPayload,
    request: Request,
    db: Session = Depends(get_session),
) -> BootstrapResponse:
    email = normalize_email(payload.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Use at least 8 characters for your password.")

    existing_user = db.exec(select(UserAccount).where(UserAccount.email == email)).first()
    if existing_user is not None:
        raise HTTPException(status_code=400, detail="That email already has an account.")

    user = UserAccount(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=build_display_name(payload.display_name, email),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    request.session["user_id"] = user.id
    return bootstrap_response(user, db)


@app.post("/api/auth/login", response_model=BootstrapResponse)
def login(
    payload: AuthPayload,
    request: Request,
    db: Session = Depends(get_session),
) -> BootstrapResponse:
    email = normalize_email(payload.email)
    user = db.exec(select(UserAccount).where(UserAccount.email == email)).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect email or password.")

    request.session["user_id"] = user.id
    user.updated_at = utc_now()
    db.add(user)
    db.commit()
    return bootstrap_response(user, db)


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=204)


@app.post("/logout")
def logout_page(request: Request) -> Response:
    request.session.clear()
    return RedirectResponse(url="/", status_code=303)


@app.post("/api/chat", response_model=ChatReply)
async def chat(
    request: Request,
    message: str = Form(...),
    session_id: str | None = Form(default=None),
    attachment: UploadFile | None = File(default=None),
    db: Session = Depends(get_session),
) -> ChatReply:
    user = require_current_user(request, db)
    clean_message = message.strip()
    if not clean_message:
        clean_message = "Please help me get started."

    session = None
    if session_id:
        session = db.exec(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user.id,
            )
        ).first()

    if session is None:
        session = get_latest_session(db, user.id)

    if session is None:
        session = ChatSession(user_id=user.id)
        sync_profile(user, session, profile_from_user(user))
        db.add(session)
        db.commit()
        db.refresh(session)

    attachment_bytes = await attachment.read() if attachment else None
    attachment_name = attachment.filename if attachment else None
    attachment_media_type = attachment.content_type if attachment else None

    history_rows = db.exec(
        select(Message)
        .where(Message.session_id == session.id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    ).all()
    history = [{"role": row.role, "content": row.content} for row in history_rows]

    current_profile = profile_from_user(user)
    updated_profile = extract_profile_updates(clean_message, current_profile)

    db.add(
        Message(
            session_id=session.id,
            role="user",
            content=clean_message,
            attachment_name=attachment_name,
            attachment_media_type=attachment_media_type,
        )
    )

    reply = generate_coach_reply(
        user_message=clean_message,
        history=history,
        user_name=user.display_name,
        profile=updated_profile,
        attachment_bytes=attachment_bytes,
        attachment_name=attachment_name,
        attachment_media_type=attachment_media_type,
    )

    db.add(
        Message(
            session_id=session.id,
            role="assistant",
            content=reply,
        )
    )

    sync_profile(user, session, updated_profile)
    session.user_id = user.id
    db.add(user)
    db.add(session)
    db.commit()

    return ChatReply(
        session_id=session.id,
        assistant_message=reply,
        profile=updated_profile,
    )
