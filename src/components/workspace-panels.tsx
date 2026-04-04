"use client";

import { useEffect, useMemo, useState } from "react";
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

type PnlGranularity = "daily" | "monthly" | "yearly";

type PnlBucket = {
  key: string;
  label: string;
  pnlAmount: number;
  sortValue: number;
  tradeCount: number;
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

function formatTradeMonth(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "2-digit"
  }).format(value);
}

function formatCompactPnlAmount(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const formatted =
    absolute >= 1000
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: 1,
          minimumFractionDigits: 0
        }).format(absolute)
      : absolute.toFixed(0);

  return `${sign}$${formatted}`;
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

function buildTradeEntryLabel(entry: TradeCalendarEntry) {
  return entry.tickers.length === 1 ? entry.tickers[0] : entry.tickers.join(", ");
}

function buildTradeDayBreakdown(entries: TradeCalendarEntry[]) {
  const grouped = new Map<
    string,
    { label: string; notes: string[]; pnlAmount: number; tradeCount: number }
  >();

  for (const entry of entries) {
    const label = buildTradeEntryLabel(entry);
    const bucket = grouped.get(label) ?? {
      label,
      notes: [],
      pnlAmount: 0,
      tradeCount: 0
    };

    bucket.pnlAmount += entry.pnlAmount;
    bucket.tradeCount += 1;
    if (entry.notes) {
      bucket.notes.push(entry.notes);
    }

    grouped.set(label, bucket);
  }

  return [...grouped.values()].sort((left, right) => {
    if (right.pnlAmount !== left.pnlAmount) {
      return right.pnlAmount - left.pnlAmount;
    }

    return left.label.localeCompare(right.label);
  });
}

