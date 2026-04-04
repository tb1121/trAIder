import OpenAI from "openai";
import { parseDisplayNameUpdateRequest } from "@/lib/display-name";

export type TradingProfile = {
  experience_level: string | null;
  focus_tickers: string | null;
  preferred_assets: string | null;
  strategy_style: string | null;
  trading_rules: string | null;
  risk_tolerance: string | null;
  trading_goal: string | null;
};

export type WorkspaceMessage = {
  attachmentDataUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  createdAt: string;
  role: "user" | "assistant";
  content: string;
  quickActions?: WorkspaceQuickAction[] | null;
};

export type WorkspaceQuickAction = {
  kind: "prefill" | "submit";
  label: string;
  prompt: string;
};

export type ProfileChangeNotification = {
  changeType: "added" | "updated" | "removed";
  detail: string;
  fieldKey: keyof TradingProfile;
  title: string;
};

type CoachReplyInput = {
  attachmentBytes: Buffer | null;
  attachmentName: string | null;
  attachmentType: string | null;
  history: WorkspaceMessage[];
  profile: TradingProfile;
  previousProfile: TradingProfile;
  profileUpdateApplied: boolean;
  profileUpdateSummary: string | null;
  tradeCalendarBrief?: string | null;
  userMessage: string;
  userName: string;
  webSearchBrief?: string | null;
};

export type CoachReplyResult =
  | {
      mode: "reply";
      reply: string;
    }
  | {
      fallbackReply: string;
      mode: "stream";
      stream: AsyncIterable<string>;
    };

type WebSearchResult = {
  link: string;
  source: string;
  snippet: string;
  title: string;
};

type ConversationTitleInput = {
  assistantMessage: string;
  userMessage: string;
};

const SYSTEM_PROMPT = `
You are trAIder, a professional AI trading coach.

Your job:
- Coach beginners, developing traders, and professionals without sounding robotic or patronizing.
- Give clean, practical feedback on trade ideas, screenshots, orders, journals, and trading process.
- Use the trader's display name sparingly. It should feel occasional, not repetitive.
- Avoid using the trader's display name in consecutive replies, and leave it out on most turns unless it adds real warmth or clarity.
- Treat the saved profile JSON as persistent context for every answer.
- Treat the active chat thread as important working memory. If the user refers to something earlier in the same conversation, use that thread context before asking them to repeat themselves.
- Keep the conversation centered on trading, markets, risk, execution, process, and the trader's saved profile.
- If the user goes off-topic into unrelated entertainment, movies, pop culture, or general chit-chat, briefly redirect them back to trading instead of following the unrelated topic.
- Only treat something as a ticker when it is clearly being used as a market symbol in context. Do not infer tickers from initials, dotted abbreviations, or unrelated references.
- If the user asks for a web lookup and no web search results were provided to you, do not claim you fundamentally cannot browse. Instead, say the web search connector is not configured for this turn and continue helping with the trading context you do have.
- trAIder can update saved profile memory server-side. Never claim you cannot update saved profile data.
- Never claim a trade was logged to the P&L calendar unless this turn explicitly tells you the server already verified that save. If you do not have that confirmation, ask for the ticker and realized P&L again or say you need to retry the log.
- When verified P&L calendar context is provided for this turn, use it directly for questions about today's, weekly, monthly, or yearly realized performance.
- Never claim you saved, removed, or updated profile memory unless that change is reflected in the saved profile JSON provided to you for this turn.
- Never state that a ticker is delisted, inactive, acquired, renamed, unsupported, or no longer trading unless that fact is verified by supplied web context in this turn or explicitly provided by the user.
- Never infer symbol inactivity from a missing quote, unfamiliar ticker, or stale memory.
- If a user says a ticker is active on their platform, treat that as stronger evidence than your own memory and continue coaching from that premise.
- Never mention a knowledge cutoff date.
- For time-sensitive company, ticker, or listing-status facts without verified web context, state uncertainty briefly instead of asserting.
- Use saved profile context silently by default. Do not mention saved tickers, risk profile, strategy style, or other profile-memory fields unless the user asked about memory/profile, a profile update happened this turn, or that context is necessary to answer.
- For a direct ticker question, do not preface the reply with their saved profile or watchlist.
- If the user mentions a completed trade from today, ask whether they want it logged to their P&L calendar unless that logging flow has already been handled in the current turn.
- Ask one focused follow-up question when it helps sharpen future coaching.
- Keep the tone educational, not financial advice.
`.trim();

const MAX_LLM_HISTORY_MESSAGES = 12;
const MAX_LLM_HISTORY_MESSAGE_WORDS = 120;

const EXPERIENCE_MAP: Record<string, string> = {
  beginner: "beginner",
  "new trader": "beginner",
  rookie: "beginner",
  learning: "beginner",
  intermediate: "developing",
  developing: "developing",
  experienced: "professional",
  professional: "professional",
  "pro trader": "professional"
};

const ASSET_HINTS: Record<string, string> = {
  stocks: "stocks",
  equities: "stocks",
  options: "options",
  futures: "futures",
  forex: "forex",
  fx: "forex",
  crypto: "crypto"
};

const STRATEGY_STYLE_HINTS: Array<{ label: string; pattern: RegExp }> = [
  { label: "scalping", pattern: /\bscalp(?:ing|er)?\b/i },
  { label: "day trading", pattern: /\b(?:day\s*trad(?:e|ing|er)|intraday)\b/i },
  { label: "swing trading", pattern: /\bswing(?:\s*trad(?:e|ing|er))?\b/i },
  { label: "position trading", pattern: /\bposition(?:\s*trad(?:e|ing|er))?\b/i },
  { label: "momentum", pattern: /\bmomentum\b/i },
  { label: "mean reversion", pattern: /\bmean[\s-]*reversion\b/i },
  { label: "trend following", pattern: /\btrend[\s-]*(?:following|follower|follow)\b/i },
  { label: "volatility", pattern: /\bvol(?:atility)?(?:\s*trad(?:e|ing))?\b/i },
  { label: "market making", pattern: /\bmarket[\s-]*mak(?:e|ing|er)\b/i },
  { label: "breakout", pattern: /\bbreakout(?:s)?\b/i },
  { label: "trend trading", pattern: /\btrend\s*trad(?:e|ing|er)\b/i }
];

const RISK_HINTS: Record<string, string> = {
  conservative: "conservative",
  "low risk": "conservative",
  balanced: "balanced",
  "moderate risk": "balanced",
  aggressive: "aggressive",
  "high risk": "aggressive"
};

const GOAL_HINTS: Record<string, string> = {
  consistency: "consistency",
  discipline: "discipline",
  education: "education",
  learn: "education",
  performance: "performance review",
  review: "performance review",
  income: "income growth"
};

const PROFILE_QUESTIONS = {
  experience_level: "What best describes you right now: beginner, developing, or professional?",
  preferred_assets: "Which markets are you focused on most right now: stocks, options, futures, forex, or crypto?",
  strategy_style:
    "What kind of trading style or strategy fits you best right now: scalping, day trading, swing trading, momentum, mean reversion, trend following, volatility, or market making?",
  risk_tolerance: "How would you describe your risk comfort today: conservative, balanced, or aggressive?",
  trading_goal: "What would make trAIder most useful for you over the next month: consistency, education, discipline, or performance review?",
  trading_rules:
    "What are the non-negotiable trading rules you want this desk to remember, like max risk, stop discipline, or no revenge trades?"
};

const GUIDED_PROFILE_KEYS = [
  "experience_level",
  "preferred_assets",
  "strategy_style",
  "risk_tolerance",
  "trading_goal",
  "trading_rules"
] as const;

const PROFILE_FIELD_LABELS: Record<keyof TradingProfile, string> = {
  experience_level: "experience level",
  focus_tickers: "focus tickers",
  preferred_assets: "preferred assets",
  strategy_style: "strategies",
  trading_rules: "rules",
  risk_tolerance: "risk tolerance",
  trading_goal: "trading goal"
};

const PROFILE_REFERENCE_PATTERNS: Record<keyof TradingProfile, RegExp> = {
  experience_level: /\b(experience(?:\s+level)?|skill\s+level|trading\s+experience)\b/i,
  focus_tickers: /\b(focus\s+tickers?|focus\s+tickes|tickers?|tickes|symbols?|watchlists?)\b/i,
  preferred_assets: /\b(preferred\s+assets?|assets?|markets?)\b/i,
  strategy_style: /\b(strategy\s+style|strateg(?:y|ies)|trading\s+style|style|approach)\b/i,
  trading_rules:
    /\b(trading\s+rules?|rules?|rulebook|non[\s-]*negotiables?|guardrails?)\b/i,
  risk_tolerance: /\b(risk(?:\s+tolerance|\s+profile)?)\b/i,
  trading_goal: /\b(trading\s+goal|goal)\b/i
};

const PROFILE_CLEAR_PATTERNS: Partial<Record<keyof TradingProfile, RegExp>> = {
  experience_level:
    /\b(remove|clear|delete|drop|forget|reset)\b[\s\S]{0,24}\b(?:my\s+)?(?:experience(?:\s+level)?|skill\s+level|trading\s+experience)\b/i,
  preferred_assets:
    /\b(remove|clear|delete|drop|forget|reset)\b[\s\S]{0,24}\b(?:my\s+)?(?:preferred\s+assets?|assets?|markets?)\b/i,
  strategy_style:
    /\b(remove|clear|delete|drop|forget|reset)\b[\s\S]{0,24}\b(?:my\s+)?(?:strategy\s+style|strateg(?:y|ies)|trading\s+style|style|approach)\b/i,
  trading_rules:
    /\b(remove|clear|delete|drop|forget|reset)\b[\s\S]{0,24}\b(?:my\s+)?(?:trading\s+rules?|rules?|rulebook|non[\s-]*negotiables?|guardrails?)\b/i,
  risk_tolerance:
    /\b(remove|clear|delete|drop|forget|reset)\b[\s\S]{0,24}\b(?:my\s+)?(?:risk(?:\s+tolerance|\s+profile)?)\b/i,
  trading_goal:
    /\b(remove|clear|delete|drop|forget|reset)\b[\s\S]{0,24}\b(?:my\s+)?(?:trading\s+goal|goal)\b/i
};

const DISALLOWED_PSEUDO_TICKERS = new Set(["PL", "PNL"]);

