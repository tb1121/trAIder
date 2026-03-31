from __future__ import annotations

import base64
import json
import os
import re
from typing import Any

from openai import OpenAI


PROFILE_QUESTIONS = {
    "experience_level": "What best describes you right now: beginner, developing, or professional?",
    "preferred_assets": "Which markets are you focused on most right now: stocks, options, futures, forex, or crypto?",
    "strategy_style": "What kind of trading style are you aiming for: scalping, day trading, swing trading, or longer-term positioning?",
    "risk_tolerance": "How would you describe your risk comfort today: conservative, balanced, or aggressive?",
    "trading_goal": "What would make trAIder most useful for you over the next month: consistency, education, discipline, or performance review?",
}

SYSTEM_PROMPT = """
You are trAIder, a professional AI trading coach.

Your role:
- Give clear, calm, high-signal coaching on trades, screenshots, questions, and trading habits.
- Support beginners, rookies, and experienced traders without sounding condescending.
- Keep replies concise, practical, and professional.
- Gently gather profile details over time instead of asking a long survey all at once.
- Prefer asking for one focused follow-up question that helps tailor future coaching.
- Treat every answer as educational guidance, not financial advice.

Response style:
- Use short paragraphs.
- If the user shares a setup or trade, comment on structure, risk, and what is still unclear.
- If the user shares a screenshot, explain what extra context would sharpen the feedback.
- Use the trader's name naturally when it adds warmth, but do not force it into every reply.
- Treat the saved profile JSON as persistent user context for every answer.
- End with exactly one soft follow-up question when helpful.
""".strip()

EXPERIENCE_MAP = {
    "beginner": "beginner",
    "new trader": "beginner",
    "rookie": "beginner",
    "learning": "beginner",
    "intermediate": "developing",
    "developing": "developing",
    "experienced": "professional",
    "professional": "professional",
    "pro trader": "professional",
}

ASSET_HINTS = {
    "stocks": "stocks",
    "equities": "stocks",
    "options": "options",
    "futures": "futures",
    "forex": "forex",
    "fx": "forex",
    "crypto": "crypto",
}

STYLE_HINTS = {
    "scalp": "scalping",
    "day trade": "day trading",
    "intraday": "day trading",
    "swing": "swing trading",
    "position": "position trading",
}

RISK_HINTS = {
    "conservative": "conservative",
    "low risk": "conservative",
    "balanced": "balanced",
    "moderate risk": "balanced",
    "aggressive": "aggressive",
    "high risk": "aggressive",
}

GOAL_HINTS = {
    "consistency": "consistency",
    "discipline": "discipline",
    "education": "education",
    "learn": "education",
    "performance": "performance review",
    "review": "performance review",
    "income": "income growth",
}


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_reply_text(value: str) -> str:
    paragraphs = [
        re.sub(r"[ \t]+", " ", paragraph).strip()
        for paragraph in value.replace("\r\n", "\n").split("\n\n")
    ]
    return "\n\n".join(paragraph for paragraph in paragraphs if paragraph)


def extract_profile_updates(
    user_message: str, current_profile: dict[str, str | None]
) -> dict[str, str | None]:
    lowered = user_message.lower()
    profile = dict(current_profile)

    for keyword, mapped in EXPERIENCE_MAP.items():
        if keyword in lowered:
            profile["experience_level"] = mapped
            break

    assets = [mapped for keyword, mapped in ASSET_HINTS.items() if keyword in lowered]
    if assets:
        profile["preferred_assets"] = ", ".join(dict.fromkeys(assets))

    for keyword, mapped in STYLE_HINTS.items():
        if keyword in lowered:
            profile["strategy_style"] = mapped
            break

    for keyword, mapped in RISK_HINTS.items():
        if keyword in lowered:
            profile["risk_tolerance"] = mapped
            break

    for keyword, mapped in GOAL_HINTS.items():
        if keyword in lowered:
            profile["trading_goal"] = mapped
            break

    return profile


def summarize_attachment(filename: str | None, media_type: str | None) -> str | None:
    if not filename:
        return None

    kind = "upload"
    if media_type and media_type.startswith("image/"):
        kind = "screenshot"

    return f"The user attached a {kind} named '{filename}' ({media_type or 'unknown type'})."


def build_history_summary(history: list[dict[str, str]]) -> list[dict[str, Any]]:
    return [{"role": item["role"], "content": item["content"]} for item in history[-8:]]


def build_user_content(
    message: str,
    attachment_bytes: bytes | None,
    attachment_name: str | None,
    attachment_media_type: str | None,
) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{"type": "text", "text": message}]
    if attachment_bytes and attachment_media_type and attachment_media_type.startswith("image/"):
        encoded = base64.b64encode(attachment_bytes).decode("utf-8")
        data_url = f"data:{attachment_media_type};base64,{encoded}"
        content.append({"type": "image_url", "image_url": {"url": data_url}})
    elif attachment_name:
        content.append(
            {
                "type": "text",
                "text": summarize_attachment(attachment_name, attachment_media_type) or "",
            }
        )
    return content


