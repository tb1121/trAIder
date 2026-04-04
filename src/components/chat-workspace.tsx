"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDisplayNameCandidate } from "@/lib/display-name";
import type { TradingProfile, WorkspaceMessage, WorkspaceQuickAction } from "@/lib/coach";
import type { ConversationSummary, WorkspaceNotification } from "@/lib/data";
import type { TradeCalendarEntry, TradeCalendarNotice } from "@/lib/trade-calendar";

type ChatWorkspaceProps = {
  deskTitle: string;
  initialConversationSummaries: ConversationSummary[];
  initialConversationId: string | null;
  initialDraftMessage?: string | null;
  initialIntro: string;
  initialIntroTimestamp: string;
  initialMessages: WorkspaceMessage[];
  onStartNewChat?: () => void;
  initialProfile: TradingProfile;
  initialShowHero?: boolean;
  userName: string;
};

type InsightTab = "memory" | "strategy" | "risk" | "signal";
type ProfileFieldKey = keyof TradingProfile;

const INSIGHT_TABS: Array<{ id: InsightTab; label: string }> = [
  { id: "memory", label: "Memory" },
  { id: "strategy", label: "Style" },
  { id: "risk", label: "Risk" },
  { id: "signal", label: "Signal" }
];
const PROFILE_FIELD_ORDER: ProfileFieldKey[] = [
  "focus_tickers",
  "preferred_assets",
  "strategy_style",
  "risk_tolerance",
  "trading_rules",
  "trading_goal",
  "experience_level"
];
const PROFILE_FIELD_DISPLAY_LABELS: Record<ProfileFieldKey, string> = {
  experience_level: "experience level",
  focus_tickers: "focus tickers",
  preferred_assets: "preferred assets",
  strategy_style: "strategies",
  trading_rules: "rules",
  risk_tolerance: "risk tolerance",
  trading_goal: "trading goal"
};

type PromptAction = {
  label: string;
  prompt: string;
};

type SubmitMessageOptions = {
  branchConversationId?: string | null;
  editFromMessageCreatedAt?: string | null;
  forceNewConversation?: boolean;
  replaceMessages?: WorkspaceMessage[] | null;
  restoreMessagesOnError?: WorkspaceMessage[] | null;
};

type RevealingReply = {
  createdAt: string;
  visibleContent: string;
};

type ChatStreamDoneEvent = {
  assistantMessage: string;
  assistantMessageCreatedAt: string;
  conversationId: string;
  conversationTitle: string;
  notifications: WorkspaceNotification[];
  profile: TradingProfile;
  quickActions: WorkspaceQuickAction[];
  tradeCalendarEntry: TradeCalendarEntry | null;
  tradeCalendarNotice: TradeCalendarNotice | null;
  type: "done";
  userAttachmentDataUrl: string | null;
  userAttachmentName: string | null;
  userAttachmentType: string | null;
  userMessageCreatedAt: string;
  userName: string;
};

type ChatStreamEvent =
  | {
      content: string;
      type: "delta";
    }
  | ChatStreamDoneEvent
  | {
      message: string;
      type: "error";
    };

function buildThinkingSteps({
  message,
  hasAttachment,
  profile
}: {
  message: string;
  hasAttachment: boolean;
  profile: TradingProfile;
}) {
  const normalized = message.toLowerCase();
  const steps = ["Reading your prompt"];
  const hasSavedSignals = Object.values(profile).some(Boolean);
  const isMemoryAction = /\b(add|remove|save|track|remember|update|change|pin)\b/.test(normalized);
  const isTradeCoachingRequest = /\b(trade|risk|stop|loss|entry|target|position|size|rule)\b/.test(
    normalized
  );

  if (hasAttachment) {
    steps.push("Looking over your upload");
  }

  if (isMemoryAction) {
    steps.push("Checking what the desk already has saved");
  } else if (hasSavedSignals) {
    steps.push("Pulling in your saved desk context");
  }

  steps.push(isTradeCoachingRequest ? "Framing the coaching angle" : "Shaping the response");
  steps.push("Writing it cleanly");

  return steps;
}

function CopyIcon({ copied = false }: { copied?: boolean }) {
  if (copied) {
    return (
      <svg aria-hidden="true" className="oracle-bubble-action-icon" viewBox="0 0 20 20">
        <path
          d="M4.5 10.5l3.2 3.2 7.8-7.9"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="oracle-bubble-action-icon" viewBox="0 0 20 20">
      <rect
        x="6.2"
        y="3.8"
        width="8.2"
        height="8.2"
        rx="1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="3.6"
        y="6.4"
        width="8.2"
        height="8.2"
        rx="1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" className="oracle-bubble-action-icon" viewBox="0 0 20 20">
      <path
        d="M4.1 14.8l3-.6 7-7a1.5 1.5 0 0 0-2.2-2.2l-7 7-.8 2.8z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M10.6 5.5l3.9 3.9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" className="oracle-send-icon oracle-send-icon-stop" viewBox="0 0 20 20">
      <rect x="5.1" y="5.1" width="9.8" height="9.8" rx="2.2" fill="currentColor" />
    </svg>
  );
}

function QuickActionGlyph({ kind }: { kind: WorkspaceQuickAction["kind"] }) {
  if (kind === "prefill") {
    return (
      <svg aria-hidden="true" className="oracle-inline-action-icon" viewBox="0 0 20 20">
        <path
          d="M4.1 14.8l3-.6 7-7a1.5 1.5 0 0 0-2.2-2.2l-7 7-.8 2.8z"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.45"
        />
        <path
          d="M10.6 5.5l3.9 3.9"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.45"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="oracle-inline-action-icon" viewBox="0 0 20 20">
      <path
        d="M4.4 10.2h9.2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.55"
      />
      <path
        d="M10.6 6.4l3.8 3.8-3.8 3.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.55"
      />
    </svg>
  );
}

function getRotatingPromptWindow(actions: PromptAction[], startIndex: number, count = 4) {
  if (!actions.length) {
    return [];
  }

  return Array.from({ length: Math.min(count, actions.length) }, (_, offset) => {
    return actions[(startIndex + offset) % actions.length];
  });
}

function InsightGlyph({ id }: { id: InsightTab }) {
  if (id === "memory") {
    return (
      <svg aria-hidden="true" className="oracle-insight-glyph" viewBox="0 0 24 24">
        <rect x="5" y="6" width="14" height="4" rx="1.5" />
        <rect x="5" y="10.5" width="14" height="4" rx="1.5" />
        <rect x="5" y="15" width="14" height="4" rx="1.5" />
      </svg>
    );
  }

  if (id === "strategy") {
    return (
      <svg aria-hidden="true" className="oracle-insight-glyph" viewBox="0 0 24 24">
        <path d="M12 4.5l5 2.3v4.2c0 3.5-2 6.7-5 8.5-3-1.8-5-5-5-8.5V6.8l5-2.3z" />
        <path d="M9.5 12l1.7 1.7 3.3-3.4" />
      </svg>
    );
  }

  if (id === "risk") {
    return (
      <svg aria-hidden="true" className="oracle-insight-glyph" viewBox="0 0 24 24">
        <path d="M12 4.5l7 3v4.8c0 4.3-2.7 8.1-7 9.7-4.3-1.6-7-5.4-7-9.7V7.5l7-3z" />
        <path d="M12 8v5.2" />
        <circle cx="12" cy="16.3" r="0.9" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="oracle-insight-glyph" viewBox="0 0 24 24">
      <path d="M5 15.5l4-4 3 2.5 6-6" />
      <path d="M14.5 8h3.5v3.5" />
      <path d="M5 19h14" />
    </svg>
  );
}

type MessageBlock =
  | { type: "heading"; content: string; level: number }
  | { type: "line-group"; items: string[] }
  | { type: "paragraph"; content: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[]; start: number }
  | { type: "rule" };

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`} className="message-strong">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      nodes.push(
        <em key={`${keyPrefix}-em-${match.index}`} className="message-emphasis">
          {match[3]}
        </em>
      );
    } else if (match[4]) {
      nodes.push(
        <code key={`${keyPrefix}-code-${match.index}`} className="message-inline-code">
          {match[4]}
        </code>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length ? nodes : [text];
}

function getMessageActionKey(entry: WorkspaceMessage, index: number) {
  return `${entry.role}-${entry.createdAt}-${index}`;
}

function parseMessageBlocks(content: string): MessageBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MessageBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2].trim()
      });
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index]?.trim() ?? "";
        if (!current) {
          index += 1;
          continue;
        }
        const match = current.match(/^[-*•]\s+(.+)$/);
        if (!match) {
          break;
        }
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "unordered-list", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      const start = Number(line.match(/^(\d+)\./)?.[1] ?? "1");
      while (index < lines.length) {
        const current = lines[index]?.trim() ?? "";
        if (!current) {
          index += 1;
          continue;
        }
        const match = current.match(/^\d+\.\s+(.+)$/);
        if (!match) {
          break;
        }
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "ordered-list", items, start });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      const trimmed = current.trim();
      if (!trimmed) {
        break;
      }
      if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        break;
      }
      paragraphLines.push(trimmed);
      index += 1;
    }

    const previousBlock = blocks[blocks.length - 1];
    const shouldRenderAsLineGroup =
      paragraphLines.length > 1 &&
      (previousBlock?.type === "heading" ||
        paragraphLines.every((entry) => entry.length <= 180 && !/\s{2,}/.test(entry)));

    if (shouldRenderAsLineGroup) {
      blocks.push({ type: "line-group", items: paragraphLines });
      continue;
    }

    blocks.push({ type: "paragraph", content: paragraphLines.join(" ") });
  }

  return blocks;
}

function MessageContent({
  content,
  renderMarkdown
}: {
  content: string;
  renderMarkdown: boolean;
}) {
  if (!renderMarkdown) {
    return <p className="message-paragraph">{content}</p>;
  }

  const blocks = parseMessageBlocks(content);
  return (
    <div className="message-body">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const HeadingTag: "h2" | "h3" | "h4" | "h5" =
            block.level <= 1 ? "h2" : block.level === 2 ? "h3" : block.level === 3 ? "h4" : "h5";
          return (
            <HeadingTag className={`message-heading message-heading-${block.level}`} key={`h-${index}`}>
              {renderInlineMarkdown(block.content, `h-${index}`)}
            </HeadingTag>
          );
        }

        if (block.type === "rule") {
          return <hr className="message-rule" key={`hr-${index}`} />;
        }

        if (block.type === "line-group") {
          return (
            <div className="message-line-group" key={`lg-${index}`}>
              {block.items.map((item, itemIndex) => (
                <p className="message-paragraph" key={`lg-${index}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `lg-${index}-${itemIndex}`)}
                </p>
              ))}
            </div>
          );
        }

        if (block.type === "unordered-list") {
          return (
            <ul className="message-list" key={`ul-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li className="message-list-item" key={`ul-${index}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `ul-${index}-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered-list") {
          return (
            <ol
              className="message-list message-list-ordered"
              key={`ol-${index}`}
              start={block.start}
            >
              {block.items.map((item, itemIndex) => (
                <li className="message-list-item" key={`ol-${index}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `ol-${index}-${itemIndex}`)}
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p className="message-paragraph" key={`p-${index}`}>
            {renderInlineMarkdown(block.content, `p-${index}`)}
          </p>
        );
      })}
    </div>
  );
}