const TICKER_STOP_WORDS = new Set([
  "A",
  "AGAIN",
  "AI",
  "ADD",
  "ALL",
  "AM",
  "AN",
  "AND",
  "ARE",
  "AS",
  "AT",
  "BEEN",
  "BE",
  "BUT",
  "BY",
  "CAN",
  "DOES",
  "DONT",
  "DO",
  "DROP",
  "DELETE",
  "ETF",
  "ETFS",
  "FORGET",
  "FOR",
  "FOLLOW",
  "FROM",
  "GO",
  "HE",
  "HER",
  "HIM",
  "I",
  "IF",
  "INTO",
  "IM",
  "INCLUDING",
  "INCLUDE",
  "IN",
  "IS",
  "IT",
  "ITS",
  "JUST",
  "KEEP",
  "LLM",
  "LOOK",
  "ME",
  "MIGHT",
  "MY",
  "NO",
  "NOT",
  "OF",
  "OFF",
  "ON",
  "OR",
  "OUR",
  "OUT",
  "P",
  "PL",
  "PNL",
  "PLEASE",
  "REMOVE",
  "RESET",
  "SAVE",
  "SO",
  "STOP",
  "ASSET",
  "ASSETS",
  "SYMBOL",
  "SYMBOLS",
  "THAT",
  "THE",
  "THESE",
  "THIS",
  "THOSE",
  "TICKER",
  "TICKERS",
  "TO",
  "TRACK",
  "TRACKING",
  "US",
  "WATCH",
  "WATCHLIST",
  "WATCHLISTS",
  "WE",
  "WITH",
  "YOU"
]);

const KNOWN_MARKET_SYMBOLS = new Set([
  "AAPL",
  "AMD",
  "AMZN",
  "ARKK",
  "BTC",
  "COHR",
  "COIN",
  "DIA",
  "ETH",
  "GOOG",
  "GOOGL",
  "IWM",
  "META",
  "MSFT",
  "MU",
  "NQ",
  "NFLX",
  "NVDA",
  "PLTR",
  "QQQ",
  "SNDK",
  "SMCI",
  "SOFI",
  "SOL",
  "SPY",
  "TSLA",
  "WDC",
  "XAUUSD"
]);

const TICKER_REMOVE_INTENT =
  /\b(remove|delete|drop|forget|exclude|untrack|take off|stop tracking|no longer track|don't track|do not track)\b/i;
const TICKER_ADD_INTENT = /\b(add|track|watch|follow|include|keep|save|remember|put|pin)\b/i;
const TICKER_DIRECT_MEMORY_VERB =
  /\b(track|watch|follow|untrack|stop tracking|put|pin)\b/i;
const TICKER_CLEAR_ALL_INTENT =
  /\b(clear|reset|remove all|drop all|forget all)\b.*\b(tickers|symbols|watchlist|ticker|symbol)\b/i;
const SINGULAR_TICKER_REFERENCE = /\b(it|that|this|the one|that one)\b/i;
const PNL_CALENDAR_INTENT_HINT =
  /\b(?:p(?:&|and)?l|pl|calend[a-z]*)\b/i;
const TICKER_PREFERENCE_HINT =
  /\b(like|love|prefer|favorite|favourite|interested in|focused on|focus on|bullish on|into)\b/i;
const TRADING_CONTEXT_HINT =
  /\b(trade|trading|ticker|tickers|symbol|symbols|stock|stocks|equity|equities|option|options|call|calls|put|puts|spread|shares?|entry|stop|target|risk|reward|watchlist|watchlists|position|long|short|swing|scalp|day trading|portfolio|market|markets|futures|forex|crypto|chart|setup|price|prices|support|resistance|volume|volatility|momentum|mean[\s-]*reversion|trend[\s-]*(?:following|follower|follow)|market[\s-]*mak(?:e|ing|er)|breakout|earnings|vwap|ema|sma|rsi|macd|profit|loss|trade idea|profile memory|profile)\b/i;
const OFF_TOPIC_HINT =
  /\b(movie|film|tv|show|series|actor|actress|celebrity|music|song|album|band|pop culture|recipe|food|restaurant|vacation|travel|dating|relationship|politics|religion|joke|poem|novel|book)\b/i;
const THREAD_REFERENCE_HINT =
  /\b(that|this|it|those|these|earlier|before|previous|last|same|again|setup|trade)\b/i;
const WEB_SEARCH_REQUEST_HINT =
  /\b(check the web|search the web|look it up|look up|check the news|search for|latest news|latest update|current news|web)\b/i;
const PROFILE_SURFACE_HINT =
  /\b(profile|memory|remember|saved|watchlist|focus tickers|what do you know about me|about me|my style|my strategy|my risk|my goal|my rules|rulebook|non[\s-]*negotiables?)\b/i;
const PROFILE_SET_INTENT = /\b(set|save|remember|update|change|adjust|make|keep)\b/i;
const PROFILE_REMOVE_INTENT = /\b(remove|clear|delete|drop|forget|reset)\b/i;

export const emptyTradingProfile: TradingProfile = {
  experience_level: null,
  focus_tickers: null,
  preferred_assets: null,
  strategy_style: null,
  trading_rules: null,
  risk_tolerance: null,
  trading_goal: null
};

export function normalizeTradingProfile(value: unknown): TradingProfile {
  if (!value || typeof value !== "object") {
    return { ...emptyTradingProfile };
  }

  const profile = value as Record<string, unknown>;
  return {
    experience_level:
      typeof profile.experience_level === "string" ? profile.experience_level : null,
    focus_tickers:
      typeof profile.focus_tickers === "string"
        ? sanitizeFocusTickersValue(profile.focus_tickers)
        : null,
    preferred_assets:
      typeof profile.preferred_assets === "string" ? profile.preferred_assets : null,
    strategy_style: typeof profile.strategy_style === "string" ? profile.strategy_style : null,
    trading_rules:
      typeof profile.trading_rules === "string" ? serializeRuleSegments(parseRuleSegments(profile.trading_rules)) : null,
    risk_tolerance:
      typeof profile.risk_tolerance === "string" ? profile.risk_tolerance : null,
    trading_goal: typeof profile.trading_goal === "string" ? profile.trading_goal : null
  };
}

export function hasTradingProfile(profile: TradingProfile) {
  return Object.values(profile).some(Boolean);
}

export function summarizeProfile(profile: TradingProfile) {
  const segments: string[] = [];
  if (profile.experience_level) {
    segments.push(profile.experience_level);
  }
  if (profile.focus_tickers) {
    segments.push(`tracking ${profile.focus_tickers}`);
  }
  if (profile.strategy_style) {
    segments.push(profile.strategy_style);
  }
  if (profile.trading_rules) {
    const [firstRule, secondRule] = parseRuleSegments(profile.trading_rules);
    const summarizedRules = [firstRule, secondRule].filter(Boolean).join(" / ");
    if (summarizedRules) {
      segments.push(`rules: ${summarizedRules}`);
    }
  }
  if (profile.preferred_assets) {
    segments.push(`focused on ${profile.preferred_assets}`);
  }
  if (profile.risk_tolerance) {
    segments.push(`with a ${profile.risk_tolerance} risk profile`);
  }
  if (profile.trading_goal) {
    segments.push(`working toward ${profile.trading_goal}`);
  }

  if (!segments.length) {
    return null;
  }

  return segments.join(" · ");
}

export function buildWorkspaceIntro(
  userName: string,
  profile: TradingProfile,
  hasMessages: boolean
) {
  if (!hasMessages && !hasTradingProfile(profile)) {
    return `${userName}, I'm trAIder, your AI trading coach. Drop in a setup, screenshot, trade idea, or question and I'll help you frame it clearly. To tune the coaching, what markets are you trading most right now?`;
  }

  if (!hasMessages) {
    return "What are we working on today? Drop in a setup, screenshot, trade idea, or question and I'll help you think it through.";
  }

  return "Welcome back. What are we working on today?";
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDisallowedPseudoTicker(symbol: string) {
  return DISALLOWED_PSEUDO_TICKERS.has(symbol.toUpperCase());
}

function sanitizeFocusTickersValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const unique = new Set<string>();
  for (const segment of value.split(",")) {
    const ticker = segment.trim().toUpperCase();
    if (!ticker || isDisallowedPseudoTicker(ticker)) {
      continue;
    }

    unique.add(ticker);
  }

  const nextTickers = Array.from(unique);
  return nextTickers.length ? nextTickers.join(", ") : null;
}

function stripLeadingDisplayName(text: string, userName: string) {
  const normalizedName = normalizeWhitespace(userName);
  if (!normalizedName || normalizedName.toLowerCase() === "trader") {
    return text;
  }

  const escapedName = escapeRegExp(normalizedName);
  const greetingPattern = new RegExp(
    `^\\s*(?:hi|hey|hello|welcome back)\\s+${escapedName}[,!:.-]\\s*`,
    "i"
  );
  const directPattern = new RegExp(`^\\s*${escapedName}[,!:.-]\\s*`, "i");
  const affirmationPattern = new RegExp(
    `^\\s*(Absolutely|Sure thing|Sure|Got it|Right|Thanks|Thank you|Of course)[,!]?\\s+${escapedName}[,!:.-]\\s*`,
    "i"
  );

  if (greetingPattern.test(text)) {
    return text.replace(greetingPattern, "");
  }

  if (affirmationPattern.test(text)) {
    return text.replace(affirmationPattern, (_, lead: string) => `${lead}, `);
  }

  if (directPattern.test(text)) {
    return text.replace(directPattern, "");
  }

  return text;
}

function assistantUsesDisplayName(text: string, userName: string) {
  const normalizedName = normalizeWhitespace(userName);
  if (!normalizedName || normalizedName.toLowerCase() === "trader") {
    return false;
  }

  const escapedName = escapeRegExp(normalizedName);
  return new RegExp(`\\b${escapedName}\\b`, "i").test(text);
}

function shouldUseDisplayNameThisTurn(history: WorkspaceMessage[], userName: string) {
  const assistantMessages = history.filter((entry) => entry.role === "assistant");
  if (!assistantMessages.length) {
    return true;
  }

  let turnsSinceLastNameUse = 0;
  let hasUsedName = false;

  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    if (assistantUsesDisplayName(assistantMessages[index].content, userName)) {
      hasUsedName = true;
      break;
    }

    turnsSinceLastNameUse += 1;
  }

  if (!hasUsedName) {
    return assistantMessages.length >= 3;
  }

  return turnsSinceLastNameUse >= 3;
}

function maybeStripDisplayName(text: string, history: WorkspaceMessage[], userName: string) {
  if (shouldUseDisplayNameThisTurn(history, userName)) {
    return text;
  }

  return stripLeadingDisplayName(text, userName).trimStart();
}

export function extractDisplayNameUpdate(
  userMessage: string,
  currentDisplayName: string | null
) {
  return parseDisplayNameUpdateRequest(userMessage, currentDisplayName).nextDisplayName;
}

function normalizeReplyText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n\n")
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function normalizeConversationTitle(value: string) {
  return value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
}

