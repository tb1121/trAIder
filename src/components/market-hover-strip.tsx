"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketQuote, MarketSnapshot } from "@/lib/market";
import { parseTickerList } from "@/lib/market";

type MarketHoverStripProps = {
  userTickers: string[];
  introDelayMs?: number;
};

type SnapshotCachePayload = {
  lastLoadedAt: number;
  snapshot: MarketSnapshot;
};

const SNAPSHOT_CACHE_TTL_MS = 1000 * 60 * 15;
const SNAPSHOT_CACHE_KEY_PREFIX = "workspace-market-snapshot:";

function readSnapshotCache(cacheKey: string): SnapshotCachePayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(`${SNAPSHOT_CACHE_KEY_PREFIX}${cacheKey}`);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as SnapshotCachePayload;
    if (
      !parsed ||
      typeof parsed.lastLoadedAt !== "number" ||
      !parsed.snapshot ||
      typeof parsed.snapshot !== "object"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshotCache(cacheKey: string, payload: SnapshotCachePayload) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      `${SNAPSHOT_CACHE_KEY_PREFIX}${cacheKey}`,
      JSON.stringify(payload)
    );
  } catch {
    // Ignore storage write failures; live state still updates in memory.
  }
}

function formatPrice(value: number | null) {
  if (value === null) {
    return "Waiting";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 2 : 3,
    minimumFractionDigits: value >= 100 ? 2 : 2,
    style: "currency"
  }).format(value);
}