function MessageAttachment({
  attachmentDataUrl,
  attachmentName,
  attachmentType
}: {
  attachmentDataUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
}) {
  if (!attachmentName && !attachmentDataUrl) {
    return null;
  }

  const isImage = Boolean(attachmentType?.startsWith("image/") && attachmentDataUrl);

  if (isImage) {
    return (
      <figure className="oracle-message-attachment oracle-message-attachment-image">
        <img
          alt={attachmentName ?? "Uploaded screenshot"}
          className="oracle-message-image"
          loading="lazy"
          src={attachmentDataUrl ?? undefined}
        />
        {attachmentName ? (
          <figcaption className="oracle-message-attachment-label">{attachmentName}</figcaption>
        ) : null}
      </figure>
    );
  }

  return (
    <div className="oracle-message-attachment oracle-message-attachment-file">
      <span className="oracle-message-attachment-label">
        {attachmentName ?? "Attached file"}
      </span>
    </div>
  );
}

function formatMessageTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function formatConversationTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(parsed);
}

function profileSignature(profile: TradingProfile) {
  return JSON.stringify(profile);
}

function parseFocusTickerList(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => ticker !== "PL" && ticker !== "PNL")
    .filter(Boolean);
}

function getAddedFocusTickers(previous: TradingProfile, next: TradingProfile) {
  const previousSet = new Set(parseFocusTickerList(previous.focus_tickers));
  return parseFocusTickerList(next.focus_tickers).filter((ticker) => !previousSet.has(ticker));
}

function getRemovedFocusTickers(previous: TradingProfile, next: TradingProfile) {
  const nextSet = new Set(parseFocusTickerList(next.focus_tickers));
  return parseFocusTickerList(previous.focus_tickers).filter((ticker) => !nextSet.has(ticker));
}

function getAddedOrUpdatedProfileFields(
  previous: TradingProfile,
  next: TradingProfile
): ProfileFieldKey[] {
  return PROFILE_FIELD_ORDER.filter((key) => {
    if (key === "focus_tickers") {
      return false;
    }

    return Boolean(next[key]) && previous[key] !== next[key];
  });
}

function getRemovedProfileFields(previous: TradingProfile, next: TradingProfile): ProfileFieldKey[] {
  return PROFILE_FIELD_ORDER.filter((key) => {
    if (key === "focus_tickers") {
      return false;
    }

    return Boolean(previous[key]) && !next[key];
  });
}

function renderFocusTickerValue(
  value: string | null,
  revealTickers: string[],
  revealProgress: Record<string, number>,
  removedTickers: string[],
  previousTickers: string[]
) {
  const currentTickers = parseFocusTickerList(value);
  const removedSet = new Set(removedTickers);
  const revealSet = new Set(revealTickers);
  const orderedTickers: string[] = [];
  const seen = new Set<string>();

  for (const ticker of previousTickers) {
    if (seen.has(ticker)) {
      continue;
    }

    if (currentTickers.includes(ticker) || removedSet.has(ticker)) {
      orderedTickers.push(ticker);
      seen.add(ticker);
    }
  }

  for (const ticker of currentTickers) {
    if (!seen.has(ticker)) {
      orderedTickers.push(ticker);
      seen.add(ticker);
    }
  }

  if (!orderedTickers.length) {
    return "No tickers pinned yet";
  }

  return orderedTickers.map((ticker, tickerIndex) => {
    const pieces: ReactNode[] = [];

    if (tickerIndex > 0) {
      pieces.push(
        <span className="profile-pill-separator" key={`${ticker}-separator`}>
          ,{" "}
        </span>
      );
    }

    if (removedSet.has(ticker)) {
      pieces.push(
        <span className="profile-pill-ticker removing" key={ticker}>
          <span className="profile-pill-ticker-text">{ticker}</span>
          <span aria-hidden="true" className="profile-pill-remove">
            ×
          </span>
        </span>
      );

      return <span key={`${ticker}-wrap`}>{pieces}</span>;
    }

    if (revealSet.has(ticker)) {
      const visibleLength = Math.max(0, Math.min(revealProgress[ticker] ?? 0, ticker.length));
      const visibleTicker = ticker.slice(0, visibleLength);
      const isTyping = visibleLength < ticker.length;
      const isComplete = visibleLength === ticker.length;

      pieces.push(
        <span className="profile-pill-ticker animated" key={ticker}>
          <span className="profile-pill-ticker-text">{visibleTicker}</span>
          {isTyping ? <span aria-hidden="true" className="profile-pill-caret" /> : null}
          {isComplete ? (
            <span aria-hidden="true" className="profile-pill-done">
              ✓
            </span>
          ) : null}
        </span>
      );

      return <span key={`${ticker}-wrap`}>{pieces}</span>;
    }

    pieces.push(
      <span className="profile-pill-ticker" key={ticker}>
        {ticker}
      </span>
    );

    return <span key={`${ticker}-wrap`}>{pieces}</span>;
  });
}