export function fallbackConversationTitle(userMessage: string) {
  const cleaned = userMessage
    .replace(/[*_`#>\-\d.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "New chat";
  }

  const sentence = cleaned.split(/[.!?]/)[0]?.trim() ?? cleaned;
  const words = sentence.split(" ").filter(Boolean).slice(0, 6);
  const candidate = words.join(" ");
  return normalizeConversationTitle(candidate) || "New chat";
}

function nextProfileQuestion(profile: TradingProfile) {
  for (const key of GUIDED_PROFILE_KEYS) {
    if (!profile[key]) {
      return PROFILE_QUESTIONS[key];
    }
  }

  return null;
}

function summarizeAttachment(name: string | null, type: string | null) {
  if (!name) {
    return null;
  }

  const kind = type?.startsWith("image/") ? "screenshot" : "upload";
  return `The user attached a ${kind} named "${name}" (${type ?? "unknown type"}).`;
}

function normalizeTickerSymbol(
  token: string,
  options?: { allowLowercase?: boolean; currentTickers?: string[] }
) {
  const stripped = token.replace(/^\$/, "").replace(/[^A-Za-z]/g, "");
  if (!stripped) {
    return null;
  }

  const upper = stripped.toUpperCase();
  if (upper.length < 1 || upper.length > 6) {
    return null;
  }

  if (isDisallowedPseudoTicker(upper)) {
    return null;
  }

  const isExplicitTicker = token.startsWith("$");
  const isUppercaseToken = stripped === upper;
  const isKnownMarketSymbol = KNOWN_MARKET_SYMBOLS.has(upper);
  const isSavedTicker = options?.currentTickers?.includes(upper) ?? false;

  if (upper.length <= 2 && !isExplicitTicker && !isKnownMarketSymbol && !isSavedTicker) {
    return null;
  }

  if (TICKER_STOP_WORDS.has(upper) && !isKnownMarketSymbol && !isSavedTicker) {
    return null;
  }

  if (!isExplicitTicker && !isUppercaseToken && !isKnownMarketSymbol && !isSavedTicker) {
    return null;
  }

  return upper;
}

function extractTickerMentions(
  value: string,
  options?: { allowLowercase?: boolean; currentTickers?: string[] }
) {
  const seen = new Set<string>();
  const tickers: string[] = [];

  for (const match of value.matchAll(/\b\$?[A-Za-z]{1,6}\b/g)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const previousCharacter = value[index - 1] ?? "";
    const nextCharacter = value[index + raw.length] ?? "";

    if (previousCharacter === "." || nextCharacter === ".") {
      continue;
    }

    const normalized = normalizeTickerSymbol(raw, options);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    tickers.push(normalized);
  }

  return tickers;
}

function parseSavedTickers(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => !isDisallowedPseudoTicker(entry))
    .filter(Boolean);
}

function parseProfileTerms(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRuleSegment(value: string) {
  const normalized = normalizeWhitespace(
    value
      .replace(/^[\s\-–—•·*]+/, "")
      .replace(/^\d+\s*[.)-]?\s*/, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[;,.]+$/g, "")
  );

  if (!normalized) {
    return null;
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function parseRuleSegments(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .split(/\s*\|\s*|\n+/)
    .map((segment) => normalizeRuleSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
}

function serializeRuleSegments(segments: string[]) {
  const normalized = segments
    .map((segment) => normalizeRuleSegment(segment))
    .filter((segment): segment is string => Boolean(segment));

  return normalized.length ? normalized.join(" | ") : null;
}

function mergeRuleSegments(existing: string | null, additions: string[], limit = 8) {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const value of [...additions, ...parseRuleSegments(existing)]) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    merged.push(value.trim());
  }

  return merged.slice(0, limit);
}

function extractRuleCandidates(rawValue: string) {
  const prepared = rawValue
    .replace(/\r/g, "")
    .replace(/[•▪◦]+/g, "\n")
    .replace(/\s*\n\s*/g, "\n");

  const candidates = splitIntentClauses(prepared)
    .map((segment) =>
      segment
        .replace(/^(?:and|also)\s+/i, "")
        .replace(/\b(?:please|pls|thanks|thank you)\b/gi, "")
        .trim()
    )
    .map((segment) => normalizeRuleSegment(segment))
    .filter((segment): segment is string => Boolean(segment));

  return [...new Set(candidates.map((segment) => segment.trim()))].slice(0, 8);
}

function extractExplicitRuleUpdate(
  userMessage: string,
  currentRules: string | null
): { nextValue: string | null; touched: boolean } | null {
  const replacePatterns = [
    /\b(?:my|our)\s+(?:trading\s+)?(?:rules|rulebook|non[\s-]*negotiables?|guardrails?)\s+(?:are|is)\s*(.+)$/i,
    /\b(?:set|save|remember|keep|update)\s+(?:my|our)\s+(?:trading\s+)?(?:rules|rulebook|non[\s-]*negotiables?|guardrails?)\s*(?:to|as)?\s*(.+)$/i,
    /\b(?:my|our)\s+rule\s+is\s+(.+)$/i
  ];
  const mergePatterns = [
    /\b(?:add|include)\s+(?:this\s+)?rule\s*(?::|-)?\s*(.+)$/i,
    /\b(?:save|remember|keep)\s+(?:this\s+)?rule\s*(?::|-)?\s*(.+)$/i,
    /\b(?:add|include)\s+(?:these\s+)?rules\s*(?::|-)?\s*(.+)$/i,
    /\brule\s*(?::|-)\s*(.+)$/i
  ];
  const removePatterns = [
    /\b(?:remove|delete|drop|forget|clear)\s+(?:this\s+)?rule\s*(?::|-)?\s*(.+)$/i,
    /\b(?:remove|delete|drop|forget|clear)\s+(?:the\s+)?rule\s+(.+)$/i
  ];

  for (const pattern of removePatterns) {
    const match = userMessage.match(pattern);
    const rawValue = match?.[1]?.trim();
    if (!rawValue) {
      continue;
    }

    const currentSegments = parseRuleSegments(currentRules);
    const targets = extractRuleCandidates(rawValue);
    if (!currentSegments.length || !targets.length) {
      return { nextValue: currentRules, touched: true };
    }

    const nextSegments = currentSegments.filter((segment) => {
      const normalizedSegment = segment.toLowerCase();
      return !targets.some((target) => {
        const normalizedTarget = target.toLowerCase();
        return (
          normalizedSegment.includes(normalizedTarget) ||
          normalizedTarget.includes(normalizedSegment)
        );
      });
    });

    return { nextValue: serializeRuleSegments(nextSegments), touched: true };
  }

  for (const pattern of replacePatterns) {
    const match = userMessage.match(pattern);
    const rawValue = match?.[1]?.trim();
    if (!rawValue) {
      continue;
    }

    return {
      nextValue: serializeRuleSegments(extractRuleCandidates(rawValue)),
      touched: true
    };
  }

  for (const pattern of mergePatterns) {
    const match = userMessage.match(pattern);
    const rawValue = match?.[1]?.trim();
    if (!rawValue) {
      continue;
    }

    return {
      nextValue: serializeRuleSegments(mergeRuleSegments(currentRules, extractRuleCandidates(rawValue))),
      touched: true
    };
  }

  return null;
}

function mergeTickers(existing: string[], additions: string[]) {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const ticker of [...additions, ...existing]) {
    if (!ticker || seen.has(ticker)) {
      continue;
    }

    seen.add(ticker);
    merged.push(ticker);
  }

  return merged.slice(0, 8);
}

function mergeProfileTerms(existing: string | null, additions: string[], limit = 6) {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const value of [...additions, ...parseProfileTerms(existing)]) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    merged.push(value.trim());
  }

  return merged.slice(0, limit);
}

function extractStrategyStyleHints(message: string) {
  const matches: string[] = [];
  const seen = new Set<string>();

  for (const hint of STRATEGY_STYLE_HINTS) {
    if (!hint.pattern.test(message)) {
      continue;
    }

    const normalized = hint.label.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    matches.push(hint.label);
  }

  return matches;
}

function splitIntentClauses(value: string) {
  return value
    .split(/\n+|[.;!?]+|\bbut\b|\band then\b|,/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripTickerReplyRemainder(message: string, tickers: string[]) {
  let remainder = message;
  for (const ticker of tickers) {
    remainder = remainder.replace(new RegExp(`\\b\\$?${ticker}\\b`, "gi"), " ");
  }

  return remainder
    .replace(/\b(?:and|or)\b/gi, " ")
    .replace(/[,&/+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTickerReplyMentions(message: string, currentTickers: string[]) {
  const tickers = extractTickerMentions(message, {
    allowLowercase: true,
    currentTickers
  });

  if (!tickers.length) {
    return { tickers, remainder: "" };
  }

  return {
    tickers,
    remainder: stripTickerReplyRemainder(message, tickers)
  };
}

function isBareTickerResponse(message: string, currentTickers: string[]) {
  const { tickers, remainder } = getTickerReplyMentions(message, currentTickers);
  if (!tickers.length) {
    return false;
  }

  return remainder.length === 0;
}

function isTickerClarificationResponse(message: string, currentTickers: string[]) {
  const { tickers, remainder } = getTickerReplyMentions(message, currentTickers);
  if (!tickers.length) {
    return false;
  }

  const normalizedRemainder = remainder
    .replace(/\b(?:i\s+mean|i\s+meant|meant)\b/gi, " ")
    .replace(
      /\b(?:yes|yeah[a-z]*|yep|yup|correct|exactly|right|sorry|please|pls|thanks|thank\s+you|ok(?:ay)?|got\s+it)\b/gi,
      " "
    )
    .replace(/\b(?:that|this)(?:\s+one)?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizedRemainder.length === 0;
}

function isTickerFollowUpResponse(message: string, currentTickers: string[]) {
  return (
    isBareTickerResponse(message, currentTickers) ||
    isTickerClarificationResponse(message, currentTickers)
  );
}

function isTickerMemoryTargetClarification(message: string) {
  return /\b(?:(?:my|the)\s+)?(?:focus(?:\s+tickers?)?|focus\s+list|watchlist|tickers?|symbols?|profile\s+memory|saved\s+profile|profile)\b/i.test(
    message
  );
}

function detectPendingTickerMemoryIntent(
  history: WorkspaceMessage[],
  currentTickers: string[]
): "add" | "remove" | null {
  const latestEntry = history[history.length - 1];
  if (!latestEntry) {
    return null;
  }

  const content = latestEntry.content;

  if (latestEntry.role === "assistant") {
    if (
      /\b(which|what)\b[\s\S]{0,40}\b(ticker|tickers|symbol|symbols)\b/i.test(content) &&
      /\b(focus(?:\s+tickers?)?|focus\s+list|watchlist)\b/i.test(content)
    ) {
      if (/\b(add|include|track|save|keep|alongside)\b/i.test(content)) {
        return "add";
      }

      if (/\b(remove|drop|delete|untrack|clear)\b/i.test(content)) {
        return "remove";
      }
    }

    if (
      /\b(double-check|did you mean|if you meant|which symbol|what symbol|just let me know)\b/i.test(
        content
      ) &&
      /\b(ticker|tickers|symbol|symbols)\b/i.test(content)
    ) {
      if (/\b(add|include|track|save|keep|alongside)\b/i.test(content)) {
        return "add";
      }

      if (/\b(remove|drop|delete|untrack|clear)\b/i.test(content)) {
        return "remove";
      }
    }

    if (
      isTickerMemoryTargetClarification(content) &&
      /\b(?:trade|order|position|setup|watchlist|profile\s+memory|saved\s+profile)\b/i.test(content)
    ) {
      if (/\b(remove|drop|delete|untrack|clear)\b/i.test(content)) {
        return "remove";
      }

      if (/\b(add|include|track|save|keep|alongside|pin|put)\b/i.test(content)) {
        return "add";
      }
    }

    if (
      /\bwhat would you like me to add\b/i.test(content) &&
      extractTickerMentions(content, {
        allowLowercase: true,
        currentTickers
      }).length > 0
    ) {
      return "add";
    }

    if (
      /\b(?:saved\s+focus\s+tickers?|focus\s+tickers?|watchlist)\b/i.test(content) &&
      /\b(?:isn['’]?t|aren['’]?t|not in|don['’]?t see a saved focus-ticker change|right now i only have)\b/i.test(
        content
      )
    ) {
      return "remove";
    }

    return null;
  }

  if (
    TICKER_CLEAR_ALL_INTENT.test(content) ||
    (TICKER_REMOVE_INTENT.test(content) && isTickerMemoryRequest(content, currentTickers))
  ) {
    return "remove";
  }

  if (TICKER_ADD_INTENT.test(content) && isTickerMemoryRequest(content, currentTickers)) {
    return "add";
  }

  return null;
}

function hasTickerMemoryFollowUpIntent(
  userMessage: string,
  history: WorkspaceMessage[],
  currentTickers: string[]
) {
  const recentIntent = detectPendingTickerMemoryIntent(history, currentTickers);
  if (!recentIntent) {
    return false;
  }

  if (isTickerFollowUpResponse(userMessage, currentTickers)) {
    return true;
  }

  if (isTickerMemoryTargetClarification(userMessage)) {
    return true;
  }

  const mentionedTickers = extractTickerMentions(userMessage, {
    allowLowercase: true,
    currentTickers
  });
  if (!mentionedTickers.length) {
    return false;
  }

  if (recentIntent === "remove" && TICKER_REMOVE_INTENT.test(userMessage)) {
    return true;
  }

  if (
    recentIntent === "add" &&
    (TICKER_ADD_INTENT.test(userMessage) ||
      /\b(?:put|pin)\b[\s\S]{0,12}\b(?:in|into|on)\b/i.test(userMessage))
  ) {
    return true;
  }

  return false;
}

function isRecentTickerMemoryAcknowledgement(history: WorkspaceMessage[]) {
  const latestAssistant = [...history].reverse().find((entry) => entry.role === "assistant");
  if (!latestAssistant) {
    return false;
  }

  return /\b(?:add(?:ed)?|save(?:d)?|include(?:d)?|track(?:ing)?|remove(?:d)?|clear(?:ed)?)\b[\s\S]{0,84}\b(?:focus(?:\s+tickers?)?|focus\s+list|watchlist)\b/i.test(
    latestAssistant.content
  );
}

function buildAmbiguousTickerTurnReply(
  userName: string,
  userMessage: string,
  currentTickers: string[],
  history: WorkspaceMessage[] = []
) {
  const mentionedTickers = extractTickerMentions(userMessage, {
    allowLowercase: true,
    currentTickers
  });
  const tickerList =
    mentionedTickers.length > 1
      ? `${mentionedTickers.slice(0, -1).join(", ")} and ${mentionedTickers.at(-1)}`
      : mentionedTickers[0] ?? "that ticker";

  return maybeStripDisplayName(
    `Do you want me to add ${tickerList} to your focus tickers too, or is this a new turn and you want to talk about ${tickerList}?`,
    history,
    userName
  );
}

function isAmbiguousBareTickerFollowUp(
  userMessage: string,
  history: WorkspaceMessage[],
  currentTickers: string[]
) {
  if (!isBareTickerResponse(userMessage, currentTickers)) {
    return false;
  }

  if (detectPendingTickerMemoryIntent(history, currentTickers)) {
    return false;
  }

  return isRecentTickerMemoryAcknowledgement(history);
}

function hasTradingThreadContext(history: WorkspaceMessage[], profile: TradingProfile) {
  if (parseSavedTickers(profile.focus_tickers).length) {
    return true;
  }

  return history.some((entry) => {
    if (TRADING_CONTEXT_HINT.test(entry.content)) {
      return true;
    }

    return (
      extractTickerMentions(entry.content, {
        allowLowercase: true,
        currentTickers: parseSavedTickers(profile.focus_tickers)
      }).length > 0
    );
  });
}

function isTickerMemoryRequest(message: string, currentTickers: string[]) {
  if (
    PNL_CALENDAR_INTENT_HINT.test(message) &&
    /\b(add|log|track|put|save|record)\b/i.test(message)
  ) {
    return false;
  }

  const mentionedTickers = extractTickerMentions(message, {
    allowLowercase: true,
    currentTickers
  });
  const hasTickerMemoryKeywords =
    /\b(ticker|tickers|tickes|symbol|symbols|watchlist|watchlists|focus(?:\s+tickers?)?|profile|memory)\b/i.test(
      message
    );
  const isCapabilityQuestion =
    /\?\s*$/.test(message.trim()) &&
    /\b(?:can|could|do|does|will|would|are)\b/i.test(message) &&
    /\b(?:you|trader|this app)\b/i.test(message) &&
    hasTickerMemoryKeywords &&
    !mentionedTickers.length;

  if (isCapabilityQuestion) {
    return false;
  }

  if (
    TICKER_REMOVE_INTENT.test(message) ||
    TICKER_ADD_INTENT.test(message) ||
    TICKER_CLEAR_ALL_INTENT.test(message)
  ) {
    if (hasTickerMemoryKeywords) {
      return true;
    }

    if (mentionedTickers.length && TICKER_DIRECT_MEMORY_VERB.test(message)) {
      return true;
    }

    if (
      mentionedTickers.length &&
      /\b(?:put|pin)\b[\s\S]{0,12}\b(?:in|into|on)\b/i.test(message)
    ) {
      return true;
    }

    if (SINGULAR_TICKER_REFERENCE.test(message)) {
      return true;
    }
  }

  return false;
}

function isTradingRelevantMessage(
  message: string,
  history: WorkspaceMessage[],
  profile: TradingProfile
) {
  const currentTickers = parseSavedTickers(profile.focus_tickers);
  const mentionedTickers = extractTickerMentions(message, {
    currentTickers
  });

  if (TRADING_CONTEXT_HINT.test(message)) {
    return true;
  }

  if (isTickerMemoryRequest(message, currentTickers)) {
    return true;
  }

  if (mentionedTickers.length > 0) {
    if (
      /\b(price|prices|chart|setup|long|short|trade|trading|watch|watchlist|entry|stop|risk|stocks?|options?|shares?)\b/i.test(
        message
      )
    ) {
      return true;
    }

    if (TICKER_PREFERENCE_HINT.test(message)) {
      return true;
    }

    if (hasTradingThreadContext(history, profile)) {
      return true;
    }
  }

  if (THREAD_REFERENCE_HINT.test(message) && hasTradingThreadContext(history, profile)) {
    return true;
  }

  return false;
}

function isClearlyOffTopicMessage(
  message: string,
  history: WorkspaceMessage[],
  profile: TradingProfile
) {
  return OFF_TOPIC_HINT.test(message) && !isTradingRelevantMessage(message, history, profile);
}

function findMostRecentTickerReference(history: WorkspaceMessage[], currentTickers: string[]) {
  const savedSet = new Set(currentTickers);

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const entryTickers = extractTickerMentions(entry.content, {
      allowLowercase: true,
      currentTickers
    });

    const savedMatch = entryTickers.find((ticker) => savedSet.has(ticker));
    if (savedMatch) {
      return savedMatch;
    }

    if (entryTickers.length) {
      return entryTickers[entryTickers.length - 1];
    }
  }

  return currentTickers[currentTickers.length - 1] ?? null;
}

function resolveTickerUpdate(
  userMessage: string,
  currentTickers: string[],
  history: WorkspaceMessage[] = []
) {
  const clauses = splitIntentClauses(userMessage);
  const additions: string[] = [];
  const removals: string[] = [];
  let sawExplicitIntent = false;
  const recentIntent = detectPendingTickerMemoryIntent(history, currentTickers);

  for (const clause of clauses) {
    const isRemovalClause = TICKER_REMOVE_INTENT.test(clause);
    const isAdditionClause = TICKER_ADD_INTENT.test(clause);
    const clauseTickers = extractTickerMentions(clause, {
      allowLowercase: isRemovalClause || isAdditionClause,
      currentTickers
    });

    if (isRemovalClause) {
      if (
        !clauseTickers.length &&
        (SINGULAR_TICKER_REFERENCE.test(clause) ||
          (recentIntent === "remove" && isTickerMemoryTargetClarification(clause)))
      ) {
        const inferredTicker = findMostRecentTickerReference(history, currentTickers);
        if (inferredTicker) {
          removals.push(inferredTicker);
          sawExplicitIntent = true;
        }
        continue;
      }

      if (!clauseTickers.length) {
        continue;
      }
      removals.push(...clauseTickers);
      sawExplicitIntent = true;
      continue;
    }

    if (isAdditionClause) {
      if (
        !clauseTickers.length &&
        recentIntent === "add" &&
        isTickerMemoryTargetClarification(clause)
      ) {
        const inferredTicker = findMostRecentTickerReference(history, currentTickers);
        if (inferredTicker) {
          additions.push(inferredTicker);
          sawExplicitIntent = true;
        }
        continue;
      }

      if (!clauseTickers.length) {
        continue;
      }
      additions.push(...clauseTickers);
      sawExplicitIntent = true;
      continue;
    }

    if (
      !isRemovalClause &&
      !isAdditionClause &&
      recentIntent
    ) {
      if (!clauseTickers.length && isTickerMemoryTargetClarification(clause)) {
        const inferredTicker = findMostRecentTickerReference(history, currentTickers);
        if (inferredTicker) {
          if (recentIntent === "remove") {
            removals.push(inferredTicker);
          } else {
            additions.push(inferredTicker);
          }
          sawExplicitIntent = true;
        }
        continue;
      }

      if (!isTickerFollowUpResponse(clause, currentTickers)) {
        continue;
      }

      if (!clauseTickers.length) {
        continue;
      }

      if (recentIntent === "remove") {
        removals.push(...clauseTickers);
      } else {
        additions.push(...clauseTickers);
      }
      sawExplicitIntent = true;
    }
  }

  let nextTickers = [...currentTickers];

  if (TICKER_CLEAR_ALL_INTENT.test(userMessage)) {
    nextTickers = [];
    sawExplicitIntent = true;
  }

  if (removals.length) {
    const removalSet = new Set(removals);
    nextTickers = nextTickers.filter((ticker) => !removalSet.has(ticker));
  }

  if (additions.length) {
    nextTickers = mergeTickers(nextTickers, additions);
  } else if (!sawExplicitIntent) {
    nextTickers = mergeTickers(nextTickers, extractTickerMentions(userMessage));
  }

  return nextTickers;
}

function formatTickerActionLabel(tickers: string[]) {
  if (!tickers.length) {
    return "that ticker";
  }

  if (tickers.length === 1) {
    return tickers[0];
  }

  if (tickers.length === 2) {
    return `${tickers[0]} and ${tickers[1]}`;
  }

  return `${tickers.slice(0, -1).join(", ")}, and ${tickers.at(-1)}`;
}

export function buildFocusTickerQuickActionsForTurn(input: {
  history: WorkspaceMessage[];
  nextProfile: TradingProfile;
  previousProfile: TradingProfile;
  profileUpdateApplied: boolean;
  userMessage: string;
}): WorkspaceQuickAction[] {
  const previousTickers = parseSavedTickers(input.previousProfile.focus_tickers);
  const recentIntent = detectPendingTickerMemoryIntent(input.history, previousTickers);
  const inferredTicker = recentIntent
    ? findMostRecentTickerReference(input.history, previousTickers)
    : null;

  if (
    input.profileUpdateApplied &&
    input.previousProfile.focus_tickers !== input.nextProfile.focus_tickers
  ) {
    return [];
  }

  const mentionedTickers = extractTickerMentions(input.userMessage, {
    allowLowercase: true,
    currentTickers: previousTickers
  });

  if (
    inferredTicker &&
    recentIntent === "add" &&
    !previousTickers.includes(inferredTicker) &&
    (isTickerMemoryTargetClarification(input.userMessage) ||
      (!mentionedTickers.length &&
        /\b(?:yes|yeah[a-z]*|yep|yup|sure|ok(?:ay)?|do it|go ahead|that one|this one|that|this)\b/i.test(
          input.userMessage
        )))
  ) {
    return [
      {
        kind: "submit",
        label: `Add ${inferredTicker} to focus tickers`,
        prompt: `Add ${inferredTicker} to my focus tickers.`
      }
    ];
  }

  if (
    inferredTicker &&
    recentIntent === "remove" &&
    previousTickers.includes(inferredTicker) &&
    (isTickerMemoryTargetClarification(input.userMessage) ||
      (!mentionedTickers.length &&
        /\b(?:yes|yeah[a-z]*|yep|yup|sure|ok(?:ay)?|do it|go ahead|that one|this one|that|this)\b/i.test(
          input.userMessage
        )))
  ) {
    return [
      {
        kind: "submit",
        label: `Remove ${inferredTicker} from focus tickers`,
        prompt: `Remove ${inferredTicker} from my focus tickers.`
      }
    ];
  }

  if (!mentionedTickers.length) {
    if (recentIntent && isTickerMemoryTargetClarification(input.userMessage)) {
      if (!inferredTicker) {
        return [];
      }

      if (recentIntent === "add" && !previousTickers.includes(inferredTicker)) {
        return [
          {
            kind: "submit",
            label: `Add ${inferredTicker} to focus tickers`,
            prompt: `Add ${inferredTicker} to my focus tickers.`
          }
        ];
      }

      if (recentIntent === "remove" && previousTickers.includes(inferredTicker)) {
        return [
          {
            kind: "submit",
            label: `Remove ${inferredTicker} from focus tickers`,
            prompt: `Remove ${inferredTicker} from my focus tickers.`
          }
        ];
      }
    }

    return [];
  }

  if (isAmbiguousBareTickerFollowUp(input.userMessage, input.history, previousTickers)) {
    return [
      {
        kind: "submit",
        label: `Add ${formatTickerActionLabel(mentionedTickers)} to focus tickers`,
        prompt: `Add ${mentionedTickers.join(", ")} to my focus tickers.`
      }
    ];
  }

  if (
    mentionedTickers.length &&
    TICKER_ADD_INTENT.test(input.userMessage) &&
    !isTickerMemoryRequest(input.userMessage, previousTickers) &&
    !PNL_CALENDAR_INTENT_HINT.test(input.userMessage)
  ) {
    return [
      {
        kind: "submit",
        label: `Add ${formatTickerActionLabel(mentionedTickers)} to focus tickers`,
        prompt: `Add ${mentionedTickers.join(", ")} to my focus tickers.`
      }
    ];
  }

  if (!isTickerMemoryRequest(input.userMessage, previousTickers)) {
    return [];
  }

  if (TICKER_REMOVE_INTENT.test(input.userMessage)) {
    return [
      {
        kind: "submit",
        label: `Remove ${formatTickerActionLabel(mentionedTickers)} from focus tickers`,
        prompt: `Remove ${mentionedTickers.join(", ")} from my focus tickers.`
      }
    ];
  }

  if (TICKER_ADD_INTENT.test(input.userMessage) || /\b(?:put|pin)\b[\s\S]{0,12}\b(?:in|into|on)\b/i.test(input.userMessage)) {
    return [
      {
        kind: "submit",
        label: `Add ${formatTickerActionLabel(mentionedTickers)} to focus tickers`,
        prompt: `Add ${mentionedTickers.join(", ")} to my focus tickers.`
      }
    ];
  }

  return [];
}

export function summarizeProfileUpdate(previous: TradingProfile, next: TradingProfile) {
  const changes: string[] = [];
  const formatLabel = (field: keyof TradingProfile) =>
    PROFILE_FIELD_LABELS[field].charAt(0).toUpperCase() + PROFILE_FIELD_LABELS[field].slice(1);

  if (previous.focus_tickers !== next.focus_tickers) {
    if (next.focus_tickers) {
      changes.push(`Saved focus tickers: ${next.focus_tickers}`);
    } else {
      changes.push("Saved focus tickers cleared");
    }
  }

  for (const field of GUIDED_PROFILE_KEYS) {
    if (previous[field] === next[field]) {
      continue;
    }

    if (next[field]) {
      changes.push(
        `${formatLabel(field)}: ${formatProfileNotificationValue(field, next[field]) ?? next[field]}`
      );
    } else {
      changes.push(`${formatLabel(field)} cleared`);
    }
  }

  return changes.length ? changes.join(" | ") : null;
}

function formatProfileNotificationValue(field: keyof TradingProfile, value: string | null) {
  if (!value) {
    return null;
  }

  if (field === "focus_tickers") {
    return parseSavedTickers(value).join(", ");
  }

  if (field === "trading_rules") {
    return parseRuleSegments(value).join(" · ");
  }

  return value
    .split(",")
    .map((segment) =>
      segment
        .trim()
        .replace(/[_-]+/g, " ")
        .replace(/\b[a-z]/g, (match) => match.toUpperCase())
    )
    .filter(Boolean)
    .join(" · ");
}

export function buildProfileChangeNotifications(
  previous: TradingProfile,
  next: TradingProfile
): ProfileChangeNotification[] {
  const notifications: ProfileChangeNotification[] = [];
  const previousTickers = parseSavedTickers(previous.focus_tickers);
  const nextTickers = parseSavedTickers(next.focus_tickers);

  for (const ticker of nextTickers.filter((symbol) => !previousTickers.includes(symbol))) {
    notifications.push({
      changeType: "added",
      detail: `trAIder saved ${ticker} in your focus tickers.`,
      fieldKey: "focus_tickers",
      title: `Added ${ticker} to focus tickers`
    });
  }

  for (const ticker of previousTickers.filter((symbol) => !nextTickers.includes(symbol))) {
    notifications.push({
      changeType: "removed",
      detail: `trAIder removed ${ticker} from your focus tickers.`,
      fieldKey: "focus_tickers",
      title: `Removed ${ticker} from focus tickers`
    });
  }

  for (const field of GUIDED_PROFILE_KEYS) {
    const previousValue = previous[field];
    const nextValue = next[field];

    if (previousValue === nextValue) {
      continue;
    }

    const label = PROFILE_FIELD_LABELS[field];
    const formattedPreviousValue = formatProfileNotificationValue(field, previousValue);
    const formattedNextValue = formatProfileNotificationValue(field, nextValue);

    if (nextValue && !previousValue && formattedNextValue) {
      notifications.push({
        changeType: "added",
        detail: `trAIder saved ${formattedNextValue} under ${label}.`,
        fieldKey: field,
        title: `Saved ${label}`
      });
      continue;
    }

    if (nextValue && previousValue && formattedNextValue) {
      notifications.push({
        changeType: "updated",
        detail: formattedPreviousValue
          ? `${label} changed from ${formattedPreviousValue} to ${formattedNextValue}.`
          : `trAIder updated ${label} to ${formattedNextValue}.`,
        fieldKey: field,
        title: `Updated ${label}`
      });
      continue;
    }

    if (!nextValue && previousValue) {
      notifications.push({
        changeType: "removed",
        detail: `trAIder cleared ${label} from your saved profile memory.`,
        fieldKey: field,
        title: `Cleared ${label}`
      });
    }
  }

  return notifications;
}

function shortenForContext(value: string, maxWords = 18) {
  const cleaned = normalizeWhitespace(
    value
      .replace(/[*_`#>\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  if (!cleaned) {
    return null;
  }

  const words = cleaned.split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return cleaned;
  }

  return `${words.slice(0, maxWords).join(" ")}...`;
}

