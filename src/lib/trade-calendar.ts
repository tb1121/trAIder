type TradeDraftStatus = "pending_confirmation" | "collecting_details";

export type TradeCalendarEntry = {
  conversationId: string | null;
  createdAt: string;
  id: string;
  notes: string | null;
  pnlAmount: number;
  tickers: string[];
  tradedOn: string;
  updatedAt: string;
};

export type TradeCalendarEntryInput = {
  conversationId: string | null;
  notes: string | null;
  pnlAmount: number;
  tickers: string[];
  tradedOn: string;
};

export type TradeCaptureDraft = {
  conversationId: string;
  createdAt: string;
  notes: string | null;
  pnlAmount: number | null;
  sourceMessage: string | null;
  status: TradeDraftStatus;
  tickers: string[];
  tradedOn: string;
  updatedAt: string;
};

export type TradeCaptureDraftInput = {
  notes: string | null;
  pnlAmount: number | null;
  sourceMessage: string | null;
  status: TradeDraftStatus;
  tickers: string[];
  tradedOn: string;
};

export type TradeCalendarNotice = {
  detail: string;
  notes: string | null;
  pnlAmount: number;
  tickers: string[];
  title: string;
  tradedOn: string;
};

export type TradeCaptureTurnResult =
  | {
      mode: "pass";
    }
  | {
      calendarEntry: TradeCalendarEntryInput | null;
      mode: "reply";
      nextDraft: TradeCaptureDraftInput | null;
      reply: string;
    };

const CALENDAR_KEYWORD_HINT = /\b(?:calendar|calend[a-z]*|p(?:&|and)?l|pl)\b/i;
const TRADE_DAY_HINT =
  /\b(today|this morning|this afternoon|this evening|just now|just took|just booked|just closed|for today|this session|on the open|at the open|at the close|this trade)\b/i;
const TRADE_ACTION_HINT =
  /\b(trade(?:d)?|took|long(?:ed)?|short(?:ed)?|bought|sold|closed|exited|covered|trimmed|entered|stopped(?:\s+out)?|scalp(?:ed|ing)?|swung)\b/i;
const TRADE_RESULT_HINT =
  /\b(won|made|booked|banked|gained|gain|green|profit|profited|lost|down|red|loss|gave back|p&l|pnl)\b/i;
const EXPLICIT_CALENDAR_INTENT =
  /\b(?:add|log|track|put|save|record)\b[\s\S]{0,36}\b(?:(?:p(?:&|and)?l|pl)(?:[\s\S]{0,18}\b(?:calendar|calend[a-z]*|log|entry))?|calend[a-z]*)\b/i;
const AFFIRMATIVE_REPLY =
  /\b(yes|yeah|yep|yup|sure|please do|do it|go ahead|sounds good|log it|add it|save it|record it|that works|ok|okay)\b/i;