def next_profile_question(profile: dict[str, str | None]) -> str | None:
    for key, question in PROFILE_QUESTIONS.items():
        if not profile.get(key):
            return question
    return None


def summarize_profile(profile: dict[str, str | None]) -> str | None:
    segments: list[str] = []
    if profile.get("experience_level"):
        segments.append(profile["experience_level"])
    if profile.get("strategy_style"):
        segments.append(profile["strategy_style"])
    if profile.get("preferred_assets"):
        segments.append(f"focused on {profile['preferred_assets']}")
    if profile.get("risk_tolerance"):
        segments.append(f"with a {profile['risk_tolerance']} risk profile")
    if profile.get("trading_goal"):
        segments.append(f"working toward {profile['trading_goal']}")

    if not segments:
        return None

    return "I am using your saved profile context as " + ", ".join(segments) + "."


def build_profile_json(profile: dict[str, str | None]) -> str:
    return json.dumps(profile, sort_keys=True)


def fallback_reply(
    user_message: str,
    user_name: str | None,
    profile: dict[str, str | None],
    attachment_name: str | None,
    attachment_media_type: str | None,
) -> str:
    clean_message = normalize_whitespace(user_message)
    lead = "I can help you break that down in a structured, trader-first way."
    if user_name:
        lead = f"{user_name}, I can help you break that down in a structured, trader-first way."
    if attachment_name:
        lead = (
            f"{user_name + ', ' if user_name else ''}I reviewed the context around your upload, {attachment_name}, and I can help you frame it clearly."
        )

    observations: list[str] = []
    lowered = clean_message.lower()
    if any(keyword in lowered for keyword in ("entry", "stop", "target", "risk")):
        observations.append(
            "You are already thinking in terms of trade structure, which is the right foundation."
        )
    if any(keyword in lowered for keyword in ("spy", "qqq", "nvda", "tsla", "aapl", "btc", "eth")):
        observations.append(
            "Instrument context matters here because volatility and liquidity can change how tight your execution needs to be."
        )
    if attachment_media_type and attachment_media_type.startswith("image/"):
        observations.append(
            "For chart screenshots, the most useful additions are ticker, timeframe, entry idea, stop level, and intended target."
        )
    if not observations:
        observations.append(
            "The next step is to turn your input into a repeatable decision process instead of a one-off opinion."
        )

    question = next_profile_question(profile)
    profile_summary = summarize_profile(profile)
    reply_parts = [
        lead,
        profile_summary,
        " ".join(observations),
        "I'll keep this educational and practical so you can build a cleaner process over time.",
    ]
    if question:
        reply_parts.append(question)

    return "\n\n".join(part for part in reply_parts if part)


def build_profile_block(profile: dict[str, str | None]) -> str:
    lines = ["Current profile context:"]
    for key, value in profile.items():
        label = key.replace("_", " ").title()
        lines.append(f"- {label}: {value or 'unknown'}")
    return "\n".join(lines)


def call_llm(
    user_message: str,
    history: list[dict[str, str]],
    user_name: str | None,
    profile: dict[str, str | None],
    attachment_bytes: bytes | None,
    attachment_name: str | None,
    attachment_media_type: str | None,
) -> str | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    client = OpenAI(api_key=api_key)
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

    system_text = "\n\n".join(
        [
            SYSTEM_PROMPT,
            f"Trader display name: {user_name or 'unknown'}",
            build_profile_block(profile),
            f"Saved profile JSON: {build_profile_json(profile)}",
            summarize_attachment(attachment_name, attachment_media_type) or "No file attached.",
        ]
    )

    messages = [{"role": "system", "content": system_text}]
    messages.extend(build_history_summary(history))
    messages.append(
        {
            "role": "user",
            "content": build_user_content(
                user_message,
                attachment_bytes,
                attachment_name,
                attachment_media_type,
            ),
        }
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.7,
        )
    except Exception:
        return None

    choice = response.choices[0].message
    content = choice.content
    if isinstance(content, str):
        return normalize_reply_text(content)

    text_parts: list[str] = []
    for part in content or []:
        if getattr(part, "type", None) == "text":
            text_parts.append(getattr(part, "text", ""))
    result = normalize_reply_text("\n\n".join(text_parts))
    return result or None


def generate_coach_reply(
    user_message: str,
    history: list[dict[str, str]],
    user_name: str | None,
    profile: dict[str, str | None],
    attachment_bytes: bytes | None,
    attachment_name: str | None,
    attachment_media_type: str | None,
) -> str:
    llm_reply = call_llm(
        user_message=user_message,
        history=history,
        user_name=user_name,
        profile=profile,
        attachment_bytes=attachment_bytes,
        attachment_name=attachment_name,
        attachment_media_type=attachment_media_type,
    )
    if llm_reply:
        return llm_reply

    return fallback_reply(
        user_message=user_message,
        user_name=user_name,
        profile=profile,
        attachment_name=attachment_name,
        attachment_media_type=attachment_media_type,
    )