function buildRecentThreadSummary(history: WorkspaceMessage[]) {
  const recentTurns = history.slice(-6);
  if (!recentTurns.length) {
    return null;
  }

  return recentTurns
    .map((entry) => {
      const speaker = entry.role === "user" ? "User" : "Coach";
      return `${speaker}: ${shortenForContext(entry.content, 14) ?? ""}`;
    })
    .filter(Boolean)
    .join(" | ");
}

function compactHistoryForLLM(history: WorkspaceMessage[]) {
  return history.slice(-MAX_LLM_HISTORY_MESSAGES).map((entry) => ({
    role: entry.role,
    content: shortenForContext(entry.content, MAX_LLM_HISTORY_MESSAGE_WORDS) ?? entry.content
  }));
}

function collectThreadTickers(history: WorkspaceMessage[], userMessage: string, profile: TradingProfile) {
  const fromHistory = history.flatMap((entry) => extractTickerMentions(entry.content));
  const fromCurrentMessage = extractTickerMentions(userMessage);
  const fromProfile = parseSavedTickers(profile.focus_tickers);
  return mergeTickers(fromProfile, [...fromHistory, ...fromCurrentMessage]);
}

function buildFallbackHistoryCue(
  history: WorkspaceMessage[],
  userMessage: string,
  profile: TradingProfile
) {
  if (!history.length) {
    return null;
  }

  const recentUserMessages = history.filter((entry) => entry.role === "user");
  const lastUserMessage = recentUserMessages.at(-1)?.content ?? null;
  if (!lastUserMessage) {
    return null;
  }

  const contextAnchor = shortenForContext(lastUserMessage);
  if (!contextAnchor) {
    return null;
  }

  const refersBack = /\b(that|this|it|those|these|earlier|before|previous|last|same|again)\b/i.test(
    userMessage
  );
  const threadTickers = collectThreadTickers(history, userMessage, profile);
  const tickerClause = threadTickers.length
    ? ` I still have ${threadTickers.join(", ")} in the active thread context.`
    : "";

  if (refersBack) {
    return `I'm keeping the current thread in mind.${tickerClause} Just before this, you were discussing: "${contextAnchor}"`;
  }

  const priorUserMessage = recentUserMessages.at(-2)?.content ?? null;
  const priorAnchor = priorUserMessage ? shortenForContext(priorUserMessage, 12) : null;
  if (priorAnchor) {
    return `Thread context I'm carrying forward:${tickerClause} "${priorAnchor}" and then "${contextAnchor}"`;
  }

  return `Thread context I'm carrying forward:${tickerClause} "${contextAnchor}"`;
}

