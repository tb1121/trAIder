export type MarketQuote = {
  symbol: string;
  name: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  isTracked: boolean;
  source: "popular" | "tracked";
};

export type MarketSnapshot = {
  available: boolean;
  lastUpdated: string;
  popular: MarketQuote[];
  provider: string;
  tracked: MarketQuote[];
  unavailableReason: string | null;
};

const TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/;

export function parseTickerList(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  const unique = new Set<string>();
  for (const segment of value.split(/[,\s/]+/)) {
    const ticker = segment.replace(/^\$+/, "").trim().toUpperCase();
    if (!ticker || !TICKER_PATTERN.test(ticker)) {
      continue;
    }
    unique.add(ticker);
  }

  return Array.from(unique);
}

export function normalizeMarketNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isNegativeByParens = trimmed.startsWith("(") && trimmed.endsWith(")");
  const cleaned = trimmed.replace(/[%,$()]/g, "").replace(/,/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return isNegativeByParens ? -parsed : parsed;
}
