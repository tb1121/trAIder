const MAX_DISPLAY_NAME_LENGTH = 32;
const DISPLAY_NAME_UPDATE_PATTERNS = [
  /\b(?:call me|please call me|you can call me|just call me|start calling me|refer to me as)\s+([A-Za-z][A-Za-z' -]{0,31})$/i,
  /\b(?:my name is|change my name to|change what you call me to|use the name)\s+([A-Za-z][A-Za-z' -]{0,31})$/i
];

const DISALLOWED_DISPLAY_NAME_PATTERNS = [
  /\bfaggot\b/i,
  /\bnigg(?:er|a)\b/i,
  /\bretard(?:ed)?\b/i,
  /\bcunt\b/i,
  /\bbitch\b/i,
  /\bwhore\b/i,
  /\bslut\b/i,
  /\bdyke\b/i,
  /\bkike\b/i,
  /\bspic\b/i,
  /\bchink\b/i
];

const DISALLOWED_DISPLAY_NAME_TOKENS = new Set([
  "asshole",
  "bastard",
  "bitch",
  "clown",
  "cuck",
  "cunt",
  "dipshit",
  "douche",
  "douchebag",
  "dumbass",
  "dyke",
  "fag",
  "faggot",
  "fuck",
  "fucker",
  "fuckface",
  "fuckboy",
  "garbage",
  "hoe",
  "idiot",
  "incel",
  "jackass",
  "jerkoff",
  "kike",
  "loser",
  "moron",
  "motherfucker",
  "nigga",
  "nigger",
  "prick",
  "puss",
  "pussy",
  "retard",
  "retarded",
  "scumbag",
  "shit",
  "shithead",
  "skank",
  "slut",
  "spic",
  "thot",
  "trash",
  "twat",
  "whore"
]);

const DISALLOWED_DISPLAY_NAME_STEMS = [
  "asshol",
  "bastard",
  "bitch",
  "cunt",
  "dipshit",
  "douch",
  "dumbass",
  "fag",
  "fuck",
  "garbage",
  "idiot",
  "incel",
  "jackass",
  "jerkoff",
  "loser",
  "moron",
  "motherfuck",
  "nigg",
  "prick",
  "puss",
  "retard",
  "scumbag",
  "shit",
  "skank",
  "slut",
  "trash",
  "twat",
  "whore"
];

export type DisplayNameUpdateResult = {
  attempted: boolean;
  nextDisplayName: string | null;
  rejected: boolean;
};

export function normalizeDisplayNameWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function capitalizeDisplayName(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

export function isDisallowedDisplayName(value: string) {
  if (DISALLOWED_DISPLAY_NAME_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }

  const lowered = value.toLowerCase();
  const compact = lowered.replace(/[^a-z]/g, "");
  const tokens = lowered.split(/[\s'-]+/).filter(Boolean);

  if (tokens.some((token) => DISALLOWED_DISPLAY_NAME_TOKENS.has(token))) {
    return true;
  }

  if (
    tokens.some((token) => DISALLOWED_DISPLAY_NAME_STEMS.some((stem) => token.includes(stem))) ||
    DISALLOWED_DISPLAY_NAME_STEMS.some((stem) => compact.includes(stem))
  ) {
    return true;
  }

  return false;
}

export function formatDisplayNameCandidate(value: string) {
  const candidate = normalizeDisplayNameWhitespace(value).replace(/^[“"'`]+|[”"'`.,!?]+$/g, "");
  if (!candidate || candidate.length > MAX_DISPLAY_NAME_LENGTH) {
    return null;
  }

  const words = candidate.split(" ").filter(Boolean);
  if (!words.length || words.length > 3) {
    return null;
  }

  if (!words.every((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word))) {
    return null;
  }

  const formatted = capitalizeDisplayName(words.join(" "));
  if (isDisallowedDisplayName(formatted)) {
    return null;
  }

  return formatted;
}

export function parseDisplayNameUpdateRequest(
  userMessage: string,
  currentDisplayName: string | null
): DisplayNameUpdateResult {
  const cleanMessage = normalizeDisplayNameWhitespace(userMessage);

  for (const pattern of DISPLAY_NAME_UPDATE_PATTERNS) {
    const match = cleanMessage.match(pattern);
    if (!match) {
      continue;
    }

    const nextDisplayName = formatDisplayNameCandidate(match[1] ?? "");
    if (!nextDisplayName) {
      return {
        attempted: true,
        nextDisplayName: null,
        rejected: true
      };
    }

    if (nextDisplayName === currentDisplayName?.trim()) {
      return {
        attempted: true,
        nextDisplayName: null,
        rejected: false
      };
    }

    return {
      attempted: true,
      nextDisplayName,
      rejected: false
    };
  }

  return {
    attempted: false,
    nextDisplayName: null,
    rejected: false
  };
}