function titleizePhrase(value: string | null | undefined) {
  if (!value) {
    return null;
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

function formatProfileFieldString(key: ProfileFieldKey, value: string | null | undefined) {
  if (!value) {
    return "";
  }

  if (key === "focus_tickers") {
    return value
      .split(",")
      .map((segment) => segment.trim().toUpperCase())
      .filter(Boolean)
      .join(", ");
  }

  if (key === "trading_rules") {
    return value
      .split(/\s*\|\s*|\n+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(" · ");
  }

  return titleizePhrase(value) ?? value;
}

function renderProfileFieldValue(
  key: ProfileFieldKey,
  currentValue: string | null | undefined,
  previousProfile: TradingProfile,
  revealFields: ProfileFieldKey[],
  revealFieldProgress: Record<string, number>,
  removedFields: ProfileFieldKey[],
  revealTickers: string[],
  revealProgress: Record<string, number>,
  removedTickers: string[],
  previousTickers: string[]
) {
  if (key === "focus_tickers") {
    return renderFocusTickerValue(
      currentValue ?? null,
      revealTickers,
      revealProgress,
      removedTickers,
      previousTickers
    );
  }

  const formattedValue = formatProfileFieldString(key, currentValue);
  const formattedPreviousValue = formatProfileFieldString(key, previousProfile[key]);
  const isRemoved = removedFields.includes(key);
  const isRevealing = revealFields.includes(key) && Boolean(formattedValue);

  if (isRemoved && formattedPreviousValue) {
    return (
      <span className="profile-pill-change removing">
        <span className="profile-pill-change-text">{formattedPreviousValue}</span>
        <span aria-hidden="true" className="profile-pill-change-remove">
          ×
        </span>
      </span>
    );
  }

  if (isRevealing && formattedValue) {
    const visibleLength = Math.max(
      0,
      Math.min(revealFieldProgress[key] ?? 0, formattedValue.length)
    );
    const visibleValue = formattedValue.slice(0, visibleLength);
    const isTyping = visibleLength < formattedValue.length;
    const isComplete = visibleLength === formattedValue.length;

    return (
      <span className="profile-pill-change animated">
        <span className="profile-pill-change-text">{visibleValue}</span>
        {isTyping ? <span aria-hidden="true" className="profile-pill-change-caret" /> : null}
        {isComplete ? (
          <span aria-hidden="true" className="profile-pill-change-done">
            ✓
          </span>
        ) : null}
      </span>
    );
  }

  return formattedValue;
}

function getRiskProfileCopy(profile: TradingProfile) {
  if (!profile.risk_tolerance) {
    return "No risk preference is saved yet. Tell trAIder how conservative, balanced, or aggressive you want to be and it will remember it.";
  }

  if (profile.trading_goal) {
    return "Saved in profile memory alongside your trading goal. Add hard guardrails next so the desk can turn this into a rulebook.";
  }

  return "Saved in profile memory. Add max risk per trade, daily loss limits, and non-negotiables to make this operational.";
}

export function ChatWorkspace({
  deskTitle,
  initialConversationSummaries,
  initialConversationId,
  initialDraftMessage,
  initialIntro,
  initialIntroTimestamp,
  initialMessages,
  onStartNewChat,
  initialProfile,
  initialShowHero = false,
  userName
}: ChatWorkspaceProps) {
  const safeInitialDisplayName = formatDisplayNameCandidate(userName) ?? "Trader";
  const router = useRouter();
  const [isRouting, startRouting] = useTransition();
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [displayName, setDisplayName] = useState(safeInitialDisplayName);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [conversationSummaries, setConversationSummaries] =
    useState<ConversationSummary[]>(initialConversationSummaries);
  const [messages, setMessages] = useState<WorkspaceMessage[]>(
    initialMessages.length
      ? initialMessages
      : [
          {
            createdAt: initialIntroTimestamp,
            role: "assistant",
            content: initialIntro
          }
        ]
  );
  const [profile, setProfile] = useState<TradingProfile>(initialProfile);
  const [activeInsight, setActiveInsight] = useState<InsightTab | null>(null);
  const [isMemoryUpdated, setIsMemoryUpdated] = useState(false);
  const [isSignalUpdated, setIsSignalUpdated] = useState(false);
  const [tradeCalendarNotice, setTradeCalendarNotice] = useState<TradeCalendarNotice | null>(null);
  const [memoryPreviousProfile, setMemoryPreviousProfile] = useState<TradingProfile>(initialProfile);
  const [memoryPreviousTickers, setMemoryPreviousTickers] = useState<string[]>([]);
  const [memoryRevealTickers, setMemoryRevealTickers] = useState<string[]>([]);
  const [memoryRevealProgress, setMemoryRevealProgress] = useState<Record<string, number>>({});
  const [memoryRemovedTickers, setMemoryRemovedTickers] = useState<string[]>([]);
  const [memoryRevealFields, setMemoryRevealFields] = useState<ProfileFieldKey[]>([]);
  const [memoryRevealFieldProgress, setMemoryRevealFieldProgress] = useState<Record<string, number>>(
    {}
  );
  const [memoryRemovedFields, setMemoryRemovedFields] = useState<ProfileFieldKey[]>([]);
  const [message, setMessage] = useState(initialDraftMessage ?? "");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [revealingReply, setRevealingReply] = useState<RevealingReply | null>(null);
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null);
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(null);
  const [editingMessageCreatedAt, setEditingMessageCreatedAt] = useState<string | null>(null);
  const [editingMessageDraft, setEditingMessageDraft] = useState("");
  const [isPromptRailVisible, setIsPromptRailVisible] = useState(false);
  const [promptWindowIndex, setPromptWindowIndex] = useState(0);
  const [stageTime, setStageTime] = useState("Live session");
  const [isHeroCollapsed, setIsHeroCollapsed] = useState(!initialShowHero);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>(["Reading your prompt"]);
  const [thinkingStepIndex, setThinkingStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const memoryGlowTimeoutRef = useRef<number | null>(null);
  const memoryAutoCloseTimeoutRef = useRef<number | null>(null);
  const memoryRevealTimeoutRef = useRef<number | null>(null);
  const memoryRevealIntervalRef = useRef<number | null>(null);
  const memoryRevealStartTimeoutRef = useRef<number | null>(null);
  const signalGlowTimeoutRef = useRef<number | null>(null);
  const signalAutoCloseTimeoutRef = useRef<number | null>(null);
  const copiedMessageTimeoutRef = useRef<number | null>(null);
  const thinkingStepIntervalRef = useRef<number | null>(null);
  const scrollingStageTimeoutRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const feedScrollTopRef = useRef(0);
  const isResponding = isSending || Boolean(revealingReply);
  const learnedSignals = Object.values(profile).filter(Boolean).length;
  const totalProfileSignals = Object.keys(profile).length;
  const activeConversation =
    conversationSummaries.find((conversation) => conversation.id === conversationId) ?? null;
  const strategyFocus = titleizePhrase(profile.strategy_style) ?? "Strategies still being mapped";
  const assetFocus = titleizePhrase(profile.preferred_assets) ?? "No market bias saved yet";
  const riskFocus = titleizePhrase(profile.risk_tolerance) ?? "Risk profile not mapped yet";
  const riskProfileCopy = getRiskProfileCopy(profile);
  const focusTickers = titleizePhrase(profile.focus_tickers) ?? "No tickers pinned yet";
  const tradingGoal = titleizePhrase(profile.trading_goal) ?? "Refining your edge turn by turn";
  const memoryTone =
    learnedSignals > 0
      ? `${learnedSignals} saved profile signals are flowing into each new reply.`
      : "trAIder will build this context quietly as you talk through markets, style, and risk.";
  const avatarInitial = displayName.trim().charAt(0).toUpperCase() || "T";
  const quickActions: PromptAction[] =
    learnedSignals > 0
      ? [
          {
            label: "Draft my rulebook",
            prompt:
              "Build me a simple trading rulebook from what you know so far. Keep it practical and ask only the highest-value follow-up if needed."
          },
          {
            label: "Review my last trade",
            prompt:
              "Help me review my last trade like a pro coach. Ask only for the missing details you truly need, then turn it into a structured review."
          },
          {
            label: "Start my playbook",
            prompt:
              "Start a trading playbook draft from my profile and recent desk context. Organize it into markets, setups, risk rules, and execution notes."
          },
          {
            label: "Build my daily brief",
            prompt:
              "Create a premium daily brief workflow for my focus tickers and style. Keep it fast, practical, and reusable."
          },
          {
            label: "Find my biggest leak",
            prompt:
              "Based on what you know about me so far, tell me the one execution habit most likely hurting me and how to tighten it up."
          },
          {
            label: "Stress test my risk",
            prompt:
              "Stress test my current risk approach. Show me where it could break down and what cleaner guardrails would look like."
          },
          {
            label: "Build a premarket routine",
            prompt:
              "Build me a premium premarket routine for my style and focus tickers. Keep it sharp, repeatable, and fast."
          },
          {
            label: "Sharpen my entries",
            prompt:
              "Help me sharpen my entries. Build a cleaner entry checklist based on the way I trade."
          },
          {
            label: "Create a debrief flow",
            prompt:
              "Create a fast end-of-day trade debrief flow for me that turns my chats into better analysis over time."
          },
          {
            label: "Build my size guide",
            prompt:
              "Build a practical position-sizing guide for me based on my current risk profile and trading style."
          },
          {
            label: "Compare my tickers",
            prompt:
              "Compare my main tickers through the lens of how I trade and tell me which ones best fit my process."
          }
        ]
      : [
          {
            label: "Map my desk",
            prompt:
              "Map my trading desk with the fewest questions possible. Figure out my tickers, preferred assets, style, risk tolerance, and trading goal."
          },
          {
            label: "Pin my markets",
            prompt:
              "Help me pin the right focus tickers and markets for this desk. Keep it short and ask only what matters."
          },
          {
            label: "Set my risk rules",
            prompt:
              "Help me define a clean starter risk framework for this desk: max risk per trade, daily loss limit, and non-negotiables."
          },
          {
            label: "Review a trade",
            prompt:
              "Walk me through a trade review in the most efficient way possible and turn it into structured analysis as we go."
          },
          {
            label: "Learn my style",
            prompt:
              "Figure out my trading style with the fewest possible high-value questions. Keep it fast and conversational."
          },
          {
            label: "Build my routine",
            prompt:
              "Help me build a simple daily trading routine that fits the way I want to work."
          },
          {
            label: "Set non-negotiables",
            prompt:
              "Help me define the non-negotiable rules I should not break as a trader."
          },
          {
            label: "Create my board",
            prompt:
              "Help me create a cleaner focus board of markets and tickers for this desk."
          },
          {
            label: "Start my playbook",
            prompt:
              "Start a simple trading playbook for me with setups, risk rules, and execution notes."
          },
          {
            label: "Build a premarket plan",
            prompt:
              "Create a practical premarket planning flow for me that keeps my desk clean and focused."
          },
          {
            label: "Coach my process",
            prompt:
              "Coach my trading process like a premium mentor and tell me the first thing this desk should learn about me."
          }
        ];
  const visiblePromptActions = getRotatingPromptWindow(quickActions, promptWindowIndex);

  function setPromptRailVisibility(nextVisible: boolean) {
    setIsPromptRailVisible((current) => (current === nextVisible ? current : nextVisible));
  }

  function upsertConversationSummary(summary: ConversationSummary) {
    setConversationSummaries((current) => {
      const next = current.filter((entry) => entry.id !== summary.id);
      return [summary, ...next].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      );
    });
  }

  function openConversation(targetConversationId: string) {
    setIsDrawerOpen(false);
    startRouting(() => {
      router.push(`/workspace?chat=${encodeURIComponent(targetConversationId)}`);
    });
  }

  function startNewChat() {
    setIsDrawerOpen(false);
    if (onStartNewChat) {
      onStartNewChat();
      return;
    }

    startRouting(() => {
      router.push("/workspace?new=1");
    });
  }

  function replaceConversationUrlSilently(nextConversationId: string) {
    if (typeof window === "undefined") {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = "/workspace";
    nextUrl.searchParams.set("chat", nextConversationId);
    nextUrl.searchParams.delete("new");
    nextUrl.searchParams.delete("signedIn");
    nextUrl.searchParams.delete("starter");
    nextUrl.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", `${nextUrl.pathname}${nextUrl.search}`);
  }

  async function submitMessage(overrideMessage?: string, options?: SubmitMessageOptions) {
    const trimmedMessage = (overrideMessage ?? message).trim();
    const submittedAttachment = attachment;
    if (!trimmedMessage && !submittedAttachment) {
      return;
    }

    const optimisticCreatedAt = new Date().toISOString();
    const optimisticContent = trimmedMessage || `Uploaded ${submittedAttachment?.name}`;
    const optimisticAttachmentDataUrl =
      submittedAttachment && submittedAttachment.type.startsWith("image/")
        ? URL.createObjectURL(submittedAttachment)
        : null;
    const baseMessages = options?.replaceMessages ?? null;
    const controller = new AbortController();
    const assistantStartedAt = new Date().toISOString();
    let streamedAssistantText = "";
    abortControllerRef.current = controller;
    setMessages((current) => {
      const next = baseMessages
        ? [...baseMessages]
        : current.map((entry) =>
            entry.role === "assistant" && entry.quickActions?.length
              ? {
                  ...entry,
                  quickActions: []
                }
              : entry
          );
      next.push({
        attachmentDataUrl: optimisticAttachmentDataUrl,
        attachmentName: submittedAttachment?.name ?? null,
        attachmentType: submittedAttachment?.type ?? null,
        createdAt: optimisticCreatedAt,
        role: "user",
        content: optimisticContent
      });
      return next;
    });
    setError(null);
    setThinkingStepIndex(0);
    setThinkingSteps(
      buildThinkingSteps({
        message: trimmedMessage || "Please review my upload.",
        hasAttachment: Boolean(submittedAttachment),
        profile
      })
    );
    setIsSending(true);
    setRevealingReply(null);
    setMessage("");
    setAttachment(null);

    const formData = new FormData();
    formData.append("message", trimmedMessage || "Please review my upload.");
    if (options?.branchConversationId && options?.editFromMessageCreatedAt) {
      formData.append("branchConversationId", options.branchConversationId);
      formData.append("editFromMessageCreatedAt", options.editFromMessageCreatedAt);
    } else if (conversationId && !options?.forceNewConversation) {
      formData.append("conversationId", conversationId);
    } else {
      formData.append("forceNewConversation", "1");
    }
    if (submittedAttachment) {
      formData.append("attachment", submittedAttachment);
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        body: formData,
        signal: controller.signal
      });

      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Unable to send your message.");
      }

      if (!response.body) {
        throw new Error("The assistant response stream was unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bufferedText = "";
      let doneEvent: ChatStreamDoneEvent | null = null;

      function processStreamEvent(event: ChatStreamEvent) {
        if (event.type === "delta") {
          streamedAssistantText += event.content;
          setRevealingReply((current) =>
            current
              ? {
                  ...current,
                  visibleContent: current.visibleContent + event.content
                }
              : {
                  createdAt: assistantStartedAt,
                  visibleContent: event.content
                }
          );
          return;
        }

        if (event.type === "done") {
          doneEvent = event;
          return;
        }

        throw new Error(event.message || "Unable to complete the assistant reply.");
      }

      while (true) {
        const { done, value } = await reader.read();
        bufferedText += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        const lines = bufferedText.split("\n");
        bufferedText = lines.pop() ?? "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) {
            continue;
          }

          processStreamEvent(JSON.parse(trimmedLine) as ChatStreamEvent);
        }

        if (done) {
          break;
        }
      }

      if (bufferedText.trim()) {
        processStreamEvent(JSON.parse(bufferedText.trim()) as ChatStreamEvent);
      }

      if (!doneEvent) {
        throw new Error("The assistant stream ended before completion.");
      }

      const data = doneEvent as ChatStreamDoneEvent;

      const didProfileChange = profileSignature(profile) !== profileSignature(data.profile);
      const addedFocusTickers = getAddedFocusTickers(profile, data.profile);
      const removedFocusTickers = getRemovedFocusTickers(profile, data.profile);
      const addedOrUpdatedProfileFields = getAddedOrUpdatedProfileFields(profile, data.profile);
      const removedProfileFields = getRemovedProfileFields(profile, data.profile);
      const revealFieldTargets = Object.fromEntries(
        addedOrUpdatedProfileFields.map((field) => [
          field,
          formatProfileFieldString(field, data.profile[field]).length
        ])
      ) as Record<string, number>;
      const tickerRevealMaxLength = addedFocusTickers.reduce(
        (max, ticker) => Math.max(max, ticker.length),
        0
      );
      const fieldRevealMaxLength = Object.values(revealFieldTargets).reduce(
        (max, length) => Math.max(max, length),
        0
      );
      const revealDelayMs = addedFocusTickers.length || addedOrUpdatedProfileFields.length ? 420 : 0;
      const revealStepMs = 170;
      const revealMaxLength = Math.max(tickerRevealMaxLength, fieldRevealMaxLength);
      const animationWindowMs =
        Math.max(3000, revealDelayMs + revealMaxLength * revealStepMs + 1600);
      const shouldPreferTradeCalendarNotice = Boolean(data.tradeCalendarNotice);
      setConversationId(data.conversationId);
      setDisplayName(formatDisplayNameCandidate(data.userName) ?? "Trader");
      setProfile(data.profile);
      if (data.tradeCalendarNotice) {
        setTradeCalendarNotice(data.tradeCalendarNotice);
        setIsSignalUpdated(true);
        setActiveInsight("signal");
        if (signalGlowTimeoutRef.current) {
          window.clearTimeout(signalGlowTimeoutRef.current);
        }
        if (signalAutoCloseTimeoutRef.current) {
          window.clearTimeout(signalAutoCloseTimeoutRef.current);
        }
        signalGlowTimeoutRef.current = window.setTimeout(() => {
          setIsSignalUpdated(false);
        }, 1800);
        signalAutoCloseTimeoutRef.current = window.setTimeout(() => {
          setActiveInsight((current) => (current === "signal" ? null : current));
        }, 4400);
      }
      window.dispatchEvent(
        new CustomEvent("trader:profile:update", {
          detail: {
            focusTickers: parseFocusTickerList(data.profile.focus_tickers)
          }
        })
      );
      if (didProfileChange) {
        setIsMemoryUpdated(true);
        setActiveInsight(shouldPreferTradeCalendarNotice ? "signal" : "memory");
        setMemoryPreviousProfile(profile);
        setMemoryPreviousTickers(parseFocusTickerList(profile.focus_tickers));
        setMemoryRevealTickers(addedFocusTickers);
        setMemoryRevealProgress(
          Object.fromEntries(addedFocusTickers.map((ticker) => [ticker, 0]))
        );
        setMemoryRemovedTickers(removedFocusTickers);
        setMemoryRevealFields(addedOrUpdatedProfileFields);
        setMemoryRevealFieldProgress(
          Object.fromEntries(addedOrUpdatedProfileFields.map((field) => [field, 0]))
        );
        setMemoryRemovedFields(removedProfileFields);
        if (memoryGlowTimeoutRef.current) {
          window.clearTimeout(memoryGlowTimeoutRef.current);
        }
        if (memoryAutoCloseTimeoutRef.current) {
          window.clearTimeout(memoryAutoCloseTimeoutRef.current);
        }
        if (memoryRevealTimeoutRef.current) {
          window.clearTimeout(memoryRevealTimeoutRef.current);
        }
        if (memoryRevealIntervalRef.current) {
          window.clearInterval(memoryRevealIntervalRef.current);
        }
        if (memoryRevealStartTimeoutRef.current) {
          window.clearTimeout(memoryRevealStartTimeoutRef.current);
        }
        if (addedFocusTickers.length || addedOrUpdatedProfileFields.length) {
          memoryRevealStartTimeoutRef.current = window.setTimeout(() => {
            memoryRevealIntervalRef.current = window.setInterval(() => {
              let shouldStopTickerInterval = false;
              setMemoryRevealProgress((current) => {
                const next = { ...current };
                let allComplete = true;

                for (const ticker of addedFocusTickers) {
                  const nextLength = Math.min((next[ticker] ?? 0) + 1, ticker.length);
                  next[ticker] = nextLength;
                  if (nextLength < ticker.length) {
                    allComplete = false;
                  }
                }

                shouldStopTickerInterval = allComplete;
                return next;
              });
              setMemoryRevealFieldProgress((current) => {
                const next = { ...current };
                let allComplete = true;

                for (const field of addedOrUpdatedProfileFields) {
                  const targetLength = revealFieldTargets[field] ?? 0;
                  const nextLength = Math.min((next[field] ?? 0) + 1, targetLength);
                  next[field] = nextLength;
                  if (nextLength < targetLength) {
                    allComplete = false;
                  }
                }

                if (shouldStopTickerInterval && allComplete && memoryRevealIntervalRef.current) {
                  window.clearInterval(memoryRevealIntervalRef.current);
                  memoryRevealIntervalRef.current = null;
                }

                return next;
              });
            }, revealStepMs);
          }, revealDelayMs);
        }
        memoryGlowTimeoutRef.current = window.setTimeout(() => {
          setIsMemoryUpdated(false);
        }, 1800);
        memoryRevealTimeoutRef.current = window.setTimeout(() => {
          setMemoryPreviousProfile(data.profile);
          setMemoryPreviousTickers([]);
          setMemoryRevealTickers([]);
          setMemoryRevealProgress({});
          setMemoryRemovedTickers([]);
          setMemoryRevealFields([]);
          setMemoryRevealFieldProgress({});
          setMemoryRemovedFields([]);
        }, animationWindowMs);
        memoryAutoCloseTimeoutRef.current = window.setTimeout(() => {
          setActiveInsight((current) => (current === "memory" ? null : current));
        }, animationWindowMs);
      }
      setMessages((current) => {
        const next = baseMessages ? [...baseMessages] : [...current];
        const optimisticIndex = next.findIndex(
          (entry) => entry.role === "user" && entry.createdAt === optimisticCreatedAt
        );

        if (optimisticIndex >= 0) {
          next[optimisticIndex] = {
            ...next[optimisticIndex],
            attachmentDataUrl:
              data.userAttachmentDataUrl ?? next[optimisticIndex].attachmentDataUrl ?? null,
            attachmentName: data.userAttachmentName ?? next[optimisticIndex].attachmentName ?? null,
            attachmentType: data.userAttachmentType ?? next[optimisticIndex].attachmentType ?? null,
            createdAt: data.userMessageCreatedAt
          };
        } else {
          next.push({
            attachmentDataUrl: data.userAttachmentDataUrl,
            attachmentName: data.userAttachmentName,
            attachmentType: data.userAttachmentType,
            createdAt: data.userMessageCreatedAt,
            role: "user",
            content: optimisticContent
          });
        }
        next.push({
          createdAt: data.assistantMessageCreatedAt,
          role: "assistant",
          content: data.assistantMessage,
          quickActions: data.quickActions
        });
        return next;
      });
      if (optimisticAttachmentDataUrl) {
        URL.revokeObjectURL(optimisticAttachmentDataUrl);
      }
      setRevealingReply(null);
      upsertConversationSummary({
        id: data.conversationId,
        preview: data.assistantMessage.replace(/\s+/g, " ").trim().slice(0, 72),
        title: data.conversationTitle?.trim() || "New chat",
        updatedAt: data.assistantMessageCreatedAt
      });
      window.dispatchEvent(
        new CustomEvent("trader:workspace:sync", {
          detail: {
            conversationId: data.conversationId,
            conversationSummary: {
              id: data.conversationId,
              preview: data.assistantMessage.replace(/\s+/g, " ").trim().slice(0, 72),
              title: data.conversationTitle?.trim() || "New chat",
              updatedAt: data.assistantMessageCreatedAt
            },
            profile: data.profile,
            tradeCalendarEntry: data.tradeCalendarEntry,
            userName: data.userName
          }
        })
      );
      if (data.notifications.length) {
        window.dispatchEvent(
          new CustomEvent("trader:notifications:add", {
            detail: {
              notifications: data.notifications
            }
          })
        );
      }
      replaceConversationUrlSilently(data.conversationId);
    } catch (caughtError) {
      if (
        controller.signal.aborted ||
        (caughtError instanceof DOMException && caughtError.name === "AbortError")
      ) {
        return;
      }

      if (options?.restoreMessagesOnError) {
        setMessages(options.restoreMessagesOnError);
      } else {
        setMessages((current) => {
          if (!streamedAssistantText.trim()) {
            return current;
          }

          return [
            ...current,
            {
              createdAt: assistantStartedAt,
              role: "assistant",
              content: streamedAssistantText.trimEnd()
            }
          ];
        });
      }
      if (optimisticAttachmentDataUrl) {
        URL.revokeObjectURL(optimisticAttachmentDataUrl);
      }
      setRevealingReply(null);
      setMessage(trimmedMessage);
      setAttachment(submittedAttachment);
      setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsSending(false);
    }
  }

  function stopAssistantResponse() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (revealingReply?.visibleContent.trim()) {
      setMessages((current) => [
        ...current,
        {
          createdAt: revealingReply.createdAt,
          role: "assistant",
          content: revealingReply.visibleContent.trimEnd()
        }
      ]);
    }

    setRevealingReply(null);
    setIsSending(false);
    setThinkingStepIndex(0);
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitMessage();
  }

  async function copyMessageContent(content: string, messageKey: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageKey(messageKey);
      if (copiedMessageTimeoutRef.current) {
        window.clearTimeout(copiedMessageTimeoutRef.current);
      }
      copiedMessageTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageKey((current) => (current === messageKey ? null : current));
      }, 1800);
    } catch {
      setError("Could not copy that message right now.");
    }
  }

  function beginMessageEdit(content: string, messageKey: string) {
    setEditingMessageKey(messageKey);
    const targetMessage = messages.find(
      (entry, index) => getMessageActionKey(entry, index) === messageKey
    );
    setEditingMessageCreatedAt(targetMessage?.createdAt ?? null);
    setEditingMessageDraft(content);
    setError(null);
  }

  function cancelMessageEdit() {
    setEditingMessageKey(null);
    setEditingMessageCreatedAt(null);
    setEditingMessageDraft("");
  }

  async function sendEditedMessage() {
    const trimmedDraft = editingMessageDraft.trim();
    if (!trimmedDraft || isResponding || !editingMessageKey || !editingMessageCreatedAt) {
      return;
    }

    const editingIndex = messages.findIndex(
      (entry, index) => getMessageActionKey(entry, index) === editingMessageKey
    );
    const branchBaseMessages = editingIndex >= 0 ? messages.slice(0, editingIndex) : [];
    const branchConversationId = conversationId;

    setEditingMessageKey(null);
    setEditingMessageCreatedAt(null);
    setEditingMessageDraft("");
    await submitMessage(trimmedDraft, {
      branchConversationId,
      editFromMessageCreatedAt: editingMessageCreatedAt,
      replaceMessages: branchBaseMessages,
      restoreMessagesOnError: messages
    });
  }

  async function handlePromptAction(prompt: string) {
    if (isResponding) {
      return;
    }

    if (message.trim() || attachment) {
      setMessage(prompt);
      return;
    }

    setMessage(prompt);
    await submitMessage(prompt);
  }

  function dismissMessageQuickActions(messageKey: string) {
    setMessages((current) =>
      current.map((entry, index) =>
        getMessageActionKey(entry, index) === messageKey
          ? {
              ...entry,
              quickActions: []
            }
          : entry
      )
    );
  }

  async function handleMessageQuickAction(
    action: WorkspaceQuickAction,
    messageKey: string
  ) {
    if (isResponding) {
      return;
    }

    dismissMessageQuickActions(messageKey);

    if (action.kind === "prefill") {
      setMessage(action.prompt);
      composerTextareaRef.current?.focus();
      return;
    }

    if (message.trim() || attachment) {
      setMessage(action.prompt);
      composerTextareaRef.current?.focus();
      return;
    }

    await submitMessage(action.prompt);
  }

  async function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    if (!isResponding) {
      await submitMessage();
    }
  }

  useEffect(() => {
    setStageTime(
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short"
      }).format(new Date())
    );
  }, []);

  useEffect(() => {
    setDisplayName(formatDisplayNameCandidate(userName) ?? "Trader");
  }, [userName]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, isResponding, revealingReply?.visibleContent]);

  useEffect(() => {
    if (!isHeroCollapsed) {
      setPromptRailVisibility(false);
      return;
    }

    const feedElement = messagesRef.current;
    if (!feedElement) {
      return;
    }

    feedScrollTopRef.current = feedElement.scrollTop;

    function handleFeedScroll(event: Event) {
      const feedNode = event.currentTarget as HTMLDivElement;
      const nextScrollTop = feedNode.scrollTop;
      const maxScrollTop = Math.max(0, feedNode.scrollHeight - feedNode.clientHeight);
      const distanceFromBottom = Math.max(0, maxScrollTop - nextScrollTop);
      const delta = nextScrollTop - feedScrollTopRef.current;
      const stageNode = stageRef.current;

      if (stageNode) {
        stageNode.classList.add("is-scrolling");
        if (scrollingStageTimeoutRef.current) {
          window.clearTimeout(scrollingStageTimeoutRef.current);
        }
        scrollingStageTimeoutRef.current = window.setTimeout(() => {
          stageNode.classList.remove("is-scrolling");
          scrollingStageTimeoutRef.current = null;
        }, 140);
      }

      if (nextScrollTop <= 24) {
        setPromptRailVisibility(true);
        feedScrollTopRef.current = nextScrollTop;
        return;
      }

      if (distanceFromBottom <= 40) {
        setPromptRailVisibility(false);
        feedScrollTopRef.current = nextScrollTop;
        return;
      }

      if (Math.abs(delta) < 12) {
        feedScrollTopRef.current = nextScrollTop;
        return;
      }

      if (delta > 0) {
        setPromptRailVisibility(false);
      } else {
        setPromptRailVisibility(true);
      }

      feedScrollTopRef.current = nextScrollTop;
    }

    feedElement.addEventListener("scroll", handleFeedScroll, { passive: true });
    return () => {
      feedElement.removeEventListener("scroll", handleFeedScroll);
      if (scrollingStageTimeoutRef.current) {
        window.clearTimeout(scrollingStageTimeoutRef.current);
        scrollingStageTimeoutRef.current = null;
      }
      stageRef.current?.classList.remove("is-scrolling");
    };
  }, [isHeroCollapsed]);

  useEffect(() => {
    setPromptWindowIndex(0);
  }, [learnedSignals]);

  useEffect(() => {
    if (!isPromptRailVisible || quickActions.length <= 4) {
      return;
    }

    const rotateInterval = window.setInterval(() => {
      setPromptWindowIndex((current) => (current + 1) % quickActions.length);
    }, 4800);

    return () => window.clearInterval(rotateInterval);
  }, [isPromptRailVisible, quickActions.length]);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDrawerOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isDrawerOpen]);

  useEffect(() => {
    if (!isSending) {
      if (thinkingStepIntervalRef.current) {
        window.clearInterval(thinkingStepIntervalRef.current);
        thinkingStepIntervalRef.current = null;
      }
      setThinkingStepIndex(0);
      return;
    }

    if (thinkingSteps.length <= 1) {
      return;
    }

    thinkingStepIntervalRef.current = window.setInterval(() => {
      setThinkingStepIndex((current) => (current + 1) % thinkingSteps.length);
    }, 1600);

    return () => {
      if (thinkingStepIntervalRef.current) {
        window.clearInterval(thinkingStepIntervalRef.current);
        thinkingStepIntervalRef.current = null;
      }
    };
  }, [isSending, thinkingSteps]);

  useEffect(() => {
    return () => {
      if (copiedMessageTimeoutRef.current) {
        window.clearTimeout(copiedMessageTimeoutRef.current);
      }
      if (memoryGlowTimeoutRef.current) {
        window.clearTimeout(memoryGlowTimeoutRef.current);
      }
      if (memoryAutoCloseTimeoutRef.current) {
        window.clearTimeout(memoryAutoCloseTimeoutRef.current);
      }
      if (memoryRevealTimeoutRef.current) {
        window.clearTimeout(memoryRevealTimeoutRef.current);
      }
      if (memoryRevealIntervalRef.current) {
        window.clearInterval(memoryRevealIntervalRef.current);
      }
      if (memoryRevealStartTimeoutRef.current) {
        window.clearTimeout(memoryRevealStartTimeoutRef.current);
      }
      if (signalGlowTimeoutRef.current) {
        window.clearTimeout(signalGlowTimeoutRef.current);
      }
      if (signalAutoCloseTimeoutRef.current) {
        window.clearTimeout(signalAutoCloseTimeoutRef.current);
      }
      if (thinkingStepIntervalRef.current) {
        window.clearInterval(thinkingStepIntervalRef.current);
      }
      if (scrollingStageTimeoutRef.current) {
        window.clearTimeout(scrollingStageTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (!editingMessageKey || !editingTextareaRef.current) {
      return;
    }

    editingTextareaRef.current.focus();
    editingTextareaRef.current.setSelectionRange(
      editingTextareaRef.current.value.length,
      editingTextareaRef.current.value.length
    );
  }, [editingMessageKey]);

  useEffect(() => {
    const trigger = document.querySelector<HTMLButtonElement>(".workspace-brand-button");
    if (!trigger) {
      return;
    }

    function handleToggle() {
      setIsDrawerOpen((current) => !current);
    }

    trigger.addEventListener("click", handleToggle);
    return () => trigger.removeEventListener("click", handleToggle);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function clearSignedInSearchParams() {
      const nextUrl = new URL(window.location.href);
      if (!nextUrl.searchParams.has("signedIn") && !nextUrl.searchParams.has("new")) {
        return;
      }

      nextUrl.searchParams.delete("signedIn");
      nextUrl.searchParams.delete("new");
      window.history.replaceState(window.history.state, "", `${nextUrl.pathname}${nextUrl.search}`);
    }

    if (!initialShowHero) {
      setIsHeroCollapsed(true);
      setIsPromptRailVisible(true);
      clearSignedInSearchParams();
      return;
    }

    setIsHeroCollapsed(false);
    setIsPromptRailVisible(false);

    const collapseDelay = window.setTimeout(() => {
      setIsHeroCollapsed(true);
      setIsPromptRailVisible(true);
      clearSignedInSearchParams();
    }, 6000);

    return () => window.clearTimeout(collapseDelay);
  }, [initialShowHero]);

  useEffect(() => {
    if (!initialDraftMessage) {
      return;
    }

    setMessage(initialDraftMessage);
  }, [initialDraftMessage]);

  return (
    <div className={`oracle-desk ${isDrawerOpen ? "sidebar-open" : ""}`}>
      <button
        aria-hidden={!isDrawerOpen}
        aria-label="Close thread rail"
        className={`oracle-sidebar-backdrop ${isDrawerOpen ? "visible" : ""}`}
        onClick={() => setIsDrawerOpen(false)}
        tabIndex={isDrawerOpen ? 0 : -1}
        type="button"
      />

      <aside className={`oracle-thread-rail ${isDrawerOpen ? "open" : ""}`} id="thread-drawer">
        <div className="oracle-thread-rail-header">
          <div className="oracle-rail-status-card">
            <div className="oracle-rail-status-icon" aria-hidden="true">
              ⌂
            </div>
            <div>
              <p className="oracle-rail-status-title">Intelligence pulse</p>
              <p className="oracle-rail-status-copy">
                <span className="oracle-rail-status-dot" aria-hidden="true" />
                Active coaching
              </p>
            </div>
          </div>
        </div>

        <div className="oracle-thread-rail-section">
          <div>
            <h3 className="oracle-rail-title">Coaching threads</h3>
            <p className="oracle-rail-subtitle">Recent insights</p>
          </div>
          <button className="oracle-new-analysis" onClick={startNewChat} type="button">
            New chat
          </button>
        </div>

        <div className="oracle-thread-list">
          {conversationSummaries.map((conversation) => (
            <button
              className={`oracle-thread-card ${
                conversation.id === conversationId ? "active" : ""
              }`}
              disabled={isRouting}
              key={conversation.id}
              onClick={() => openConversation(conversation.id)}
              type="button"
            >
              <div className="oracle-thread-card-top">
                <span className="oracle-thread-card-title">{conversation.title}</span>
                <span className="oracle-thread-card-date">
                  {formatConversationTime(conversation.updatedAt)}
                </span>
              </div>
              <p className="oracle-thread-card-preview">
                {conversation.preview ?? "Open this conversation"}
              </p>
            </button>
          ))}
          {!conversationSummaries.length ? (
            <p className="oracle-thread-empty">
              Your saved chats will appear here after the first exchange.
            </p>
          ) : null}
        </div>
      </aside>

      <section
        className={`oracle-main-stage ${isHeroCollapsed ? "hero-collapsed" : "hero-active"}`}
        ref={stageRef}
      >
        <div className={`oracle-stage-intro ${isHeroCollapsed ? "collapsed" : ""}`}>
          <span className="oracle-stage-time">{stageTime}</span>
          <h1 className="oracle-stage-title">Your desk is open.</h1>
          <p className="oracle-stage-copy">
            Chat naturally. trAIder will map your tickers, style, risk, and analysis structure in
            the background so the desk gets sharper without turning into homework.
          </p>
        </div>

        {isHeroCollapsed && visiblePromptActions.length ? (
          <div
            aria-hidden={!isPromptRailVisible}
            className={`oracle-prompt-row ${isPromptRailVisible ? "visible" : "hidden"}`}
            aria-label="Premium desk actions"
          >
            {visiblePromptActions.map((action, actionIndex) => (
              <button
                className="oracle-prompt-chip"
                key={`${action.label}-${promptWindowIndex}-${actionIndex}`}
                onClick={() => void handlePromptAction(action.prompt)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        <div
          className={`oracle-feed ${isHeroCollapsed ? "hero-collapsed" : "hero-active"} ${
            isPromptRailVisible ? "prompt-rail-visible" : "prompt-rail-hidden"
          }`}
          aria-live="polite"
          ref={messagesRef}
        >
          {messages.map((entry, index) => (
            <article
              className={`oracle-entry oracle-entry-${entry.role}`}
              key={getMessageActionKey(entry, index)}
            >
              {(() => {
                const messageKey = getMessageActionKey(entry, index);
                const isEditingMessage = editingMessageKey === messageKey;

                return (
                  <>
              <div className={`oracle-entry-avatar oracle-entry-avatar-${entry.role}`}>
                {entry.role === "user" ? avatarInitial : "AI"}
              </div>
              <div className="oracle-entry-shell">
                <div className="oracle-entry-meta">
                  <span className="oracle-entry-label">
                    {entry.role === "user" ? "You" : "trAIder"}
                  </span>
                  <span className="oracle-entry-time">{formatMessageTime(entry.createdAt)}</span>
                </div>
                <div
                  className={`oracle-entry-bubble oracle-entry-bubble-${entry.role} ${
                    isEditingMessage ? "editing" : ""
                  }`}
                >
                  {isEditingMessage ? (
                    <div className="oracle-entry-editor-shell">
                      <textarea
                        className="oracle-entry-editor"
                        onChange={(event) => setEditingMessageDraft(event.target.value)}
                        ref={editingTextareaRef}
                        rows={Math.max(3, Math.min(8, editingMessageDraft.split("\n").length + 1))}
                        value={editingMessageDraft}
                      />
                      <div className="oracle-entry-editor-actions">
                        <span className="oracle-entry-editor-label">Revise and resend</span>
                        <div className="oracle-entry-editor-buttons">
                          <button
                            className="oracle-entry-editor-button ghost"
                            onClick={cancelMessageEdit}
                            type="button"
                          >
                            Cancel
                          </button>
                          <button
                            className="oracle-entry-editor-button primary"
                            disabled={!editingMessageDraft.trim() || isResponding}
                            onClick={() => void sendEditedMessage()}
                            type="button"
                          >
                            {isResponding ? "Sending..." : "Send revision"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <MessageAttachment
                        attachmentDataUrl={entry.attachmentDataUrl}
                        attachmentName={entry.attachmentName}
                        attachmentType={entry.attachmentType}
                      />
                      <MessageContent
                        content={entry.content}
                        renderMarkdown={entry.role === "assistant"}
                      />
                    </>
                  )}
                </div>
                {!isEditingMessage ? (
                  <>
                    {entry.role === "assistant" && entry.quickActions?.length ? (
                      <div className="oracle-inline-actions" role="group" aria-label="Suggested next steps">
                        {entry.quickActions.map((action) => (
                          <button
                            className={`oracle-inline-action oracle-inline-action-${action.kind}`}
                            key={`${messageKey}-${action.label}`}
                            onClick={() => void handleMessageQuickAction(action, messageKey)}
                            type="button"
                          >
                            <QuickActionGlyph kind={action.kind} />
                            <span>{action.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className={`oracle-bubble-actions oracle-bubble-actions-${entry.role}`}>
                      <button
                        aria-label={
                          copiedMessageKey === messageKey ? "Message copied" : "Copy message"
                        }
                        className={`oracle-bubble-action ${
                          copiedMessageKey === messageKey ? "copied" : ""
                        }`}
                        onClick={() => void copyMessageContent(entry.content, messageKey)}
                        title={copiedMessageKey === messageKey ? "Copied" : "Copy"}
                        type="button"
                      >
                        <CopyIcon copied={copiedMessageKey === messageKey} />
                      </button>
                      {entry.role === "user" ? (
                        <button
                          aria-label="Edit and resend message"
                          className="oracle-bubble-action"
                          onClick={() => beginMessageEdit(entry.content, messageKey)}
                          title="Edit and resend"
                          type="button"
                        >
                          <EditIcon />
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
                  </>
                );
              })()}
            </article>
          ))}

          {isSending && !revealingReply ? (
            <article className="oracle-entry oracle-entry-assistant" key="assistant-thinking">
              <div className="oracle-entry-avatar oracle-entry-avatar-assistant">AI</div>
              <div className="oracle-entry-shell">
                <div className="oracle-entry-meta">
                  <span className="oracle-entry-label">trAIder</span>
                </div>
                <div className="oracle-entry-bubble oracle-entry-bubble-assistant oracle-entry-bubble-pending">
                  <div className="thinking-indicator" aria-label="trAIder is thinking">
                    <div className="thinking-copy">
                      <div className="thinking-line">
                        <span className="thinking-text">Thinking</span>
                        <span className="thinking-dots" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                      </div>
                      <p className="thinking-status" key={thinkingSteps[thinkingStepIndex]}>
                        {thinkingSteps[thinkingStepIndex] ?? "Shaping the response"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          ) : null}

          {revealingReply ? (
            <article className="oracle-entry oracle-entry-assistant" key="assistant-revealing">
              <div className="oracle-entry-avatar oracle-entry-avatar-assistant">AI</div>
              <div className="oracle-entry-shell">
                <div className="oracle-entry-meta">
                  <span className="oracle-entry-label">trAIder</span>
                  <span className="oracle-entry-time">
                    {formatMessageTime(revealingReply.createdAt)}
                  </span>
                </div>
                <div className="oracle-entry-bubble oracle-entry-bubble-assistant oracle-entry-bubble-revealing">
                  <MessageContent content={revealingReply.visibleContent} renderMarkdown />
                </div>
              </div>
            </article>
          ) : null}
        </div>

        <form className="oracle-composer" onSubmit={sendMessage}>
          <label className="oracle-upload-button" title={attachment?.name ?? "Add screenshot"}>
            <span>{attachment ? "✓" : "+"}</span>
            <input
              accept="image/*,.pdf,.txt"
              name="attachment"
              onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>

          <div className="oracle-composer-main">
            <textarea
              ref={composerTextareaRef}
              name="message"
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={`Ask trAIder about any symbol or strategy, ${displayName}.`}
              rows={3}
              value={message}
            />
            <button
              className={`oracle-send-button ${isResponding ? "stopping" : ""}`}
              onClick={isResponding ? stopAssistantResponse : undefined}
              type={isResponding ? "button" : "submit"}
            >
              {isResponding ? <StopIcon /> : "↑"}
            </button>
          </div>
        </form>

        <div className="oracle-composer-meta">
          <span>Enter to send</span>
          <span>Shift + Enter for a new line</span>
        </div>

        {error ? <p className="error-banner oracle-error-banner">{error}</p> : null}
      </section>

      <aside className={`oracle-context-rail ${activeInsight ? "open" : ""}`}>
        <div className="oracle-insight-icons" role="tablist" aria-label="Desk insights">
          {INSIGHT_TABS.map((tab) => (
            <button
              aria-label={tab.label}
              className={`oracle-insight-icon ${
                activeInsight === tab.id ? "active" : ""
              } ${
                (tab.id === "memory" && isMemoryUpdated) ||
                (tab.id === "signal" && isSignalUpdated)
                  ? "updated"
                  : ""
              }`}
              key={tab.id}
              onClick={() =>
                setActiveInsight((current) => (current === tab.id ? null : tab.id))
              }
              title={tab.label}
              type="button"
            >
              <InsightGlyph id={tab.id} />
              {tab.id === "memory" ? (
                <span className={`memory-check oracle-dock-check ${isMemoryUpdated ? "visible" : ""}`}>
                  ✓
                </span>
              ) : null}
              {tab.id === "signal" ? (
                <span className={`memory-check oracle-dock-check ${isSignalUpdated ? "visible" : ""}`}>
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className={`oracle-insight-panel ${activeInsight ? "open" : ""}`}>
          {activeInsight === "memory" ? (
            <section
              className={`oracle-context-card oracle-memory-card ${
                isMemoryUpdated ? "memory-updated" : ""
              }`}
            >
              <div className="oracle-context-card-top">
                <div>
                  <p className="chat-kicker">Profile context</p>
                  <h3>Profile memory</h3>
                </div>
                <span className="status-badge">
                  <span className="status-dot" />
                  Active
                </span>
              </div>

              <div className="memory-body open">
                <div className="profile-pills">
                  {PROFILE_FIELD_ORDER.filter(
                    (key) => Boolean(profile[key]) || memoryRemovedFields.includes(key)
                  ).map((key) => (
                      <span className="profile-pill" key={key}>
                        <span className="profile-pill-key">
                          {PROFILE_FIELD_DISPLAY_LABELS[key]}:
                        </span>{" "}
                        <span className="profile-pill-value">
                          {renderProfileFieldValue(
                            key,
                            profile[key],
                            memoryPreviousProfile,
                            memoryRevealFields,
                            memoryRevealFieldProgress,
                            memoryRemovedFields,
                            memoryRevealTickers,
                            memoryRevealProgress,
                            memoryRemovedTickers,
                            memoryPreviousTickers
                          )}
                        </span>
                      </span>
                    ))}
                </div>

                <p className="memory-copy">{memoryTone}</p>
                <div className="memory-meter">
                  <span className="memory-meter-label">
                    {learnedSignals}/{totalProfileSignals} profile signals saved
                  </span>
                  <div className="memory-meter-track" aria-hidden="true">
                    <span
                      className="memory-meter-fill"
                      style={{ width: `${(learnedSignals / totalProfileSignals) * 100}%` }}
                    />
                  </div>
                </div>
                {!learnedSignals ? (
                  <p className="memory-empty">
                    Start talking about your experience, markets, style, risk, or goals and
                    trAIder will build the profile quietly as you go.
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeInsight === "strategy" ? (
            <section className="oracle-context-card">
              <p className="oracle-context-label">Strategy focus</p>
              <h4 className="oracle-context-value">{strategyFocus}</h4>
              <p className="oracle-context-copy">{assetFocus}</p>
            </section>
          ) : null}

          {activeInsight === "risk" ? (
            <section className="oracle-context-card">
              <p className="oracle-context-label">Risk profile</p>
              <h4 className="oracle-context-value">{riskFocus}</h4>
              <p className="oracle-context-copy">{riskProfileCopy}</p>
            </section>
          ) : null}

          {activeInsight === "signal" ? (
            <section className="oracle-signal-card">
              <p className="oracle-context-label">
                {tradeCalendarNotice ? "P&L calendar" : "Desk signal"}
              </p>
              <h4 className="oracle-signal-title">
                {tradeCalendarNotice ? tradeCalendarNotice.title : focusTickers}
              </h4>
              <p className="oracle-context-copy">
                {tradeCalendarNotice ? tradeCalendarNotice.detail : tradingGoal}
              </p>
              {tradeCalendarNotice?.notes ? (
                <p className="oracle-context-copy oracle-signal-notes">{tradeCalendarNotice.notes}</p>
              ) : null}
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
