import { NextResponse } from "next/server";
import { parseDisplayNameUpdateRequest } from "@/lib/display-name";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  createTradeCalendarEntry,
  deleteTradeCaptureDraft,
  deleteConversationMessagesFrom,
  ensureProfile,
  getTradeCalendarEntryById,
  getTradeCaptureDraft,
  getConversationById,
  getConversationMessages,
  getOrCreateConversation,
  listTradeCalendarEntries,
  maybeUpdateConversationTitle,
  recordDeskNotifications,
  recordProfileNotifications,
  seedConversationMessages,
  touchConversation,
  type WorkspaceNotification,
  upsertTradeCaptureDraft,
  updateStoredProfile
} from "@/lib/data";
import {
  buildFocusTickerQuickActionsForTurn,
  extractProfileUpdates,
  fallbackConversationTitle,
  generateCoachReplyResult,
  summarizeProfileUpdate,
  type WorkspaceQuickAction
} from "@/lib/coach";
import {
  buildTradeCalendarNotice,
  buildTradeCalendarSavedReply,
  normalizeTradeCalendarTickers,
  resolveTradeCaptureTurn,
  seedTradeCaptureDraftFromMessage,
  type TradeCalendarEntry,
  type TradeCalendarNotice,
  type TradeCaptureDraft
} from "@/lib/trade-calendar";

export const runtime = "nodejs";

function isMissingMessageAttachmentDataColumnError(message: string) {
  return (
    /attachment_data_url/i.test(message) ||
    (/schema cache/i.test(message) && /messages/i.test(message))
  );
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /abort/i.test(error.name))
  );
}

function looksLikeTradeCalendarInvite(message: string) {
  return (
    /add it to your p&l calendar/i.test(message) ||
    /do you want me to add it to your p&l calendar/i.test(message) ||
    /do you want to log this .* p&l calendar/i.test(message)
  );
}

function looksLikeTradeCalendarMissingReply(message: string) {
  return (
    /i still need the .* for the entry/i.test(message) ||
    /i still need the .* before i save (?:the )?entry/i.test(message) ||
    /i can keep logging this trade\./i.test(message)
  );
}

function looksLikeTradeCalendarSavedReplyMessage(message: string) {
  return (
    /your trade is now logged to the p&l calendar/i.test(message) ||
    /i(?:'|’)ve logged your .*p&l calendar/i.test(message) ||
    /i saved .* realized p&l/i.test(message)
  );
}

function looksLikeTradeCalendarPrompt(message: string) {
  if (looksLikeTradeCalendarSavedReplyMessage(message)) {
    return false;
  }

  return (
    looksLikeTradeCalendarInvite(message) ||
    looksLikeTradeCalendarMissingReply(message) ||
    /i can log that to your p&l calendar/i.test(message) ||
    /any notes you want included/i.test(message) ||
    /say ["']?no notes["']?.*log it as-is/i.test(message)
  );
}

function looksLikeTradeCalendarAffirmation(message: string) {
  return /\b(yes|yeah|yep|yup|sure|please do|do it|go ahead|sounds good|log it|add it|save it|record it|that works|ok|okay)\b/i.test(
    message
  );
}

function buildTradeCalendarQuickActions(input: {
  confirmedTradeCalendarEntry: TradeCalendarEntry | null;
  tradeCaptureTurn: ReturnType<typeof resolveTradeCaptureTurn>;
}): WorkspaceQuickAction[] {
  if (input.confirmedTradeCalendarEntry) {
    return [];
  }

  if (input.tradeCaptureTurn.mode !== "reply") {
    return [];
  }

  const nextDraft = input.tradeCaptureTurn.nextDraft;
  if (!nextDraft) {
    return [];
  }

  if (nextDraft.status === "pending_confirmation") {
    return [
      {
        kind: "submit",
        label: "Add to P&L calendar",
        prompt: "Yeah, add it to my P&L calendar."
      }
    ];
  }

  if (nextDraft.tickers.length > 0 && nextDraft.pnlAmount !== null) {
    return [
      {
        kind: "submit",
        label: "No notes",
        prompt: "No notes."
      },
      {
        kind: "prefill",
        label: "Add notes",
        prompt: "Notes: "
      }
    ];
  }

  return [];
}

function getCurrentTradeDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Los_Angeles",
    year: "numeric"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function parseDateKeyAsUtc(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function formatUtcDateKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekStartKey(currentDate: string) {
  const parsed = parseDateKeyAsUtc(currentDate);
  const offset = parsed.getUTCDay();
  parsed.setUTCDate(parsed.getUTCDate() - offset);
  return formatUtcDateKey(parsed);
}

function getMonthStartKey(currentDate: string) {
  const parsed = parseDateKeyAsUtc(currentDate);
  parsed.setUTCDate(1);
  return formatUtcDateKey(parsed);
}

function getYearStartKey(currentDate: string) {
  const parsed = parseDateKeyAsUtc(currentDate);
  parsed.setUTCMonth(0, 1);
  return formatUtcDateKey(parsed);
}

function formatSignedPnl(amount: number) {
  const absolute = Math.abs(amount).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2
  });

  if (amount > 0) {
    return `+$${absolute}`;
  }

  if (amount < 0) {
    return `-$${absolute}`;
  }

  return "$0";
}

function buildTickerPnlBreakdown(entries: TradeCalendarEntry[]) {
  const grouped = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.tickers.length) {
      continue;
    }

    const share = entry.pnlAmount / entry.tickers.length;
    for (const ticker of entry.tickers) {
      grouped.set(ticker, (grouped.get(ticker) ?? 0) + share);
    }
  }

  return Array.from(grouped.entries())
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .slice(0, 4)
    .map(([ticker, pnl]) => `${ticker} ${formatSignedPnl(pnl)}`);
}