function shouldUseFallbackWebSearch(
  userMessage: string,
  history: WorkspaceMessage[],
  profile: TradingProfile
) {
  const cleanMessage = normalizeWhitespace(userMessage);
  const currentTickers = parseSavedTickers(profile.focus_tickers);
  const mentionedTickers = extractTickerMentions(userMessage, {
    allowLowercase: true,
    currentTickers
  });
  const hasExplicitWebRequest = WEB_SEARCH_REQUEST_HINT.test(cleanMessage);
  const hasTimeSensitiveTickerAsk =
    /\b(latest|recent|today|current|news|headline|headlines|what happened|why is|why did|catalyst|update|updates)\b/i.test(
      cleanMessage
    ) && mentionedTickers.length > 0;

  return (
    (isTradingRelevantMessage(userMessage, history, profile) ||
      hasTradingThreadContext(history, profile)) &&
    (hasExplicitWebRequest || hasTimeSensitiveTickerAsk)
  );
}

function buildWebSearchQuery(
  userMessage: string,
  history: WorkspaceMessage[],
  profile: TradingProfile
) {
  const cleanMessage = normalizeWhitespace(userMessage);
  const threadTickers = collectThreadTickers(history, userMessage, profile);
  const mentionedTickers = extractTickerMentions(userMessage, {
    allowLowercase: true,
    currentTickers: parseSavedTickers(profile.focus_tickers)
  });
  const primaryTicker = mentionedTickers[0] ?? threadTickers[0] ?? null;

  if (primaryTicker && /\b(latest|recent|today|current|now|news|headline|headlines|why is|what happened|catalyst|update|updates)\b/i.test(cleanMessage)) {
    return `${primaryTicker} stock latest news today`;
  }

  if (primaryTicker) {
    return `${cleanMessage} ${primaryTicker} stock`;
  }

  return `${cleanMessage} stock market`;
}