const NEGATIVE_REPLY =
  /\b(nah|not now|skip it|skip that|leave it|don'?t|do not|no thanks|nope)\b/i;
const NOTES_SKIP_REPLY = /\b(no notes?|skip notes?|leave notes? blank|none)\b/i;
const TICKER_STOP_WORDS = new Set([
  "A",
  "ADD",
  "AGAIN",
  "ALL",
  "AM",
  "AN",
  "AND",
  "ARE",
  "AS",
  "AT",
  "BOOKED",
  "BOUGHT",
  "BUT",
  "BY",
  "CAN",
  "CLOSE",
  "CLOSED",
  "DAY",
  "DID",
  "DO",
  "FOR",
  "GAIN",
  "GAINED",
  "GO",
  "GREEN",
  "I",
  "IN",
  "IT",
  "JUST",
  "LOG",
  "LOSS",
  "LOST",
  "MADE",
  "MY",
  "NO",
  "NOW",
  "OF",
  "ON",
  "OR",
  "OUT",
  "P",
  "PL",
  "PNL",
  "PUT",
  "RED",
  "SAVE",
  "SOLD",
  "TAKE",
  "THAT",
  "THE",
  "THIS",
  "TODAY",
  "TO",
  "TRACK",
  "TRADE",
  "UP",
  "WON",
  "YES"
]);
const COMMON_MARKET_SYMBOLS = new Set([
  "AAPL",
  "AMD",
  "AMZN",
  "COHR",
  "GOOG",
  "GOOGL",
  "IWM",
  "META",
  "MSFT",
  "MU",
  "NFLX",
  "NQ",
  "NVDA",
  "PLTR",
  "QQQ",
  "SNDK",
  "SMCI",
  "SOFI",
  "SPY",
  "TSLA",
  "WDC"
]);

type TradeSnapshot = {
  mentionsTradeToday: boolean;
  notes: string | null;
  pnlAmount: number | null;
  tickers: string[];
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isTradeCalendarCancellationReply(message: string) {
  const normalized = normalizeWhitespace(message).toLowerCase();

  if (!normalized) {
    return false;
  }

  if (NOTES_SKIP_REPLY.test(normalized)) {
    return false;
  }

  if (AFFIRMATIVE_REPLY.test(normalized) || EXPLICIT_CALENDAR_INTENT.test(normalized)) {
    return false;
  }

  return normalized === "no" || NEGATIVE_REPLY.test(normalized);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function parseNumberToken(value: string) {
  const cleaned = value.replace(/[$,]/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBarePnlReply(
  message: string,
  existingDraft: TradeCaptureDraft | null
) {
  if (!existingDraft || existingDraft.pnlAmount !== null) {
    return null;
  }

  const normalized = normalizeWhitespace(message);
  if (!normalized) {
    return null;
  }

  const bareMatch = normalized.match(/^[+-]?\$?\s*(\d[\d,]*(?:\.\d+)?)$/);
  if (!bareMatch) {
    return null;
  }

  const parsed = parseNumberToken(bareMatch[1]);
  if (parsed === null) {
    return null;
  }

  return normalized.trim().startsWith("-") ? -Math.abs(parsed) : Math.abs(parsed);
}

function extractPnlAmount(message: string) {
  const signedMatch = message.match(/([+-])\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/i);
  if (signedMatch) {
    const magnitude = parseNumberToken(signedMatch[2]);
    if (magnitude !== null) {
      return signedMatch[1] === "-" ? -Math.abs(magnitude) : Math.abs(magnitude);
    }
  }

  const positivePatterns = [
    /\b(?:won|made|booked|banked|gained|up|green|profit(?:ed)?)\s+\$?\s*(\d[\d,]*(?:\.\d+)?)/i,
    /\$?\s*(\d[\d,]*(?:\.\d+)?)\s+\b(?:profit|gain)\b/i,
    /\b(\d[\d,]*(?:\.\d+)?)\s+(?:dollars?|bucks?)\s+\b(?:profit|gain)\b/i
  ];
  for (const pattern of positivePatterns) {
    const match = message.match(pattern);
    const parsed = match?.[1] ? parseNumberToken(match[1]) : null;
    if (parsed !== null) {
      return Math.abs(parsed);
    }
  }

  const negativePatterns = [
    /\b(?:lost|down|red|loss|gave back)\s+\$?\s*(\d[\d,]*(?:\.\d+)?)/i,
    /\$?\s*(\d[\d,]*(?:\.\d+)?)\s+\b(?:loss)\b/i,
    /\b(\d[\d,]*(?:\.\d+)?)\s+(?:dollars?|bucks?)\s+\b(?:loss)\b/i
  ];
  for (const pattern of negativePatterns) {
    const match = message.match(pattern);
    const parsed = match?.[1] ? parseNumberToken(match[1]) : null;
    if (parsed !== null) {
      return -Math.abs(parsed);
    }
  }

  return null;
}

function normalizeTickerToken(token: string, knownSymbols: Set<string>) {
  const stripped = token.replace(/^\$/, "").replace(/[^A-Za-z]/g, "");
  if (!stripped) {
    return null;
  }

  const upper = stripped.toUpperCase();
  const looksExplicit = token.startsWith("$");
  const looksUppercase = stripped === upper;
  const isKnown = knownSymbols.has(upper);

  if (upper.length < 1 || upper.length > 6) {
    return null;
  }

  if (upper.length === 1 && !looksExplicit && !isKnown) {
    return null;
  }

  if (TICKER_STOP_WORDS.has(upper) && !isKnown) {
    return null;
  }

  if (!looksExplicit && !looksUppercase && !isKnown) {
    return null;
  }

  return upper;
}

function extractTradeTickers(message: string, focusTickers: string[], draftTickers: string[]) {
  const knownSymbols = new Set([
    ...COMMON_MARKET_SYMBOLS,
    ...focusTickers.map((ticker) => ticker.toUpperCase()),
    ...draftTickers.map((ticker) => ticker.toUpperCase())
  ]);
  const seen = new Set<string>();
  const tickers: string[] = [];

  for (const match of message.matchAll(/\b\$?[A-Za-z]{1,6}\b/g)) {
    const normalized = normalizeTickerToken(match[0], knownSymbols);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    tickers.push(normalized);
  }

  return tickers;
}

function cleanTradeNotesCandidate(message: string, tickers: string[]) {
  let candidate = normalizeWhitespace(message);

  candidate = candidate
    .replace(EXPLICIT_CALENDAR_INTENT, " ")
    .replace(/\b(?:add|log|track|put|save|record)\b[\s\S]{0,12}\b(?:it|this|that)\b/gi, " ")
    .replace(/\b(?:yes|yeah|yep|sure|please|okay|ok|no|nah)\b/gi, " ")
    .replace(TRADE_DAY_HINT, " ")
    .replace(/\b(?:p(?:&|and)?l|pl)\b/gi, " ")
    .replace(/\b(?:calendar|entry|log)\b/gi, " ");

  for (const ticker of tickers) {
    candidate = candidate.replace(new RegExp(`\\b\\$?${ticker}\\b`, "gi"), " ");
  }

  candidate = candidate
    .replace(/([+-])\s*\$?\s*\d[\d,]*(?:\.\d+)?/g, " ")
    .replace(/\$?\s*\d[\d,]*(?:\.\d+)?/g, " ")
    .replace(/[.,!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return candidate;
}

function extractTradeNotes(message: string, tickers: string[]) {
  if (NOTES_SKIP_REPLY.test(message)) {
    return null;
  }

  const candidate = cleanTradeNotesCandidate(message, tickers);
  if (!candidate) {
    return null;
  }

  const words = candidate.split(" ").filter(Boolean);
  if (words.length < 3) {
    return null;
  }

  return normalizeWhitespace(message).slice(0, 280);
}

function extractTradeSnapshot(
  message: string,
  focusTickers: string[],
  draftTickers: string[]
): TradeSnapshot {
  const tickers = extractTradeTickers(message, focusTickers, draftTickers);
  const pnlAmount = extractPnlAmount(message);
  const notes = extractTradeNotes(message, tickers);
  const mentionsTradeToday =
    TRADE_DAY_HINT.test(message) &&
    (TRADE_ACTION_HINT.test(message) || TRADE_RESULT_HINT.test(message) || tickers.length > 0);

  return {
    mentionsTradeToday,
    notes,
    pnlAmount,
    tickers
  };
}

function mergeTradeDraft(
  existingDraft: TradeCaptureDraftInput,
  snapshot: TradeSnapshot,
  userMessage: string
) {
  return {
    ...existingDraft,
    notes: snapshot.notes ?? existingDraft.notes,
    pnlAmount: snapshot.pnlAmount ?? existingDraft.pnlAmount,
    sourceMessage: normalizeWhitespace(
      [existingDraft.sourceMessage, userMessage].filter(Boolean).join(" ")
    ).slice(0, 560),
    tickers: uniqueStrings([...existingDraft.tickers, ...snapshot.tickers])
  } satisfies TradeCaptureDraftInput;
}

function getMissingRequiredTradeFields(draft: TradeCaptureDraftInput) {
  const missing: string[] = [];
  if (!draft.tickers.length) {
    missing.push("ticker");
  }
  if (draft.pnlAmount === null) {
    missing.push("P&L amount");
  }
  return missing;
}

function hasRequiredTradeFields(draft: TradeCaptureDraftInput) {
  return getMissingRequiredTradeFields(draft).length === 0;
}

function formatTradeDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(parsed);
}

export function formatTradePnlAmount(value: number) {
  const formatter = new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) % 1 === 0 ? 0 : 2,
    minimumFractionDigits: 0,
    style: "currency"
  });
  const formatted = formatter.format(Math.abs(value));

  if (value > 0) {
    return `+${formatted}`;
  }

  if (value < 0) {
    return `-${formatted}`;
  }

  return formatted;
}

export function buildTradeCalendarNotice(entry: TradeCalendarEntryInput): TradeCalendarNotice {
  const tickerLabel = entry.tickers.join(", ");
  const amountLabel = formatTradePnlAmount(entry.pnlAmount);

  return {
    detail: `${tickerLabel} · ${amountLabel} · ${formatTradeDate(entry.tradedOn)}`,
    notes: entry.notes,
    pnlAmount: entry.pnlAmount,
    tickers: entry.tickers,
    title: "Trade logged to P&L calendar",
    tradedOn: entry.tradedOn
  };
}

function buildTradeCalendarInviteReply(userName: string, snapshot: TradeSnapshot) {
  const tickerCopy = snapshot.tickers.length
    ? `I picked up ${snapshot.tickers.join(", ")} from what you said.`
    : "I can pull the ticker from that trade once you confirm it.";

  return `That sounds like a trade from today. Do you want me to add it to your P&L calendar? ${tickerCopy} If you do, I’ll make sure I have the ticker, realized P&L, and any notes you want included.`;
}

function buildTradeCalendarMissingReply(userName: string, draft: TradeCaptureDraftInput) {
  const missing = getMissingRequiredTradeFields(draft);
  const formattedMissing =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")}, and ${missing.at(-1)}`;

  return `I can log that to your P&L calendar. I still need the ${formattedMissing} before I save the entry.`;
}

function buildTradeCalendarNotesReply() {
  return 'I can log that to your P&L calendar. I already have the ticker and realized P&L. Any notes you want included? If not, say "no notes" and I’ll log it as-is.';
}

export function buildTradeCalendarSavedReply(entry: TradeCalendarEntryInput) {
  const amountLabel = formatTradePnlAmount(entry.pnlAmount);
  const tickersLabel = entry.tickers.join(", ");

  return `Your trade is now logged to the P&L calendar for ${formatTradeDate(
    entry.tradedOn
  )}. I saved ${tickersLabel} with realized P&L of ${amountLabel}${
    entry.notes ? " along with your notes." : "."
  }`;
}

function buildCancelledReply(userName: string) {
  return "Understood. I’ll keep it in the chat and leave the P&L calendar unchanged.";
}

function shouldTreatAsTradeMention(message: string, snapshot: TradeSnapshot) {
  return snapshot.mentionsTradeToday;
}

export function normalizeTradeCalendarTickers(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return uniqueStrings(
    value
      .split(/[,\s/]+/)
      .map((segment) => segment.trim().toUpperCase())
      .filter(Boolean)
  );
}

export function serializeTradeCalendarTickers(tickers: string[]) {
  return uniqueStrings(tickers.map((ticker) => ticker.toUpperCase())).join(", ");
}

export function seedTradeCaptureDraftFromMessage(input: {
  currentDate: string;
  focusTickers: string[];
  userMessage: string;
}): TradeCaptureDraftInput | null {
  const normalizedMessage = normalizeWhitespace(input.userMessage);
  const snapshot = extractTradeSnapshot(normalizedMessage, input.focusTickers, []);

  if (!snapshot.tickers.length && snapshot.pnlAmount === null && snapshot.notes === null) {
    return null;
  }

  return {
    notes: snapshot.notes,
    pnlAmount: snapshot.pnlAmount,
    sourceMessage: normalizedMessage,
    status: "collecting_details",
    tickers: snapshot.tickers,
    tradedOn: input.currentDate
  };
}

export function resolveTradeCaptureTurn(input: {
  currentDate: string;
  existingDraft: TradeCaptureDraft | null;
  focusTickers: string[];
  userMessage: string;
  userName: string;
}): TradeCaptureTurnResult {
  const normalizedMessage = normalizeWhitespace(input.userMessage);
  const explicitCalendarIntent = EXPLICIT_CALENDAR_INTENT.test(normalizedMessage);
  const snapshot = extractTradeSnapshot(
    normalizedMessage,
    input.focusTickers,
    input.existingDraft?.tickers ?? []
  );
  const inferredBarePnlAmount = parseBarePnlReply(normalizedMessage, input.existingDraft);

  if (input.existingDraft) {
    if (isTradeCalendarCancellationReply(normalizedMessage)) {
      return {
        calendarEntry: null,
        mode: "reply",
        nextDraft: null,
        reply: buildCancelledReply(input.userName)
      };
    }

    const draftBase: TradeCaptureDraftInput = {
      notes: input.existingDraft.notes,
      pnlAmount: input.existingDraft.pnlAmount,
      sourceMessage: input.existingDraft.sourceMessage,
      status: input.existingDraft.status,
      tickers: input.existingDraft.tickers,
      tradedOn: input.existingDraft.tradedOn
    };
    const mergedDraft = mergeTradeDraft(draftBase, snapshot, normalizedMessage);
    const effectiveDraft =
      inferredBarePnlAmount !== null
        ? {
            ...mergedDraft,
            pnlAmount: inferredBarePnlAmount
          }
        : mergedDraft;
    const isAffirmative =
      AFFIRMATIVE_REPLY.test(normalizedMessage) ||
      explicitCalendarIntent ||
      snapshot.tickers.length > 0 ||
      snapshot.pnlAmount !== null ||
      snapshot.notes !== null ||
      NOTES_SKIP_REPLY.test(normalizedMessage) ||
      inferredBarePnlAmount !== null;

    if (!isAffirmative) {
      return { mode: "pass" };
    }

    if (!hasRequiredTradeFields(effectiveDraft)) {
      return {
        calendarEntry: null,
        mode: "reply",
        nextDraft: {
          ...effectiveDraft,
          status: "collecting_details"
        },
        reply: buildTradeCalendarMissingReply(input.userName, {
          ...effectiveDraft,
          status: "collecting_details"
        })
      };
    }

    if (effectiveDraft.notes !== null || NOTES_SKIP_REPLY.test(normalizedMessage)) {
      const calendarEntry: TradeCalendarEntryInput = {
        conversationId: input.existingDraft.conversationId,
        notes: NOTES_SKIP_REPLY.test(normalizedMessage) ? null : effectiveDraft.notes,
        pnlAmount: effectiveDraft.pnlAmount ?? 0,
        tickers: effectiveDraft.tickers,
        tradedOn: effectiveDraft.tradedOn
      };

      return {
        calendarEntry,
        mode: "reply",
        nextDraft: null,
        reply: buildTradeCalendarSavedReply(calendarEntry)
      };
    }

    return {
      calendarEntry: null,
      mode: "reply",
      nextDraft: {
        ...effectiveDraft,
        status: "collecting_details"
      },
      reply: buildTradeCalendarNotesReply()
    };
  }

  if (explicitCalendarIntent) {
    const draft: TradeCaptureDraftInput = {
      notes: snapshot.notes,
      pnlAmount: snapshot.pnlAmount,
      sourceMessage: normalizedMessage,
      status: "collecting_details",
      tickers: snapshot.tickers,
      tradedOn: input.currentDate
    };

    if (!hasRequiredTradeFields(draft)) {
      return {
        calendarEntry: null,
        mode: "reply",
        nextDraft: draft,
        reply: buildTradeCalendarMissingReply(input.userName, draft)
      };
    }

    if (draft.notes !== null || NOTES_SKIP_REPLY.test(normalizedMessage)) {
      const calendarEntry: TradeCalendarEntryInput = {
        conversationId: null,
        notes: NOTES_SKIP_REPLY.test(normalizedMessage) ? null : draft.notes,
        pnlAmount: draft.pnlAmount ?? 0,
        tickers: draft.tickers,
        tradedOn: draft.tradedOn
      };

      return {
        calendarEntry,
        mode: "reply",
        nextDraft: null,
        reply: buildTradeCalendarSavedReply(calendarEntry)
      };
    }

    return {
      calendarEntry: null,
      mode: "reply",
      nextDraft: {
        ...draft,
        status: "collecting_details"
      },
      reply: buildTradeCalendarNotesReply()
    };
  }

  if (!shouldTreatAsTradeMention(normalizedMessage, snapshot)) {
    return { mode: "pass" };
  }

  const draft: TradeCaptureDraftInput = {
    notes: snapshot.notes,
    pnlAmount: snapshot.pnlAmount,
    sourceMessage: normalizedMessage,
    status: "pending_confirmation",
    tickers: snapshot.tickers,
    tradedOn: input.currentDate
  };

  return {
    calendarEntry: null,
    mode: "reply",
    nextDraft: draft,
    reply: buildTradeCalendarInviteReply(input.userName, snapshot)
  };
}
