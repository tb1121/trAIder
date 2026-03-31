import { NextRequest, NextResponse } from "next/server";
import {
  normalizeMarketNumber,
  parseTickerList,
  type MarketQuote,
  type MarketSnapshot
} from "@/lib/market";

type FmpHistoricalRow = {
  change?: number | string | null;
  changePercent?: number | string | null;
  close?: number | string | null;
  date?: string | null;
  price?: number | string | null;
  symbol?: string | null;
  volume?: number | string | null;
};

type FmpHistoricalResponse = FmpHistoricalRow[] | { historical?: FmpHistoricalRow[] | null };
type SnapshotCacheEntry = {
  expiresAt: number;
  snapshot: MarketSnapshot;
};

const EOD_PROVIDER = "Financial Modeling Prep · EOD";
const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const POPULAR_LIMIT = 10;
const PROVIDER_CACHE_SECONDS = 60 * 60 * 6;
const SNAPSHOT_TTL_MS = 1000 * 60 * 30;
const CURATED_POPULAR_SYMBOLS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "META",
  "GOOGL",
  "TSLA",
  "AMD",
  "QQQ",
  "SPY",
  "PLTR",
  "AVGO",
  "NFLX",
  "MU",
  "COIN",
  "SMCI",
  "TSM"
];
const snapshotCache = new Map<string, SnapshotCacheEntry>();

function buildUnavailableSnapshot(reason: string): MarketSnapshot {
  return {
    available: false,
    lastUpdated: new Date().toISOString(),
    popular: [],
    provider: EOD_PROVIDER,
    tracked: [],
    unavailableReason: reason
  };
}

function placeholderTrackedQuote(symbol: string): MarketQuote {
  return {
    change: null,
    changePercent: null,
    isTracked: true,
    name: null,
    price: null,
    source: "tracked",
    symbol,
    volume: null
  };
}

async function fetchFmp<T>(path: string, searchParams: URLSearchParams) {
  const response = await fetch(`${FMP_BASE_URL}/${path}?${searchParams.toString()}`, {
    headers: {
      accept: "application/json"
    },
    next: {
      revalidate: PROVIDER_CACHE_SECONDS
    }
  });

  if (!response.ok) {
    throw new Error(`Market data request failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

function normalizeHistoricalRows(payload: FmpHistoricalResponse): FmpHistoricalRow[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && Array.isArray(payload.historical)) {
    return payload.historical;
  }

  return [];
}

function buildHistoricalDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 10);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10)
  };
}

async function fetchHistoricalQuote(symbol: string): Promise<MarketQuote | null> {
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const { from, to } = buildHistoricalDateRange();
  const params = new URLSearchParams({
    apikey: apiKey,
    from,
    symbol,
    to
  });

  const payload = await fetchFmp<FmpHistoricalResponse>("historical-price-eod/full", params);
  const row = normalizeHistoricalRows(payload).find((entry) => normalizeMarketNumber(entry.close ?? entry.price) !== null);

  if (!row) {
    return null;
  }

  return {
    change: normalizeMarketNumber(row.change),
    changePercent: normalizeMarketNumber(row.changePercent),
    isTracked: false,
    name: null,
    price: normalizeMarketNumber(row.close ?? row.price),
    source: "tracked",
    symbol,
    volume: normalizeMarketNumber(row.volume)
  };
}

async function buildEodSnapshot(trackedSymbols: string[]): Promise<MarketSnapshot> {
  const uniqueSymbols = Array.from(
    new Set([...trackedSymbols, ...CURATED_POPULAR_SYMBOLS.slice(0, POPULAR_LIMIT)])
  );
  const results = await Promise.allSettled(
    uniqueSymbols.map(async (symbol) => {
      const quote = await fetchHistoricalQuote(symbol);
      return quote ? [symbol, quote] as const : null;
    })
  );

  const quoteMap = new Map<string, MarketQuote>();
  let rejectedCount = 0;
  for (const result of results) {
    if (result.status !== "fulfilled") {
      rejectedCount += 1;
      continue;
    }

    if (!result.value) {
      continue;
    }

    const [symbol, quote] = result.value;
    quoteMap.set(symbol, quote);
  }

  const popular = CURATED_POPULAR_SYMBOLS.slice(0, POPULAR_LIMIT)
    .map((symbol) => quoteMap.get(symbol))
    .filter((quote): quote is MarketQuote => Boolean(quote))
    .map((quote) => ({
      ...quote,
      isTracked: trackedSymbols.includes(quote.symbol),
      source: "popular" as const
    }));

  const tracked = trackedSymbols
    .map((symbol) => {
      const quote = quoteMap.get(symbol) ?? placeholderTrackedQuote(symbol);
      return {
        ...quote,
        isTracked: true,
        source: "tracked" as const
      };
    });

  const hasResolvedTrackedData = tracked.some((quote) => quote.price !== null);
  const hasResolvedPopularData = popular.length > 0;
  const unavailableReason =
    !hasResolvedTrackedData && !hasResolvedPopularData && rejectedCount > 0 ? "provider_error" : null;

  return {
    available: hasResolvedTrackedData || hasResolvedPopularData,
    lastUpdated: new Date().toISOString(),
    popular,
    provider: EOD_PROVIDER,
    tracked,
    unavailableReason
  };
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.FMP_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(buildUnavailableSnapshot("missing_api_key"), {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  }

  const trackedSymbols = parseTickerList(request.nextUrl.searchParams.get("tickers"));
  const cacheKey = trackedSymbols.slice().sort().join(",") || "__popular__";
  const cached = snapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.snapshot, {
      headers: {
        "Cache-Control": "s-maxage=900, stale-while-revalidate=21600"
      }
    });
  }

  try {
    const snapshot = await buildEodSnapshot(trackedSymbols);
    snapshotCache.set(cacheKey, {
      expiresAt: Date.now() + SNAPSHOT_TTL_MS,
      snapshot
    });

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "s-maxage=900, stale-while-revalidate=21600"
      }
    });
  } catch (error) {
    console.error("Failed to load market snapshot", error);

    return NextResponse.json(buildUnavailableSnapshot("provider_error"), {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  }
}