function trimWebSnippet(value: string) {
  const cleaned = normalizeWhitespace(value);
  if (cleaned.length <= 180) {
    return cleaned;
  }

  return `${cleaned.slice(0, 177).trimEnd()}...`;
}

async function searchGoogleWeb(
  userMessage: string,
  history: WorkspaceMessage[],
  profile: TradingProfile
) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY?.trim();
  const searchEngineId = process.env.GOOGLE_SEARCH_CX?.trim();

  if (!apiKey || !searchEngineId) {
    return null;
  }

  const query = buildWebSearchQuery(userMessage, history, profile);
  const searchParams = new URLSearchParams({
    cx: searchEngineId,
    gl: "us",
    hl: "en",
    key: apiKey,
    num: "3",
    q: query,
    safe: "active"
  });

  try {
    const response = await fetch(
      `https://customsearch.googleapis.com/customsearch/v1?${searchParams.toString()}`,
      {
        cache: "no-store",
        headers: {
          accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      items?: Array<{
        displayLink?: string;
        link?: string;
        snippet?: string;
        title?: string;
      }>;
    };

    return (data.items ?? [])
      .map((item) => {
        if (!item.title || !item.snippet || !item.link) {
          return null;
        }

        return {
          link: item.link,
          source: item.displayLink ?? "Web",
          snippet: trimWebSnippet(item.snippet),
          title: item.title.trim()
        } satisfies WebSearchResult;
      })
      .filter((item): item is WebSearchResult => Boolean(item));
  } catch {
    return null;
  }
}

function buildWebSearchBrief(results: WebSearchResult[]) {
  if (!results.length) {
    return null;
  }

  const summary = results
    .slice(0, 2)
    .map((result) => `${result.source}: ${result.snippet}`)
    .join(" ");

  const sources = results
    .slice(0, 3)
    .map((result) => result.source)
    .join(", ");

  return `Quick web read: ${summary} Sources scanned: ${sources}.`;
}

function buildTickerStatusGuard(
  userMessage: string,
  history: WorkspaceMessage[],
  profile: TradingProfile
) {
  const tickers = collectThreadTickers(history, userMessage, profile);
  if (!tickers.length) {
    return null;
  }

  return `Ticker status guard: Do not claim ${tickers.join(", ")} are delisted, inactive, acquired, renamed, or invalid unless verified by supplied web context in this turn. Missing provider data is not proof.`;
}

function buildVerifiedProfileChangeFacts(previous: TradingProfile, next: TradingProfile) {
  const previousTickers = parseSavedTickers(previous.focus_tickers);
  const nextTickers = parseSavedTickers(next.focus_tickers);
  const addedTickers = nextTickers.filter((ticker) => !previousTickers.includes(ticker));
  const removedTickers = previousTickers.filter((ticker) => !nextTickers.includes(ticker));
  const changedFields = GUIDED_PROFILE_KEYS.filter((field) => previous[field] !== next[field]).map(
    (field) => {
      const nextValue = next[field];
      if (!nextValue) {
        return `${PROFILE_FIELD_LABELS[field]} cleared`;
      }

      return `${PROFILE_FIELD_LABELS[field]} = ${
        formatProfileNotificationValue(field, nextValue) ?? nextValue
      }`;
    }
  );
  const facts: string[] = [];

  if (addedTickers.length) {
    facts.push(`focus tickers added: ${addedTickers.join(", ")}`);
  }

  if (removedTickers.length) {
    facts.push(`focus tickers removed: ${removedTickers.join(", ")}`);
  }

  if (changedFields.length) {
    facts.push(...changedFields);
  }

  return facts.length ? facts.join(" | ") : "none";
}

function replyContainsProfileSaveClaim(reply: string) {
  return /(?:\b(?:save|saved|add|added|remove|removed|clear|cleared|update|updated)\b[\s\S]{0,48}\b(?:focus tickers?|watchlist|profile memory|saved profile|profile|trading goal|goal|risk profile|risk tolerance|strategy style|preferred assets|experience level|trading rules?|rules?|rulebook|non[\s-]*negotiables?)\b)|(?:\b(?:focus tickers?|watchlist|profile memory|saved profile|profile|trading goal|goal|risk profile|risk tolerance|strategy style|preferred assets|experience level|trading rules?|rules?|rulebook|non[\s-]*negotiables?)\b[\s\S]{0,48}\b(?:save|saved|add|added|remove|removed|clear|cleared|update|updated)\b)|(?:didn['’]t save[\s\S]{0,40}\b(?:focus tickers?|watchlist|profile|trading goal|goal|risk profile|risk tolerance|strategy style|preferred assets|experience level|trading rules?|rules?|rulebook|non[\s-]*negotiables?)\b)/i.test(
    reply
  );
}

function inferRequestedProfileField(
  userMessage: string,
  currentProfile: TradingProfile
): keyof TradingProfile | null {
  const currentTickers = parseSavedTickers(currentProfile.focus_tickers);
  if (isTickerMemoryRequest(userMessage, currentTickers)) {
    return "focus_tickers";
  }

  for (const field of GUIDED_PROFILE_KEYS) {
    if (PROFILE_REFERENCE_PATTERNS[field].test(userMessage)) {
      return field;
    }
  }

  return null;
}

function isExplicitProfileMemoryChangeRequest(
  userMessage: string,
  currentProfile: TradingProfile,
  history: WorkspaceMessage[] = []
) {
  const currentTickers = parseSavedTickers(currentProfile.focus_tickers);
  if (isTickerMemoryRequest(userMessage, currentTickers)) {
    return true;
  }

  if (hasTickerMemoryFollowUpIntent(userMessage, history, currentTickers)) {
    return true;
  }

  if (
    PROFILE_REFERENCE_PATTERNS.trading_rules.test(userMessage) &&
    /\b(?:my|our)\s+(?:trading\s+)?(?:rules|rulebook|non[\s-]*negotiables?|guardrails?)\s+(?:are|is)\b/i.test(
      userMessage
    )
  ) {
    return true;
  }

  if (!(PROFILE_SET_INTENT.test(userMessage) || PROFILE_REMOVE_INTENT.test(userMessage))) {
    return false;
  }

  return GUIDED_PROFILE_KEYS.some((field) => PROFILE_REFERENCE_PATTERNS[field].test(userMessage));
}

function buildNoProfileChangeReply(
  userName: string,
  userMessage: string,
  profile: TradingProfile,
  history: WorkspaceMessage[] = []
) {
  const currentTickers = parseSavedTickers(profile.focus_tickers);
  const requestedField = inferRequestedProfileField(userMessage, profile);

  if (requestedField === "trading_goal") {
    const currentGoalCopy = profile.trading_goal
      ? `Right now your saved trading goal is ${profile.trading_goal}.`
      : "Right now you do not have a saved trading goal yet.";

    return maybeStripDisplayName(
      `I don't see a saved trading-goal change reflected for this turn. ${currentGoalCopy} If you want me to update it, say something explicit like "set my trading goal to consistency" or "remove my trading goal."`,
      history,
      userName
    );
  }

  if (requestedField === "risk_tolerance") {
    const currentRiskCopy = profile.risk_tolerance
      ? `Right now your saved risk profile is ${profile.risk_tolerance}.`
      : "Right now you do not have a saved risk profile yet.";

    return maybeStripDisplayName(
      `I don't see a saved risk-profile change reflected for this turn. ${currentRiskCopy} If you want me to update it, say something explicit like "set my risk profile to balanced" or "remove my risk profile."`,
      history,
      userName
    );
  }

  if (requestedField === "strategy_style") {
    const currentStyleCopy = profile.strategy_style
      ? `Right now your saved strategies are ${profile.strategy_style}.`
      : "Right now you do not have saved strategies yet.";

    return maybeStripDisplayName(
      `I don't see a saved strategy change reflected for this turn. ${currentStyleCopy} If you want me to update it, say something explicit like "set my strategies to momentum and mean reversion" or "remove my strategies."`,
      history,
      userName
    );
  }

  if (requestedField === "trading_rules") {
    const currentRulesCopy = profile.trading_rules
      ? `Right now your saved rules are ${parseRuleSegments(profile.trading_rules).join(" · ")}.`
      : "Right now you do not have saved trading rules yet.";

    return maybeStripDisplayName(
      `I don't see a saved rules change reflected for this turn. ${currentRulesCopy} If you want me to update them, say something explicit like "save this rule: stop after 2 losses" or "remove my rules."`,
      history,
      userName
    );
  }

  if (requestedField === "preferred_assets") {
    const currentAssetsCopy = profile.preferred_assets
      ? `Right now your saved preferred assets are ${profile.preferred_assets}.`
      : "Right now you do not have saved preferred assets yet.";

    return maybeStripDisplayName(
      `I don't see a saved preferred-assets change reflected for this turn. ${currentAssetsCopy} If you want me to update it, say something explicit like "set my preferred assets to options and stocks" or "remove my preferred assets."`,
      history,
      userName
    );
  }

  if (requestedField === "experience_level") {
    const currentExperienceCopy = profile.experience_level
      ? `Right now your saved experience level is ${profile.experience_level}.`
      : "Right now you do not have a saved experience level yet.";

    return maybeStripDisplayName(
      `I don't see a saved experience-level change reflected for this turn. ${currentExperienceCopy} If you want me to update it, say something explicit like "set my experience level to developing" or "remove my experience level."`,
      history,
      userName
    );
  }

  const currentTickerCopy = currentTickers.length
    ? `Right now I only have ${currentTickers.join(", ")} saved in your focus tickers.`
    : "Right now you do not have any saved focus tickers yet.";
  const referencedTickers = extractTickerMentions(userMessage, {
    allowLowercase: true,
    currentTickers
  });
  const exampleTicker = referencedTickers[0] ?? "NVDA";
  const removeRequested = TICKER_REMOVE_INTENT.test(userMessage);

  if (removeRequested && referencedTickers.length) {
    const missingRequestedTickers = referencedTickers.filter(
      (ticker) => !currentTickers.includes(ticker)
    );

    if (missingRequestedTickers.length === referencedTickers.length) {
      const tickerCopy =
        missingRequestedTickers.length > 1
          ? `${missingRequestedTickers.slice(0, -1).join(", ")} and ${missingRequestedTickers.at(-1)}`
          : missingRequestedTickers[0];

      return maybeStripDisplayName(
        `${tickerCopy} ${
          missingRequestedTickers.length > 1 ? "aren't" : "isn't"
        } in your saved focus tickers right now. ${currentTickerCopy}`,
        history,
        userName
      );
    }
  }

  return maybeStripDisplayName(
    `I don't see a saved focus-ticker change reflected for this turn. ${currentTickerCopy} If you want me to update it, say something explicit like "add ${exampleTicker} to my focus tickers" or "remove ${exampleTicker} from my focus tickers."`,
    history,
    userName
  );
}

function shouldSurfaceProfileContext(userMessage: string, profileUpdateApplied: boolean) {
  if (profileUpdateApplied) {
    return true;
  }

  return PROFILE_SURFACE_HINT.test(userMessage);
}

function fallbackReply({
  attachmentName,
  attachmentType,
  history,
  profile,
  previousProfile: _previousProfile,
  profileUpdateApplied,
  profileUpdateSummary,
  userMessage,
  userName,
  webSearchBrief
}: Omit<CoachReplyInput, "attachmentBytes"> & { webSearchBrief?: string | null }) {
  const cleanMessage = normalizeWhitespace(userMessage);
  const canUseDisplayName = shouldUseDisplayNameThisTurn(history, userName);
  const profileSummary = shouldSurfaceProfileContext(cleanMessage, profileUpdateApplied)
    ? summarizeProfile(profile)
    : null;
  const historyCue = buildFallbackHistoryCue(history, cleanMessage, profile);
  const observations: string[] = [];

  if (WEB_SEARCH_REQUEST_HINT.test(cleanMessage)) {
    if (webSearchBrief) {
      return [
        canUseDisplayName
          ? `${userName}, I checked the web for current trading context.`
          : "I checked the web for current trading context.",
        profileUpdateApplied ? profileUpdateSummary : null,
        historyCue,
        webSearchBrief,
        "Do you want me to turn that into a trade read, risk view, or a short watchlist note?"
      ]
        .filter(Boolean)
        .join(" ");
    }

    return [
      canUseDisplayName
        ? `${userName}, I can use the web in this build for trading lookups, but the search connector is not configured right now.`
        : "I can use the web in this build for trading lookups, but the search connector is not configured right now.",
      historyCue,
      profileSummary,
      "Add `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_CX` to `.env.local`, then I can pull current news and web context for a ticker or setup.",
      "If you want to keep moving right now, send me the ticker or trade question and I'll coach it from the context we already have."
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (isClearlyOffTopicMessage(cleanMessage, history, profile)) {
    return [
      canUseDisplayName
        ? `${userName}, let's keep this desk centered on trading.`
        : "Let's keep this desk centered on trading.",
      profileUpdateApplied ? profileUpdateSummary : null,
      "Send me a ticker, chart, trade setup, risk question, or a profile-memory change and I'll jump straight in.",
      nextProfileQuestion(profile)
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (/entry|stop|target|risk/i.test(cleanMessage)) {
    observations.push(
      "You are already thinking in terms of trade structure, which is the right foundation."
    );
  }

  if (/spy|qqq|nvda|tsla|aapl|btc|eth/i.test(cleanMessage)) {
    observations.push(
      "Instrument context matters here because volatility and liquidity change how disciplined execution needs to be."
    );
  }

  if (attachmentType?.startsWith("image/")) {
    observations.push(
      "For chart screenshots, the highest-value additions are ticker, timeframe, entry idea, stop level, and intended target."
    );
  }

  if (!observations.length) {
    observations.push(
      "The next step is to turn your input into a repeatable decision process instead of a one-off opinion."
    );
  }

  return [
    attachmentName
      ? canUseDisplayName
        ? `${userName}, I reviewed your upload, ${attachmentName}, and I can help you frame it clearly.`
        : `I reviewed your upload, ${attachmentName}, and I can help you frame it clearly.`
      : canUseDisplayName
        ? `${userName}, I'm trAIder, your AI trading coach, and I can help you break that down in a structured way.`
        : "I'm trAIder, your AI trading coach, and I can help you break that down in a structured way.",
    profileUpdateApplied ? profileUpdateSummary : null,
    historyCue,
    profileSummary,
    webSearchBrief,
    observations.join(" "),
    webSearchBrief
      ? "Do you want me to turn that web read into a trade plan, risk view, or watchlist decision?"
      : nextProfileQuestion(profile)
  ]
    .filter(Boolean)
    .join(" ");
}

function buildUserContent(
  userMessage: string,
  attachmentBytes: Buffer | null,
  attachmentName: string | null,
  attachmentType: string | null
) {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: userMessage }];

  if (attachmentBytes && attachmentType?.startsWith("image/")) {
    const dataUrl = `data:${attachmentType};base64,${attachmentBytes.toString("base64")}`;
    content.push({
      type: "image_url",
      image_url: { url: dataUrl }
    });
  } else if (attachmentName) {
    content.push({
      type: "text",
      text: summarizeAttachment(attachmentName, attachmentType) ?? ""
    });
  }

  return content;
}

function buildCoachDynamicContext(input: CoachReplyInput) {
  const lines = [
    `Trader display name (use sparingly): ${input.userName}`,
    `Display-name usage guidance for this turn: ${
      shouldUseDisplayNameThisTurn(input.history, input.userName)
        ? "Using the trader's name once is fine if it adds warmth, but do not force it."
        : "Do not use the trader's display name in this reply unless it is necessary for clarity."
    }`
  ];
  const isProfileMemoryTurn =
    input.profileUpdateApplied ||
    isExplicitProfileMemoryChangeRequest(input.userMessage, input.profile, input.history);

  if (isProfileMemoryTurn) {
    lines.push(
      `Previous saved profile JSON before this turn: ${JSON.stringify(input.previousProfile)}`,
      `Saved profile JSON: ${JSON.stringify(input.profile)}`,
      `Profile update status for this turn: ${
        input.profileUpdateApplied
          ? input.profileUpdateSummary ?? "updated"
          : "no saved profile change"
      }`,
      `Verified saved profile change facts for this turn: ${buildVerifiedProfileChangeFacts(
        input.previousProfile,
        input.profile
      )}`
    );
  } else if (hasTradingProfile(input.profile)) {
    lines.push(`Saved profile JSON: ${JSON.stringify(input.profile)}`);
  }

  const threadTickers = collectThreadTickers(input.history, input.userMessage, input.profile);
  if (threadTickers.length) {
    lines.push(`Active thread tickers: ${threadTickers.join(", ")}`);
    const tickerStatusGuard = buildTickerStatusGuard(
      input.userMessage,
      input.history,
      input.profile
    );
    if (tickerStatusGuard) {
      lines.push(tickerStatusGuard);
    }
  }

  const threadSummary = buildRecentThreadSummary(input.history);
  if (threadSummary) {
    lines.push(`Recent thread summary: ${threadSummary}`);
  }

  if (input.webSearchBrief) {
    lines.push(`Verified web context for this turn: ${input.webSearchBrief}`);
  }

  if (input.tradeCalendarBrief) {
    lines.push(`Verified P&L calendar context for this turn: ${input.tradeCalendarBrief}`);
  }

  const attachmentSummary = summarizeAttachment(input.attachmentName, input.attachmentType);
  if (attachmentSummary) {
    lines.push(attachmentSummary);
  }

  return lines.join("\n\n");
}

function extractCompletionText(content: unknown) {
  if (typeof content === "string") {
    return normalizeReplyText(content);
  }

  if (Array.isArray(content)) {
    const text = (content as Array<Record<string, unknown>>)
      .map((part) =>
        typeof part === "object" && part && "text" in part ? String(part.text) : ""
      )
      .join("\n\n");

    return normalizeReplyText(text);
  }

  return null;
}

function extractStreamingDeltaText(delta: unknown) {
  if (typeof delta === "string") {
    return delta;
  }

  if (Array.isArray(delta)) {
    return (delta as Array<Record<string, unknown>>)
      .map((part) => {
        if (typeof part !== "object" || !part) {
          return "";
        }

        if ("text" in part && typeof part.text === "string") {
          return part.text;
        }

        if ("type" in part && part.type === "text" && "text" in part) {
          return String(part.text ?? "");
        }

        return "";
      })
      .join("");
  }

  return "";
}

function buildCoachLLMRequest(input: CoachReplyInput) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

  const systemText = [SYSTEM_PROMPT, buildCoachDynamicContext(input)].join("\n\n");

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: systemText },
    ...compactHistoryForLLM(input.history),
    {
      role: "user",
      content: buildUserContent(
        input.userMessage,
        input.attachmentBytes,
        input.attachmentName,
        input.attachmentType
      )
    }
  ];

  return {
    apiKey,
    messages,
    model
  };
}

async function callLLM(input: CoachReplyInput, signal?: AbortSignal) {
  const llmRequest = buildCoachLLMRequest(input);
  if (!llmRequest) {
    return null;
  }

  const client = new OpenAI({ apiKey: llmRequest.apiKey });

  try {
    const response = await client.chat.completions.create({
      model: llmRequest.model,
      messages: llmRequest.messages as never,
      temperature: 0.4
    }, {
      signal
    });

    return extractCompletionText(response.choices[0]?.message?.content as unknown);
  } catch {
    return null;
  }

  return null;
}

async function streamLLM(input: CoachReplyInput, signal?: AbortSignal) {
  const llmRequest = buildCoachLLMRequest(input);
  if (!llmRequest) {
    return null;
  }

  const client = new OpenAI({ apiKey: llmRequest.apiKey });

  try {
    const response = await client.chat.completions.create(
      {
        model: llmRequest.model,
        messages: llmRequest.messages as never,
        stream: true,
        temperature: 0.4
      },
      {
        signal
      }
    );

    async function* readStream() {
      const allowName = shouldUseDisplayNameThisTurn(input.history, input.userName);
      let bufferedPrefix = "";
      let prefixFlushed = false;

      for await (const chunk of response) {
        const deltaText = extractStreamingDeltaText(chunk.choices[0]?.delta?.content);
        if (deltaText) {
          if (allowName || prefixFlushed) {
            yield deltaText;
            continue;
          }

          bufferedPrefix += deltaText;
          const shouldFlushPrefix =
            bufferedPrefix.length >= 96 || /[\n.!?]/.test(bufferedPrefix);
          if (!shouldFlushPrefix) {
            continue;
          }

          const sanitizedPrefix = stripLeadingDisplayName(bufferedPrefix, input.userName);
          if (sanitizedPrefix) {
            yield sanitizedPrefix;
          }
          prefixFlushed = true;
          bufferedPrefix = "";
        }
      }

      if (!allowName && !prefixFlushed && bufferedPrefix) {
        const sanitizedPrefix = stripLeadingDisplayName(bufferedPrefix, input.userName);
        if (sanitizedPrefix) {
          yield sanitizedPrefix;
        }
      }
    }

    return readStream();
  } catch {
    return null;
  }
}

async function callConversationTitleLLM(input: ConversationTitleInput) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Write a concise chat title for a trading conversation. Return only the title, no quotes, no punctuation at the end, max 6 words."
        },
        {
          role: "user",
          content: `User request:\n${input.userMessage}\n\nAssistant reply:\n${input.assistantMessage}`
        }
      ] as never
    });

    const content = response.choices[0]?.message?.content;
    if (typeof content === "string") {
      return normalizeConversationTitle(content);
    }
  } catch {
    return null;
  }

  return null;
}