function buildTradeCalendarContextBrief(entries: TradeCalendarEntry[], currentDate: string) {
  if (!entries.length) {
    return "No saved P&L calendar entries yet.";
  }

  const weekStart = getWeekStartKey(currentDate);
  const monthStart = getMonthStartKey(currentDate);
  const yearStart = getYearStartKey(currentDate);
  const todayEntries = entries.filter((entry) => entry.tradedOn === currentDate);
  const weekEntries = entries.filter((entry) => entry.tradedOn >= weekStart);
  const monthEntries = entries.filter((entry) => entry.tradedOn >= monthStart);
  const yearEntries = entries.filter((entry) => entry.tradedOn >= yearStart);
  const summarize = (label: string, scopedEntries: TradeCalendarEntry[]) => {
    if (!scopedEntries.length) {
      return `${label}: no logged trades`;
    }

    const net = scopedEntries.reduce((sum, entry) => sum + entry.pnlAmount, 0);
    return `${label}: ${formatSignedPnl(net)} across ${scopedEntries.length} trade${
      scopedEntries.length === 1 ? "" : "s"
    }`;
  };
  const recentEntries = entries
    .slice(0, 3)
    .map((entry) => `${entry.tradedOn} ${entry.tickers.join(", ")} ${formatSignedPnl(entry.pnlAmount)}`);

  return [
    summarize("Today", todayEntries),
    summarize("This week", weekEntries),
    summarize("This month", monthEntries),
    summarize("This year", yearEntries),
    recentEntries.length ? `Recent entries: ${recentEntries.join("; ")}` : null
  ]
    .filter(Boolean)
    .join(" | ");
}

