import Link from "next/link";
import type { TradingProfile, WorkspaceMessage } from "@/lib/coach";
import type { ConversationSummary } from "@/lib/data";
import { formatTradePnlAmount, type TradeCalendarEntry } from "@/lib/trade-calendar";

type WorkspaceHistoryPanelProps = {
  activeConversationId: string | null;
  conversations: ConversationSummary[];
};

type WorkspaceAnalysisPanelProps = {
  activeConversationId: string | null;
  conversations: ConversationSummary[];
  messages: WorkspaceMessage[];
  profile: TradingProfile;
  tradeCalendarEntries: TradeCalendarEntry[];
  userName: string;
};

type AnalysisModule = {
  copy: string;
  label: string;
  status: string;
};

function buildWorkspaceHref(
  view: "desk" | "history" | "analysis",
  options?: {
    chat?: string | null;
    starter?: string | null;
  }
) {
  const search = new URLSearchParams();
  if (view !== "desk") {
    search.set("view", view);
  }
  if (options?.chat) {
    search.set("chat", options.chat);
  }
  if (options?.starter) {
    search.set("starter", options.starter);
  }

  const query = search.toString();
  return query ? `/workspace?${query}` : "/workspace";
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

function formatTradeDay(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(parsed);
}

function buildCalendarDateKey(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildMonthCalendar(entries: TradeCalendarEntry[]) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const firstDayOffset = monthStart.getDay();
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric"
  }).format(monthStart);
  const byDate = new Map<string, TradeCalendarEntry[]>();

  for (const entry of entries) {
    const parsed = new Date(`${entry.tradedOn}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }

    if (
      parsed.getFullYear() !== monthStart.getFullYear() ||
      parsed.getMonth() !== monthStart.getMonth()
    ) {
      continue;
    }

    const bucket = byDate.get(entry.tradedOn) ?? [];
    bucket.push(entry);
    byDate.set(entry.tradedOn, bucket);
  }

  const cells = Array.from({ length: firstDayOffset }, (_, index) => ({
    entries: [] as TradeCalendarEntry[],
    key: `empty-${index}`,
    label: null as number | null,
    total: 0
  }));

  for (let day = 1; day <= monthEnd.getDate(); day += 1) {
    const key = buildCalendarDateKey(monthStart.getFullYear(), monthStart.getMonth(), day);
    const dayEntries = byDate.get(key) ?? [];
    const total = dayEntries.reduce((sum, entry) => sum + entry.pnlAmount, 0);

    cells.push({
      entries: dayEntries,
      key,
      label: day,
      total
    });
  }

  return {
    cells,
    monthLabel
  };
}

function buildAnalysisModules(profile: TradingProfile, userMessageCount: number): AnalysisModule[] {
  return [
    {
      label: "Profile model",
      status:
        Object.values(profile).filter(Boolean).length >= 3 ? "Mapped" : "Quietly building",
      copy:
        "trAIder is already shaping your desk around markets, style, risk, and goals without forcing a setup wizard."
    },
    {
      label: "Rulebook engine",
      status:
        profile.risk_tolerance || profile.trading_goal ? "Primed" : "Waiting on boundaries",
      copy:
        "The first premium unlock is a real rulebook: max risk, daily drawdown, and non-negotiables that can be enforced later."
    },
    {
      label: "Playbook patterns",
      status: userMessageCount >= 4 ? "Warming up" : "Needs a few more reps",
      copy:
        "Patterns start to become useful once the desk sees repeated trade reviews, setups, and process language from you."
    }
  ];
}

export function WorkspaceHistoryPanel({
  activeConversationId,
  conversations
}: WorkspaceHistoryPanelProps) {
  const latestConversation = conversations[0] ?? null;

  return (
    <section className="workspace-section-panel workspace-history-panel">
      <div className="workspace-section-hero">
        <p className="workspace-section-kicker">History</p>
        <h1 className="workspace-section-title">Your coaching archive.</h1>
        <p className="workspace-section-copy">
          Every desk thread becomes part of the review loop. Come back to a trade idea, reopen an
          older coaching session, or pull a past insight back into the desk.
        </p>
      </div>

      <div className="workspace-section-metrics">
        <article className="workspace-section-metric">
          <span className="workspace-section-metric-label">Saved threads</span>
          <strong className="workspace-section-metric-value">{conversations.length}</strong>
        </article>
        <article className="workspace-section-metric">
          <span className="workspace-section-metric-label">Latest thread</span>
          <strong className="workspace-section-metric-value">
            {latestConversation ? formatConversationTime(latestConversation.updatedAt) : "None yet"}
          </strong>
        </article>
      </div>

      {conversations.length ? (
        <div className="workspace-history-grid">
          {conversations.map((conversation) => (
            <Link
              className={`workspace-history-card ${
                conversation.id === activeConversationId ? "active" : ""
              }`}
              href={buildWorkspaceHref("desk", { chat: conversation.id })}
              key={conversation.id}
            >
              <div className="workspace-history-card-top">
                <span className="workspace-history-card-title">{conversation.title}</span>
                <span className="workspace-history-card-date">
                  {formatConversationTime(conversation.updatedAt)}
                </span>
              </div>
              <p className="workspace-history-card-preview">
                {conversation.preview ?? "Open this conversation back in the desk."}
              </p>
              <span className="workspace-history-card-cta">Open in desk</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="workspace-section-empty">
          <p>No saved coaching threads yet.</p>
          <Link className="workspace-section-link" href="/workspace?new=1">
            Start your first desk session
          </Link>
        </div>
      )}
    </section>
  );
}

export function WorkspaceAnalysisPanel({
  activeConversationId,
  conversations,
  messages,
  profile,
  tradeCalendarEntries,
  userName
}: WorkspaceAnalysisPanelProps) {
  const learnedSignals = Object.values(profile).filter(Boolean).length;
  const totalSignals = Object.keys(profile).length;
  const userMessageCount = messages.filter((message) => message.role === "user").length;
  const modules = buildAnalysisModules(profile, userMessageCount);
  const focusTickers = titleizePhrase(profile.focus_tickers) ?? "No focus board built yet";
  const strategyFocus = titleizePhrase(profile.strategy_style) ?? "Style still being mapped";
  const riskFocus = titleizePhrase(profile.risk_tolerance) ?? "Risk profile still forming";
  const nextChatTarget = activeConversationId ?? conversations[0]?.id ?? null;
  const monthCalendar = buildMonthCalendar(tradeCalendarEntries);
  const monthTradeCount = monthCalendar.cells.reduce(
    (count, cell) => count + cell.entries.length,
    0
  );
  const monthPnlTotal = tradeCalendarEntries
    .filter((entry) => {
      const parsed = new Date(`${entry.tradedOn}T00:00:00`);
      const now = new Date();
      return (
        parsed.getFullYear() === now.getFullYear() && parsed.getMonth() === now.getMonth()
      );
    })
    .reduce((sum, entry) => sum + entry.pnlAmount, 0);
  const recentTradeEntries = tradeCalendarEntries.slice(0, 5);

  return (
    <section className="workspace-section-panel workspace-analysis-panel">
      <div className="workspace-section-hero">
        <div className="workspace-analysis-hero-copy">
          <p className="workspace-section-kicker">Analysis</p>
          <h1 className="workspace-section-title">Analysis that builds itself from the desk.</h1>
          <p className="workspace-section-copy">
            {userName}, you should not need to fill out a giant journal before trAIder becomes
            useful. The desk is designed to pull structure out of your chats, then turn it into a
            sharper review loop over time.
          </p>
        </div>
        <article className="workspace-analysis-score-card">
          <span className="workspace-analysis-score-label">Profile depth</span>
          <strong className="workspace-analysis-score-value">
            {learnedSignals}/{totalSignals}
          </strong>
          <p className="workspace-analysis-score-copy">
            Signals saved across {conversations.length} thread
            {conversations.length === 1 ? "" : "s"}. Real analysis starts once rules, reviews,
            and behavior patterns are grounded.
          </p>
        </article>
      </div>

      <div className="workspace-section-metrics">
        <article className="workspace-section-metric">
          <span className="workspace-section-metric-label">Focus board</span>
          <strong className="workspace-section-metric-value">{focusTickers}</strong>
        </article>
        <article className="workspace-section-metric">
          <span className="workspace-section-metric-label">Style</span>
          <strong className="workspace-section-metric-value">{strategyFocus}</strong>
        </article>
        <article className="workspace-section-metric">
          <span className="workspace-section-metric-label">Risk profile</span>
          <strong className="workspace-section-metric-value">{riskFocus}</strong>
        </article>
        <article className="workspace-section-metric">
          <span className="workspace-section-metric-label">P&amp;L calendar</span>
          <strong className="workspace-section-metric-value">
            {monthTradeCount ? `${monthTradeCount} trades` : "Ready to log"}
          </strong>
        </article>
      </div>

      <div className="workspace-analysis-grid">
        <article className="workspace-analysis-card workspace-analysis-card-wide workspace-analysis-calendar-card">
          <div className="workspace-analysis-card-top">
            <div>
              <p className="workspace-analysis-card-label">P&amp;L calendar</p>
              <h3 className="workspace-analysis-calendar-title">{monthCalendar.monthLabel}</h3>
            </div>
            <span className="workspace-analysis-card-status">
              {monthTradeCount ? formatTradePnlAmount(monthPnlTotal) : "No entries yet"}
            </span>
          </div>
          <p className="workspace-analysis-card-copy">
            Desk trades can be logged straight from chat, then collected here by day so the review
            loop feels native instead of form-driven.
          </p>
          <div className="workspace-analysis-calendar-head" aria-hidden="true">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="workspace-analysis-calendar-grid">
            {monthCalendar.cells.map((cell) => (
              <article
                className={`workspace-analysis-calendar-cell ${
                  cell.entries.length ? "has-entry" : ""
                } ${cell.total > 0 ? "positive" : cell.total < 0 ? "negative" : ""}`}
                key={cell.key}
              >
                {cell.label ? (
                  <>
                    <span className="workspace-analysis-calendar-day">{cell.label}</span>
                    {cell.entries.length ? (
                      <>
                        <strong className="workspace-analysis-calendar-total">
                          {formatTradePnlAmount(cell.total)}
                        </strong>
                        <span className="workspace-analysis-calendar-tickers">
                          {cell.entries
                            .flatMap((entry) => entry.tickers)
                            .filter((ticker, index, list) => list.indexOf(ticker) === index)
                            .slice(0, 3)
                            .join(" · ")}
                        </span>
                      </>
                    ) : null}
                  </>
                ) : null}
              </article>
            ))}
          </div>
        </article>

        <article className="workspace-analysis-card workspace-analysis-card-wide">
          <div className="workspace-analysis-card-top">
            <p className="workspace-analysis-card-label">Recent logged trades</p>
            <span className="workspace-analysis-card-status">
              {recentTradeEntries.length ? "Live from chat" : "Waiting on first entry"}
            </span>
          </div>
          {recentTradeEntries.length ? (
            <div className="workspace-analysis-trade-list">
              {recentTradeEntries.map((entry) => (
                <div className="workspace-analysis-trade-row" key={entry.id}>
                  <div>
                    <strong>{entry.tickers.join(", ")}</strong>
                    <p>{entry.notes ?? "Logged from the desk conversation."}</p>
                  </div>
                  <div className="workspace-analysis-trade-meta">
                    <span>{formatTradeDay(entry.tradedOn)}</span>
                    <strong className={entry.pnlAmount >= 0 ? "positive" : "negative"}>
                      {formatTradePnlAmount(entry.pnlAmount)}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="workspace-analysis-card-copy">
              Mention a trade from today in chat and trAIder can ask whether you want it logged to
              your P&amp;L calendar.
            </p>
          )}
        </article>

        {modules.map((module) => (
          <article className="workspace-analysis-card" key={module.label}>
            <div className="workspace-analysis-card-top">
              <p className="workspace-analysis-card-label">{module.label}</p>
              <span className="workspace-analysis-card-status">{module.status}</span>
            </div>
            <p className="workspace-analysis-card-copy">{module.copy}</p>
          </article>
        ))}

        <article className="workspace-analysis-card workspace-analysis-card-wide">
          <div className="workspace-analysis-card-top">
            <p className="workspace-analysis-card-label">No form-first workflow</p>
            <span className="workspace-analysis-card-status">Premium direction</span>
          </div>
          <p className="workspace-analysis-card-copy">
            The desk should stay chat-first. The premium move is to let the user talk naturally,
            upload a chart when they want, and let trAIder draft the rulebook, trade reviews, and
            playbook structure in the background.
          </p>
          <div className="workspace-analysis-actions">
            <Link
              className="workspace-analysis-action"
              href={buildWorkspaceHref("desk", {
                chat: nextChatTarget,
                starter: "desk-map"
              })}
            >
              Map my desk
            </Link>
            <Link
              className="workspace-analysis-action"
              href={buildWorkspaceHref("desk", {
                chat: nextChatTarget,
                starter: "rulebook"
              })}
            >
              Draft my rulebook
            </Link>
            <Link
              className="workspace-analysis-action"
              href={buildWorkspaceHref("desk", {
                chat: nextChatTarget,
                starter: "trade-review"
              })}
            >
              Review a trade
            </Link>
            <Link
              className="workspace-analysis-action"
              href={buildWorkspaceHref("desk", {
                chat: nextChatTarget,
                starter: "playbook"
              })}
            >
              Start my playbook
            </Link>
          </div>
        </article>
      </div>
    </section>
  );
}