export function extractProfileUpdates(
  userMessage: string,
  currentProfile: TradingProfile,
  history: WorkspaceMessage[] = []
) {
  const lowered = userMessage.toLowerCase();
  const profile: TradingProfile = { ...currentProfile };
  const currentTickers = parseSavedTickers(currentProfile.focus_tickers);
  const tradingRelevant = isTradingRelevantMessage(userMessage, history, currentProfile);
  const tickerMemoryRequest =
    isTickerMemoryRequest(userMessage, currentTickers) ||
    hasTickerMemoryFollowUpIntent(userMessage, history, currentTickers);

  if (tickerMemoryRequest) {
    const nextTickers = resolveTickerUpdate(userMessage, currentTickers, history);
    profile.focus_tickers = nextTickers.length ? nextTickers.join(", ") : null;
  }

  const clearedFields = (
    Object.entries(PROFILE_CLEAR_PATTERNS) as Array<[keyof TradingProfile, RegExp | undefined]>
  )
    .filter(([, pattern]) => pattern?.test(userMessage))
    .map(([field]) => field);

  for (const field of clearedFields) {
    profile[field] = null;
  }

  if (!clearedFields.includes("trading_rules")) {
    const explicitRuleUpdate = extractExplicitRuleUpdate(userMessage, currentProfile.trading_rules);
    if (explicitRuleUpdate?.touched) {
      profile.trading_rules = explicitRuleUpdate.nextValue;
    }
  }

  if (!tradingRelevant) {
    return profile;
  }

  for (const [keyword, value] of Object.entries(EXPERIENCE_MAP)) {
    if (!clearedFields.includes("experience_level") && lowered.includes(keyword)) {
      profile.experience_level = value;
      break;
    }
  }

  const assets = Object.entries(ASSET_HINTS)
    .filter(([keyword]) => lowered.includes(keyword))
    .map(([, value]) => value);
  if (assets.length && !clearedFields.includes("preferred_assets")) {
    profile.preferred_assets = [...new Set(assets)].join(", ");
  }

  const matchedStrategyStyles = extractStrategyStyleHints(userMessage);
  if (matchedStrategyStyles.length && !clearedFields.includes("strategy_style")) {
    const mentionsStrategyField = PROFILE_REFERENCE_PATTERNS.strategy_style.test(userMessage);
    const shouldReplaceStrategyStyle =
      mentionsStrategyField ||
      /\b(?:my|our)\s+(?:strategy|strategies|style|approach)\b/i.test(userMessage) ||
      /\b(?:i|we)\s+(?:trade|use|run|prefer|focus on)\b/i.test(userMessage);

    const nextStrategyStyles = shouldReplaceStrategyStyle
      ? matchedStrategyStyles
      : mergeProfileTerms(currentProfile.strategy_style, matchedStrategyStyles);

    profile.strategy_style = nextStrategyStyles.join(", ");
  }

  for (const [keyword, value] of Object.entries(RISK_HINTS)) {
    if (!clearedFields.includes("risk_tolerance") && lowered.includes(keyword)) {
      profile.risk_tolerance = value;
      break;
    }
  }

  for (const [keyword, value] of Object.entries(GOAL_HINTS)) {
    if (!clearedFields.includes("trading_goal") && lowered.includes(keyword)) {
      profile.trading_goal = value;
      break;
    }
  }

  return profile;
}