function isTradeCalendarSummaryQuery(message: string) {
  return (
    /\b(?:how much did i make|how much am i (?:up|down)|what did i make|what am i (?:up|down)|check my p(?:&|and)?l|check my pl|check my calendar|what(?:'s| is) my p(?:&|and)?l|how did i do|sum up my day)\b/i.test(
      message
    ) ||
    (/\b(?:p(?:&|and)?l|pl|calendar)\b/i.test(message) &&
      /\b(?:today|week|month|year|ytd|so far|check|show|pull|read|total)\b/i.test(message))
  );
}

function buildTradeCalendarSummaryReply(entries: TradeCalendarEntry[], message: string, currentDate: string) {
  const normalized = message.toLowerCase();
  const weekStart = getWeekStartKey(currentDate);
  const monthStart = getMonthStartKey(currentDate);
  const yearStart = getYearStartKey(currentDate);

  let label = "today";
  let scopedEntries = entries.filter((entry) => entry.tradedOn === currentDate);

  if (/\b(?:ytd|year|yearly)\b/i.test(normalized)) {
    label = "this year";
    scopedEntries = entries.filter((entry) => entry.tradedOn >= yearStart);
  } else if (/\b(?:month|monthly)\b/i.test(normalized)) {
    label = "this month";
    scopedEntries = entries.filter((entry) => entry.tradedOn >= monthStart);
  } else if (/\b(?:week|weekly)\b/i.test(normalized)) {
    label = "this week";
    scopedEntries = entries.filter((entry) => entry.tradedOn >= weekStart);
  }

  if (!scopedEntries.length) {
    return `You don't have any logged trades in your P&L calendar for ${label} yet.`;
  }

  const net = scopedEntries.reduce((sum, entry) => sum + entry.pnlAmount, 0);
  const tradeCount = scopedEntries.length;
  const breakdown = buildTickerPnlBreakdown(scopedEntries);
  const amountLabel = formatSignedPnl(Math.abs(net)).replace("+", "");
  const lead =
    net > 0
      ? `You're up ${amountLabel} for ${label}`
      : net < 0
        ? `You're down ${amountLabel} for ${label}`
        : `You're flat for ${label}`;

  return [
    `${lead} across ${tradeCount} logged trade${tradeCount === 1 ? "" : "s"}.`,
    breakdown.length ? `Breakdown: ${breakdown.join(", ")}.` : null
  ]
    .filter(Boolean)
    .join(" ");
}

function buildDraftState(
  conversationId: string,
  createdAt: string,
  draft: {
    notes: string | null;
    pnlAmount: number | null;
    sourceMessage: string | null;
    status: "pending_confirmation" | "collecting_details";
    tickers: string[];
    tradedOn: string;
  }
): TradeCaptureDraft {
  return {
    conversationId,
    createdAt,
    notes: draft.notes,
    pnlAmount: draft.pnlAmount,
    sourceMessage: draft.sourceMessage,
    status: draft.status,
    tickers: draft.tickers,
    tradedOn: draft.tradedOn,
    updatedAt: createdAt
  };
}

function replayTradeCaptureDraftFromHistory(input: {
  conversationId: string;
  currentDate: string;
  focusTickers: string[];
  history: Array<{ content: string; createdAt: string; role: "assistant" | "user" }>;
  userName: string;
}) {
  let reconstructedDraft: TradeCaptureDraft | null = null;

  for (const entry of input.history.slice(-8)) {
    if (entry.role !== "user") {
      continue;
    }

    const replayTurn = resolveTradeCaptureTurn({
      currentDate: input.currentDate,
      existingDraft: reconstructedDraft,
      focusTickers: input.focusTickers,
      userMessage: entry.content,
      userName: input.userName
    });

    if (replayTurn.mode !== "reply") {
      continue;
    }

    if (replayTurn.nextDraft) {
      reconstructedDraft = buildDraftState(
        input.conversationId,
        entry.createdAt,
        replayTurn.nextDraft
      );
      continue;
    }

    if (replayTurn.calendarEntry) {
      reconstructedDraft = null;
    }
  }

  return reconstructedDraft;
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentUser = user;

  const formData = await request.formData();
  const rawMessage = String(formData.get("message") ?? "").trim();
  const message = rawMessage || "Please help me get started.";
  const requestedConversationId = String(formData.get("conversationId") ?? "").trim() || null;
  const branchConversationId = String(formData.get("branchConversationId") ?? "").trim() || null;
  const editFromMessageCreatedAt =
    String(formData.get("editFromMessageCreatedAt") ?? "").trim() || null;
  const forceNewConversation =
    String(formData.get("forceNewConversation") ?? "").trim() === "1";
  const attachmentEntry = formData.get("attachment");
  const attachment =
    attachmentEntry instanceof File && attachmentEntry.size > 0 ? attachmentEntry : null;
  const isEditedBranch = Boolean(branchConversationId && editFromMessageCreatedAt);

  const profileState = await ensureProfile(supabase, currentUser);
  let history: Awaited<ReturnType<typeof getConversationMessages>> = [];
  let editedFirstUserTurn = false;
  const displayNameUpdate = parseDisplayNameUpdateRequest(message, profileState.displayName);
  const nextDisplayName = displayNameUpdate.nextDisplayName ?? profileState.displayName;
  let conversation: { id: string; title: string | null; updated_at: string };
  if (isEditedBranch && branchConversationId && editFromMessageCreatedAt) {
    const existingConversation = await getConversationById(
      supabase,
      currentUser.id,
      branchConversationId
    );
    if (!existingConversation) {
      return NextResponse.json(
        { error: "Unable to find the conversation you wanted to revise." },
        { status: 400 }
      );
    }

    history = await getConversationMessages(supabase, existingConversation.id);
    const editedMessageIndex = history.findIndex(
      (entry) => entry.role === "user" && entry.createdAt === editFromMessageCreatedAt
    );

    if (editedMessageIndex === -1) {
      return NextResponse.json(
        { error: "Unable to branch from the edited message." },
        { status: 400 }
      );
    }

    editedFirstUserTurn = editedMessageIndex === 0;
    history = history.slice(0, editedMessageIndex);
    await deleteConversationMessagesFrom(supabase, existingConversation.id, editFromMessageCreatedAt);
    conversation = existingConversation;
  } else {
    conversation = await getOrCreateConversation(
      supabase,
      currentUser.id,
      requestedConversationId,
      forceNewConversation
    );
    history = await getConversationMessages(supabase, conversation.id);
  }

  const updatedProfile = extractProfileUpdates(message, profileState.profile, history);
  const profileUpdateSummary = summarizeProfileUpdate(profileState.profile, updatedProfile);
  const profileUpdateApplied = Boolean(profileUpdateSummary);
  const currentTradeDate = getCurrentTradeDate();
  const tradeCalendarEntries = await listTradeCalendarEntries(supabase, currentUser.id, {
    limit: 120
  });
  const tradeCalendarBrief = buildTradeCalendarContextBrief(
    tradeCalendarEntries,
    currentTradeDate
  );
  const existingTradeDraft = await getTradeCaptureDraft(supabase, currentUser.id, conversation.id);
  let tradeCalendarNotice: TradeCalendarNotice | null = null;
  let confirmedTradeCalendarEntry: TradeCalendarEntry | null = null;
  let reconstructedTradeDraft: TradeCaptureDraft | null = null;
  const focusTickers = normalizeTradeCalendarTickers(updatedProfile.focus_tickers);
  let tradeCaptureTurn = resolveTradeCaptureTurn({
    currentDate: currentTradeDate,
    existingDraft: existingTradeDraft,
    focusTickers,
    userMessage: message,
    userName: nextDisplayName ?? "Trader"
  });

  if (!existingTradeDraft) {
    const lastAssistantMessage = history.at(-1);
    const priorUserMessage = [...history].reverse().find((entry) => entry.role === "user") ?? null;

    if (
      lastAssistantMessage?.role === "assistant" &&
      looksLikeTradeCalendarPrompt(lastAssistantMessage.content)
    ) {
      reconstructedTradeDraft = replayTradeCaptureDraftFromHistory({
        conversationId: conversation.id,
        currentDate: currentTradeDate,
        focusTickers,
        history,
        userName: nextDisplayName ?? "Trader"
      });

      if (reconstructedTradeDraft) {
        tradeCaptureTurn = resolveTradeCaptureTurn({
          currentDate: currentTradeDate,
          existingDraft: reconstructedTradeDraft,
          focusTickers,
          userMessage: message,
          userName: nextDisplayName ?? "Trader"
        });
      } else if (priorUserMessage?.role === "user") {
        const seededDraft = seedTradeCaptureDraftFromMessage({
          currentDate: currentTradeDate,
          focusTickers,
          userMessage: priorUserMessage.content
        });

        if (seededDraft) {
          reconstructedTradeDraft = buildDraftState(
            conversation.id,
            priorUserMessage.createdAt,
            seededDraft
          );
          tradeCaptureTurn = resolveTradeCaptureTurn({
            currentDate: currentTradeDate,
            existingDraft: reconstructedTradeDraft,
            focusTickers,
            userMessage: message,
            userName: nextDisplayName ?? "Trader"
          });
        }
      }
    }
  }

  const lastAssistantMessage = history.at(-1);
  const isTradeCalendarFollowupWithoutStructuredTurn =
    tradeCaptureTurn.mode === "pass" &&
    lastAssistantMessage?.role === "assistant" &&
    looksLikeTradeCalendarPrompt(lastAssistantMessage.content);
  let tradeCaptureReplyOverride: string | null =
    tradeCaptureTurn.mode === "reply" ? tradeCaptureTurn.reply : null;

  let attachmentBytes: Buffer | null = null;
  if (attachment) {
    attachmentBytes = Buffer.from(await attachment.arrayBuffer());
  }
  const attachmentDataUrl =
    attachmentBytes && attachment?.type?.startsWith("image/")
      ? `data:${attachment.type};base64,${attachmentBytes.toString("base64")}`
      : null;

  let userInsert = await supabase
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      role: "user",
      content: message,
      attachment_name: attachment?.name ?? null,
      attachment_type: attachment?.type ?? null,
      attachment_data_url: attachmentDataUrl
    })
    .select("created_at")
    .single();

  if (userInsert.error && isMissingMessageAttachmentDataColumnError(userInsert.error.message)) {
    userInsert = await supabase
      .from("messages")
      .insert({
        conversation_id: conversation.id,
        role: "user",
        content: message,
        attachment_name: attachment?.name ?? null,
        attachment_type: attachment?.type ?? null
      })
      .select("created_at")
      .single();
  }

  if (userInsert.error || !userInsert.data) {
    return NextResponse.json(
      { error: userInsert.error?.message ?? "Unable to save your message." },
      { status: 500 }
    );
  }
  const userMessageCreatedAt = userInsert.data.created_at;

  if (tradeCaptureTurn.mode === "reply") {
    if (tradeCaptureTurn.calendarEntry) {
      const savedTradeEntry = await createTradeCalendarEntry(supabase, currentUser.id, {
        ...tradeCaptureTurn.calendarEntry,
        conversationId: conversation.id
      });
      const confirmedTradeEntry = savedTradeEntry
        ? (await getTradeCalendarEntryById(supabase, currentUser.id, savedTradeEntry.id)) ??
          savedTradeEntry
        : null;

      if (confirmedTradeEntry) {
        confirmedTradeCalendarEntry = confirmedTradeEntry;
        tradeCalendarNotice = buildTradeCalendarNotice(confirmedTradeEntry);
        tradeCaptureReplyOverride = buildTradeCalendarSavedReply(confirmedTradeEntry);
        await deleteTradeCaptureDraft(supabase, conversation.id);
      } else {
        tradeCaptureReplyOverride =
          "I couldn't save that trade to the P&L calendar yet, so I left it out of the calendar for now. If you want, send the trade again and I can retry it.";
      }
    } else if (tradeCaptureTurn.nextDraft) {
      await upsertTradeCaptureDraft(supabase, currentUser.id, conversation.id, tradeCaptureTurn.nextDraft);
    } else {
      await deleteTradeCaptureDraft(supabase, conversation.id);
    }
  }

  async function persistAssistantTurn(
    assistantMessage: string,
    extraNotifications: Array<{
      changeType: "added" | "updated" | "removed";
      detail: string | null;
      fieldKey: string;
      title: string;
    }> = []
  ) {
    const assistantInsert = await supabase
      .from("messages")
      .insert({
        conversation_id: conversation.id,
        role: "assistant",
        content: assistantMessage
      })
      .select("created_at")
      .single();

    if (assistantInsert.error || !assistantInsert.data) {
      throw new Error(
        assistantInsert.error?.message ?? "Unable to save the assistant reply."
      );
    }

    let conversationTitle = conversation.title;
    if (!conversationTitle || editedFirstUserTurn) {
      conversationTitle = fallbackConversationTitle(message);
      await maybeUpdateConversationTitle(supabase, conversation.id, conversationTitle);
    }

    await updateStoredProfile(supabase, currentUser.id, nextDisplayName, updatedProfile);
    if (nextDisplayName && nextDisplayName !== profileState.displayName) {
      const { error: authUpdateError } = await supabase.auth.updateUser({
        data: {
          display_name: nextDisplayName
        }
      });

      if (authUpdateError) {
        console.error("Failed to persist display name to auth metadata", authUpdateError);
      }
    }

    let notifications: WorkspaceNotification[] = [];
    try {
      const profileNotifications = await recordProfileNotifications(
        supabase,
        currentUser.id,
        profileState.profile,
        updatedProfile,
        assistantInsert.data.created_at
      );
      const deskNotifications = extraNotifications.length
        ? await recordDeskNotifications(
            supabase,
            currentUser.id,
            extraNotifications,
            assistantInsert.data.created_at
          )
        : [];
      notifications = [...deskNotifications, ...profileNotifications];
    } catch (notificationError) {
      console.error("Failed to record profile notifications", notificationError);
    }

    await touchConversation(supabase, conversation.id);

    return {
      assistantMessageCreatedAt: assistantInsert.data.created_at,
      conversationId: conversation.id,
      conversationTitle,
      notifications,
      profile: updatedProfile,
      userAttachmentDataUrl: attachmentDataUrl,
      userAttachmentName: attachment?.name ?? null,
      userAttachmentType: attachment?.type ?? null,
      userMessageCreatedAt,
      userName: nextDisplayName ?? "Trader"
    };
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(payload: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      }

      let assistantMessage = "";
      let didPersistAssistant = false;

      try {
        const extraNotifications = tradeCalendarNotice
          ? [
              {
                changeType: "added" as const,
                detail: tradeCalendarNotice.detail,
                fieldKey: "trade_calendar",
                title: "Logged trade to P&L calendar"
              }
            ]
          : [];
        const replyResult = displayNameUpdate.rejected
          ? {
              mode: "reply" as const,
              reply:
                "I can use a real first name or clean nickname, but I can't use abusive or hateful names. Tell me what you'd like me to call you instead."
            }
          : isTradeCalendarSummaryQuery(message)
            ? {
                mode: "reply" as const,
                reply: buildTradeCalendarSummaryReply(
                  tradeCalendarEntries,
                  message,
                  currentTradeDate
                )
              }
          : isTradeCalendarFollowupWithoutStructuredTurn
          ? {
              mode: "reply" as const,
              reply: reconstructedTradeDraft
                ? reconstructedTradeDraft.tickers.length && reconstructedTradeDraft.pnlAmount !== null
                  ? 'I can keep logging this trade. I already have the ticker and realized P&L. Any notes you want included? If not, say "no notes" and I’ll log it as-is.'
                  : reconstructedTradeDraft.tickers.length
                    ? "I can keep logging this trade. I still need the realized P&L amount before I save it."
                    : reconstructedTradeDraft.pnlAmount !== null
                      ? "I can keep logging this trade. I still need the ticker before I save it."
                      : "I can keep logging this trade. I still need the ticker and realized P&L before I save it."
                : "I can keep logging this trade. I still need the ticker and realized P&L before I save it."
              }
          : tradeCaptureTurn.mode === "reply"
            ? {
                mode: "reply" as const,
                reply: tradeCaptureReplyOverride ?? tradeCaptureTurn.reply
              }
          : await generateCoachReplyResult(
              {
                attachmentBytes,
                attachmentName: attachment?.name ?? null,
                attachmentType: attachment?.type ?? null,
                history,
                profile: updatedProfile,
                previousProfile: profileState.profile,
                profileUpdateApplied,
                profileUpdateSummary,
                tradeCalendarBrief,
                userMessage: message,
                userName: nextDisplayName ?? "Trader"
              },
              request.signal
            );

        if (replyResult.mode === "reply") {
          assistantMessage = replyResult.reply;
          send({ content: assistantMessage, type: "delta" });
        } else {
          for await (const delta of replyResult.stream) {
            if (!delta) {
              continue;
            }

            assistantMessage += delta;
            send({ content: delta, type: "delta" });
          }

          if (!assistantMessage.trim()) {
            assistantMessage = replyResult.fallbackReply;
            send({ content: assistantMessage, type: "delta" });
          }
        }

        const assistantQuickActions = (() => {
          const tradeCalendarQuickActions = buildTradeCalendarQuickActions({
            confirmedTradeCalendarEntry,
            tradeCaptureTurn
          });
          if (tradeCalendarQuickActions.length) {
            return tradeCalendarQuickActions;
          }

          return buildFocusTickerQuickActionsForTurn({
            history,
            nextProfile: updatedProfile,
            previousProfile: profileState.profile,
            profileUpdateApplied,
            userMessage: message
          });
        })();

        const donePayload = await persistAssistantTurn(assistantMessage, extraNotifications);
        didPersistAssistant = true;
        send({
          assistantMessage,
          ...donePayload,
          quickActions: assistantQuickActions,
          tradeCalendarEntry: confirmedTradeCalendarEntry,
          tradeCalendarNotice,
          type: "done"
        });
        controller.close();
      } catch (error) {
        if (isAbortError(error) || request.signal.aborted) {
          if (!didPersistAssistant && assistantMessage.trim()) {
            try {
              await persistAssistantTurn(assistantMessage.trimEnd());
            } catch (persistError) {
              console.error("Failed to persist partial assistant reply", persistError);
            }
          }
          controller.close();
          return;
        }

        console.error("Streaming chat response failed", error);
        send({
          message:
            error instanceof Error ? error.message : "Unable to complete the assistant reply.",
          type: "error"
        });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no"
    }
  });
}