function formatChangePercent(value: number | null) {
  if (value === null) {
    return "Live soon";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}%`;
}

function formatVolume(value: number | null) {
  if (value === null) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatUpdatedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Live";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function QuoteChip({ quote, compact = false }: { quote: MarketQuote; compact?: boolean }) {
  const isPositive = (quote.changePercent ?? 0) >= 0;

  return (
    <article
      className={`market-quote-chip ${compact ? "compact" : ""} ${
        quote.isTracked ? "tracked" : ""
      } ${quote.changePercent === null ? "neutral" : isPositive ? "up" : "down"}`}
    >
      <div className="market-quote-chip-top">
        <span className="market-quote-symbol">{quote.symbol}</span>
        {quote.isTracked ? <span className="market-quote-tag">Yours</span> : null}
      </div>
      <div className="market-quote-chip-price">{formatPrice(quote.price)}</div>
      <div className="market-quote-chip-meta">
        <span>{formatChangePercent(quote.changePercent)}</span>
        {!compact && quote.volume !== null ? <span>Vol {formatVolume(quote.volume)}</span> : null}
      </div>
    </article>
  );
}

export function MarketHoverStrip({
  userTickers,
  introDelayMs = 0
}: MarketHoverStripProps) {
  const [liveUserTickers, setLiveUserTickers] = useState(userTickers);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasDiscoveredHover, setHasDiscoveredHover] = useState(false);
  const [isHintReady, setIsHintReady] = useState(introDelayMs <= 0);
  const closeTimerRef = useRef<number | null>(null);
  const inFlightLoadRef = useRef<Promise<void> | null>(null);
  const lastLoadedAtRef = useRef<number>(0);
  const tickersParam = liveUserTickers.join(",");
  const snapshotCacheKey = tickersParam || "__popular__";
  const popularQuotes = snapshot?.popular ?? [];
  const trackedQuotes = snapshot?.tracked ?? [];
  const isMissingKey = snapshot?.unavailableReason === "missing_api_key";
  const hasProviderError =
    snapshot?.unavailableReason !== null && snapshot?.unavailableReason !== "missing_api_key";
  const isEodSnapshot = snapshot?.provider.includes("EOD") ?? false;
  const statusLabel = snapshot?.available
    ? isEodSnapshot
      ? "Delayed EOD snapshot"
      : `Updated ${formatUpdatedAt(snapshot.lastUpdated)}`
    : isMissingKey
      ? "Market feed needs setup"
      : hasProviderError
        ? "Market feed unavailable"
        : "Live feed idle";

  useEffect(() => {
    setLiveUserTickers(userTickers);
  }, [userTickers]);

  useEffect(() => {
    function handleProfileUpdate(event: Event) {
      const detail = (event as CustomEvent<{ focusTickers?: string[] }>).detail;
      const nextTickers = Array.isArray(detail?.focusTickers)
        ? detail.focusTickers.join(", ")
        : "";
      setLiveUserTickers(parseTickerList(nextTickers));
    }

    window.addEventListener("trader:profile:update", handleProfileUpdate as EventListener);
    return () => {
      window.removeEventListener("trader:profile:update", handleProfileUpdate as EventListener);
    };
  }, []);

  const loadSnapshot = useCallback(
    async (force = false) => {
      const cachedSnapshot = readSnapshotCache(snapshotCacheKey);
      if (cachedSnapshot) {
        setSnapshot(cachedSnapshot.snapshot);
        lastLoadedAtRef.current = cachedSnapshot.lastLoadedAt;
      }

      const ageMs = Date.now() - lastLoadedAtRef.current;
      if (!force && lastLoadedAtRef.current && ageMs < SNAPSHOT_CACHE_TTL_MS) {
        return;
      }

      if (inFlightLoadRef.current) {
        return inFlightLoadRef.current;
      }

      setIsLoading(true);

      const pendingLoad = (async () => {
        try {
          const search = tickersParam ? `?tickers=${encodeURIComponent(tickersParam)}` : "";
          const response = await fetch(`/api/market-snapshot${search}`);
          if (!response.ok) {
            throw new Error("Unable to load market tape.");
          }

          const data = (await response.json()) as MarketSnapshot;
          setSnapshot(data);
          lastLoadedAtRef.current = Date.now();
          writeSnapshotCache(snapshotCacheKey, {
            lastLoadedAt: lastLoadedAtRef.current,
            snapshot: data
          });
        } catch (error) {
          setSnapshot({
            available: false,
            lastUpdated: new Date().toISOString(),
            popular: [],
            provider: "Financial Modeling Prep",
            tracked: [],
            unavailableReason: error instanceof Error ? error.message : "Unable to load quotes."
          });
        } finally {
          inFlightLoadRef.current = null;
          setIsLoading(false);
          setHasLoaded(true);
        }
      })();

      inFlightLoadRef.current = pendingLoad;
      return pendingLoad;
    },
    [snapshotCacheKey, tickersParam]
  );

  useEffect(() => {
    const cachedSnapshot = readSnapshotCache(snapshotCacheKey);
    if (cachedSnapshot) {
      lastLoadedAtRef.current = cachedSnapshot.lastLoadedAt;
      setSnapshot(cachedSnapshot.snapshot);
      setIsLoading(false);
      setHasLoaded(true);
      return;
    }

    lastLoadedAtRef.current = 0;
    setSnapshot(null);
    setIsLoading(true);
    setHasLoaded(false);
  }, [snapshotCacheKey]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (introDelayMs <= 0) {
      setIsHintReady(true);
      return;
    }

    setIsHintReady(false);
    setIsOpen(false);

    const timer = window.setTimeout(() => {
      setIsHintReady(true);
    }, introDelayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [introDelayMs]);

  function openPanel() {
    if (!isHintReady) {
      return;
    }

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!hasDiscoveredHover) {
      setHasDiscoveredHover(true);
    }
    void loadSnapshot();
    setIsOpen(true);
  }

  function keepPanelOpen() {
    if (!isHintReady) {
      return;
    }

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setIsOpen(true);
  }

  function closePanelSoon() {
    if (!isHintReady) {
      return;
    }

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
    }, 110);
  }

  return (
    <div
      className={`workspace-market-strip ${isOpen ? "open" : ""} ${
        isHintReady ? "" : "intro-blocked"
      }`}
    >
      <div
        aria-hidden="true"
        className={`workspace-market-hint ${
          isOpen || hasDiscoveredHover || !isHintReady ? "hidden" : ""
        }`}
      >
        <span className="workspace-market-hint-line" />
        <span className="workspace-market-hint-label">Hover for market pulse</span>
        <span className="workspace-market-hint-line" />
      </div>
      <div
        aria-hidden="true"
        className={`workspace-market-hotspot ${isHintReady ? "" : "disabled"}`}
        onMouseEnter={openPanel}
        onMouseLeave={closePanelSoon}
      />

      <section
        aria-label="Live market tape"
        className="workspace-market-panel"
        onFocusCapture={openPanel}
        onMouseEnter={keepPanelOpen}
        onMouseLeave={closePanelSoon}
      >
        <div className="workspace-market-header">
          <div>
            <p className="workspace-market-kicker">Live market pulse</p>
            <h2>{isEodSnapshot ? "Popular names on deck" : "Popular names moving now"}</h2>
          </div>
          <div className="workspace-market-status">
            <span className={`workspace-market-dot ${snapshot?.available ? "live" : ""}`} />
            <span>{statusLabel}</span>
          </div>
        </div>

        {trackedQuotes.length ? (
          <div className="workspace-market-tracked">
            <div className="workspace-market-section-label">Your tickers</div>
            <div className="workspace-market-tracked-row">
              {trackedQuotes.map((quote) => (
                <QuoteChip key={`tracked-${quote.symbol}`} quote={quote} compact />
              ))}
            </div>
          </div>
        ) : null}

        <div className="workspace-market-marquee-block">
          <div className="workspace-market-section-label">
            {isEodSnapshot ? "Popular watchlist" : "Most active"}
          </div>

          {popularQuotes.length ? (
            <div className="workspace-market-marquee-shell">
              <div className="workspace-market-marquee-track">
                <div className="workspace-market-marquee-segment" aria-hidden="false">
                  {popularQuotes.map((quote) => (
                    <QuoteChip key={`segment-a-${quote.symbol}`} quote={quote} />
                  ))}
                </div>
                <div className="workspace-market-marquee-segment" aria-hidden="true">
                  {popularQuotes.map((quote) => (
                    <QuoteChip key={`segment-b-${quote.symbol}`} quote={quote} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="workspace-market-empty">
              {isLoading && !hasLoaded
                ? "Loading the market tape..."
                : snapshot?.unavailableReason === "missing_api_key"
                  ? "Add FMP_API_KEY to .env.local and restart the dev server to show live prices here."
                  : hasProviderError
                    ? "FMP rejected the real-time request on this plan, so the desk is waiting for a free-compatible snapshot."
                  : "Market data is taking a beat. Hover again in a moment."}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