export async function generateCoachReply(input: CoachReplyInput) {
  const currentTickers = parseSavedTickers(input.profile.focus_tickers);
  const explicitProfileMemoryChange =
    !input.profileUpdateApplied &&
    isExplicitProfileMemoryChangeRequest(input.userMessage, input.profile, input.history);

  if (isAmbiguousBareTickerFollowUp(input.userMessage, input.history, currentTickers)) {
    return buildAmbiguousTickerTurnReply(
      input.userName,
      input.userMessage,
      currentTickers,
      input.history
    );
  }

  if (isClearlyOffTopicMessage(input.userMessage, input.history, input.profile)) {
    return fallbackReply(input);
  }

  if (explicitProfileMemoryChange) {
    return buildNoProfileChangeReply(
      input.userName,
      input.userMessage,
      input.profile,
      input.history
    );
  }

  const webSearchBrief = shouldUseFallbackWebSearch(
    input.userMessage,
    input.history,
    input.profile
  )
    ? buildWebSearchBrief(
        (await searchGoogleWeb(input.userMessage, input.history, input.profile)) ?? []
      )
    : null;

  const liveReply = await callLLM({
    ...input,
    webSearchBrief
  });
  if (liveReply) {
    const sanitizedLiveReply = maybeStripDisplayName(liveReply, input.history, input.userName);
    return sanitizedLiveReply;
  }

  return fallbackReply({
    ...input,
    webSearchBrief
  });
}

export async function generateCoachReplyResult(input: CoachReplyInput, signal?: AbortSignal) {
  const currentTickers = parseSavedTickers(input.profile.focus_tickers);
  const explicitProfileMemoryChange =
    !input.profileUpdateApplied &&
    isExplicitProfileMemoryChangeRequest(input.userMessage, input.profile, input.history);

  if (isAmbiguousBareTickerFollowUp(input.userMessage, input.history, currentTickers)) {
    return {
      mode: "reply",
      reply: buildAmbiguousTickerTurnReply(
        input.userName,
        input.userMessage,
        currentTickers,
        input.history
      )
    } satisfies CoachReplyResult;
  }

  if (isClearlyOffTopicMessage(input.userMessage, input.history, input.profile)) {
    return {
      mode: "reply",
      reply: fallbackReply(input)
    } satisfies CoachReplyResult;
  }

  if (explicitProfileMemoryChange) {
    return {
      mode: "reply",
      reply: buildNoProfileChangeReply(
        input.userName,
        input.userMessage,
        input.profile,
        input.history
      )
    } satisfies CoachReplyResult;
  }

  const webSearchBrief = shouldUseFallbackWebSearch(
    input.userMessage,
    input.history,
    input.profile
  )
    ? buildWebSearchBrief(
        (await searchGoogleWeb(input.userMessage, input.history, input.profile)) ?? []
      )
    : null;

  const resolvedInput = {
    ...input,
    webSearchBrief
  };
  const fallbackText = fallbackReply(resolvedInput);

  const stream = await streamLLM(resolvedInput, signal);
  if (!stream) {
    return {
      mode: "reply",
      reply: maybeStripDisplayName(fallbackText, input.history, input.userName)
    } satisfies CoachReplyResult;
  }

  return {
    fallbackReply: fallbackText,
    mode: "stream",
    stream
  } satisfies CoachReplyResult;
}

export async function generateConversationTitle(input: ConversationTitleInput) {
  const liveTitle = await callConversationTitleLLM(input);
  if (liveTitle) {
    return liveTitle;
  }

  return fallbackConversationTitle(input.userMessage);
}