function buildPnlBuckets(entries: TradeCalendarEntry[], granularity: PnlGranularity) {
  const grouped = new Map<string, PnlBucket>();

  for (const entry of entries) {
    const parsed = new Date(`${entry.tradedOn}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }

    let key = entry.tradedOn;
    let label = formatTradeDay(entry.tradedOn);
    let sortValue = parsed.getTime();

    if (granularity === "monthly") {
      key = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
      label = formatTradeMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
      sortValue = new Date(parsed.getFullYear(), parsed.getMonth(), 1).getTime();
    } else if (granularity === "yearly") {
      key = String(parsed.getFullYear());
      label = key;
      sortValue = new Date(parsed.getFullYear(), 0, 1).getTime();
    }

    const bucket = grouped.get(key) ?? {
      key,
      label,
      pnlAmount: 0,
      sortValue,
      tradeCount: 0
    };

    bucket.pnlAmount += entry.pnlAmount;
    bucket.tradeCount += 1;
    grouped.set(key, bucket);
  }

  const limit = granularity === "daily" ? 21 : granularity === "monthly" ? 12 : 6;

  return [...grouped.values()]
    .sort((left, right) => left.sortValue - right.sortValue)
    .slice(-limit);
}

function buildPnlPerformanceStats(
  entries: TradeCalendarEntry[],
  buckets: PnlBucket[],
  granularity: PnlGranularity
) {
  const totalRealized = entries.reduce((sum, entry) => sum + entry.pnlAmount, 0);
  const average = buckets.length
    ? buckets.reduce((sum, bucket) => sum + bucket.pnlAmount, 0) / buckets.length
    : 0;
  const bestBucket = buckets.reduce<PnlBucket | null>(
    (best, bucket) => (!best || bucket.pnlAmount > best.pnlAmount ? bucket : best),
    null
  );
  const worstBucket = buckets.reduce<PnlBucket | null>(
    (worst, bucket) => (!worst || bucket.pnlAmount < worst.pnlAmount ? bucket : worst),
    null
  );
  const periodLabel =
    granularity === "daily" ? "day" : granularity === "monthly" ? "month" : "year";

  return [
    {
      label: "Realized net",
      tone: totalRealized > 0 ? "positive" : totalRealized < 0 ? "negative" : "neutral",
      value: formatTradePnlAmount(totalRealized)
    },
    {
      label: `Avg ${periodLabel}`,
      tone: average > 0 ? "positive" : average < 0 ? "negative" : "neutral",
      value: buckets.length ? formatTradePnlAmount(average) : "Waiting"
    },
    {
      label: `Best ${periodLabel}`,
      tone:
        (bestBucket?.pnlAmount ?? 0) > 0
          ? "positive"
          : (bestBucket?.pnlAmount ?? 0) < 0
            ? "negative"
            : "neutral",
      value: bestBucket ? `${bestBucket.label} · ${formatTradePnlAmount(bestBucket.pnlAmount)}` : "Waiting"
    },
    {
      label: `Worst ${periodLabel}`,
      tone:
        (worstBucket?.pnlAmount ?? 0) > 0
          ? "positive"
          : (worstBucket?.pnlAmount ?? 0) < 0
            ? "negative"
            : "neutral",
      value: worstBucket
        ? `${worstBucket.label} · ${formatTradePnlAmount(worstBucket.pnlAmount)}`
        : "Waiting"
    }
  ];
}

function PnlPerformanceChart({
  buckets,
  granularity
}: {
  buckets: PnlBucket[];
  granularity: PnlGranularity;
}) {
  const width = 960;
  const height = 260;
  const padding = {
    bottom: 34,
    left: 56,
    right: 16,
    top: 20
  };

  if (!buckets.length) {
    return (
      <div className="workspace-analysis-chart-empty">
        <p>No logged trades yet.</p>
        <span>
          Once trades are saved from chat, {granularity} P&amp;L will chart itself here.
        </span>
      </div>
    );
  }

  const values = buckets.map((bucket) => bucket.pnlAmount);
  const maxValue = Math.max(...values, 0);
  const minValue = Math.min(...values, 0);
  const range = maxValue - minValue || 1;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const slotWidth = plotWidth / buckets.length;
  const barWidth = Math.min(44, Math.max(18, slotWidth * 0.56));
  const baselineY = padding.top + ((maxValue - 0) / range) * plotHeight;
  const tickValues = [maxValue, (maxValue + minValue) / 2, minValue];

  const yForValue = (value: number) => padding.top + ((maxValue - value) / range) * plotHeight;

  return (
    <div className="workspace-analysis-chart-shell">
      <svg
        aria-label={`${granularity} profit and loss chart`}
        className="workspace-analysis-chart"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id="workspace-analysis-chart-positive" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(64, 202, 121, 0.98)" />
            <stop offset="100%" stopColor="rgba(15, 159, 85, 0.9)" />
          </linearGradient>
          <linearGradient id="workspace-analysis-chart-negative" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255, 128, 141, 0.98)" />
            <stop offset="100%" stopColor="rgba(209, 67, 67, 0.9)" />
          </linearGradient>
        </defs>
        {tickValues.map((tick, index) => {
          const y = yForValue(tick);
          return (
            <g key={`${tick}-${index}`}>
              <line
                className="workspace-analysis-chart-gridline"
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
              <text className="workspace-analysis-chart-axis-label" x={12} y={y + 4}>
                {formatCompactPnlAmount(tick)}
              </text>
            </g>
          );
        })}

        <line
          className="workspace-analysis-chart-baseline"
          x1={padding.left}
          x2={width - padding.right}
          y1={baselineY}
          y2={baselineY}
        />

        {buckets.map((bucket, index) => {
          const x = padding.left + slotWidth * index + (slotWidth - barWidth) / 2;
          const valueY = yForValue(bucket.pnlAmount);
          const barY = bucket.pnlAmount >= 0 ? valueY : baselineY;
          const barHeight = Math.max(Math.abs(valueY - baselineY), 3);
          const labelX = padding.left + slotWidth * index + slotWidth / 2;

          return (
            <g key={bucket.key}>
              <title>{`${bucket.label}: ${formatTradePnlAmount(bucket.pnlAmount)} across ${bucket.tradeCount} trade${bucket.tradeCount === 1 ? "" : "s"}`}</title>
              <rect
                className={`workspace-analysis-chart-bar ${
                  bucket.pnlAmount >= 0 ? "positive" : "negative"
                }`}
                height={barHeight}
                rx={barWidth / 3}
                ry={barWidth / 3}
                width={barWidth}
                x={x}
                y={barY}
              />
              <text className="workspace-analysis-chart-column-label" x={labelX} y={height - 10}>
                {bucket.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
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
        profile.trading_rules
          ? "Rule memory live"
          : profile.risk_tolerance || profile.trading_goal
            ? "Primed"
            : "Waiting on boundaries",
      copy:
        "The first premium unlock is a real rulebook: max risk, daily drawdown, and non-negotiables that the desk can remember now and enforce later."
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
  const selectableCalendarKeys = useMemo(
    () => monthCalendar.cells.filter((cell) => cell.entries.length).map((cell) => cell.key),
    [monthCalendar.cells]
  );
  const latestCalendarKey = selectableCalendarKeys.at(-1) ?? null;
  const [selectedCalendarKey, setSelectedCalendarKey] = useState<string | null>(latestCalendarKey);
  const [pnlGranularity, setPnlGranularity] = useState<PnlGranularity>("daily");
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
  const selectedCalendarCell =
    monthCalendar.cells.find((cell) => cell.key === selectedCalendarKey && cell.entries.length) ?? null;
  const selectedDayBreakdown = selectedCalendarCell
    ? buildTradeDayBreakdown(selectedCalendarCell.entries)
    : [];
  const selectedDayLabel = selectedCalendarCell ? formatTradeDay(selectedCalendarCell.key) : null;
  const pnlBuckets = useMemo(
    () => buildPnlBuckets(tradeCalendarEntries, pnlGranularity),
    [pnlGranularity, tradeCalendarEntries]
  );
  const pnlPerformanceStats = useMemo(
    () => buildPnlPerformanceStats(tradeCalendarEntries, pnlBuckets, pnlGranularity),
    [pnlBuckets, pnlGranularity, tradeCalendarEntries]
  );

  useEffect(() => {
    if (!selectableCalendarKeys.length) {
      setSelectedCalendarKey(null);
      return;
    }

    setSelectedCalendarKey((current) =>
      current && selectableCalendarKeys.includes(current) ? current : latestCalendarKey
    );
  }, [latestCalendarKey, selectableCalendarKeys]);

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
        <article className="workspace-analysis-card workspace-analysis-card-wide workspace-analysis-performance-card">
          <div className="workspace-analysis-card-top workspace-analysis-performance-top">
            <div>
              <p className="workspace-analysis-card-label">P&amp;L performance</p>
              <h3 className="workspace-analysis-calendar-title">How the desk is performing over time</h3>
            </div>
            <div className="workspace-analysis-toggle" role="tablist" aria-label="P&L aggregation">
              {([
                ["daily", "Daily"],
                ["monthly", "Monthly"],
                ["yearly", "Yearly"]
              ] as const).map(([value, label]) => (
                <button
                  aria-selected={pnlGranularity === value}
                  className={`workspace-analysis-toggle-button ${
                    pnlGranularity === value ? "active" : ""
                  }`}
                  key={value}
                  onClick={() => setPnlGranularity(value)}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="workspace-analysis-card-copy">
            Switch between daily, monthly, and yearly rollups to see whether your desk is building
            consistency or just catching random green days.
          </p>
          <div className="workspace-analysis-performance-stats">
            {pnlPerformanceStats.map((stat) => (
              <div className="workspace-analysis-performance-stat" key={stat.label}>
                <span className="workspace-analysis-card-label">{stat.label}</span>
                <strong className={`workspace-analysis-performance-stat-value ${stat.tone ?? "neutral"}`}>
                  {stat.value}
                </strong>
              </div>
            ))}
          </div>
          <PnlPerformanceChart buckets={pnlBuckets} granularity={pnlGranularity} />
        </article>

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
              <button
                className={`workspace-analysis-calendar-cell ${
                  cell.entries.length ? "has-entry" : ""
                } ${cell.total > 0 ? "positive" : cell.total < 0 ? "negative" : ""} ${
                  selectedCalendarKey === cell.key ? "selected" : ""
                } ${cell.entries.length ? "interactive" : "empty"}`}
                disabled={!cell.entries.length}
                key={cell.key}
                onClick={() => {
                  if (cell.entries.length) {
                    setSelectedCalendarKey(cell.key);
                  }
                }}
                type="button"
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
              </button>
            ))}
          </div>
          {selectedCalendarCell ? (
            <div className="workspace-analysis-calendar-detail">
              <div className="workspace-analysis-calendar-detail-top">
                <div>
                  <p className="workspace-analysis-card-label">Selected day</p>
                  <h4 className="workspace-analysis-calendar-detail-title">{selectedDayLabel}</h4>
                </div>
                <span className="workspace-analysis-card-status">
                  {formatTradePnlAmount(selectedCalendarCell.total)}
                </span>
              </div>
              <div className="workspace-analysis-calendar-detail-list">
                {selectedDayBreakdown.map((entry) => (
                  <div className="workspace-analysis-calendar-detail-row" key={entry.label}>
                    <div>
                      <strong>{entry.label}</strong>
                      <p>
                        {entry.tradeCount === 1
                          ? "1 logged trade"
                          : `${entry.tradeCount} logged trades`}
                      </p>
                      {entry.notes[0] ? (
                        <span className="workspace-analysis-calendar-detail-note">
                          {entry.notes[0]}
                        </span>
                      ) : null}
                    </div>
                    <strong className={entry.pnlAmount >= 0 ? "positive" : "negative"}>
                      {formatTradePnlAmount(entry.pnlAmount)}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
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
