import { NextResponse } from "next/server";
import { parseDisplayNameUpdateRequest } from "@/lib/display-name";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  createTradeCalendarEntry,
  deleteTradeCaptureDraft,
  deleteConversationMessagesFrom,
  ensureProfile,
  getTradeCaptureDraft,
  getConversationById,
  getConversationMessages,
  getOrCreateConversation,
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
  extractProfileUpdates,
  fallbackConversationTitle,
  generateCoachReplyResult,
  summarizeProfileUpdate
} from "@/lib/coach";
import {
  buildTradeCalendarNotice,
  normalizeTradeCalendarTickers,
  resolveTradeCaptureTurn,
  type TradeCalendarNotice
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
  const existingTradeDraft = await getTradeCaptureDraft(
    supabase,
    currentUser.id,
    conversation.id
  );
  let tradeCalendarNotice: TradeCalendarNotice | null = null;
  const focusTickers = normalizeTradeCalendarTickers(updatedProfile.focus_tickers);
  const tradeCaptureTurn = resolveTradeCaptureTurn({
    currentDate: getCurrentTradeDate(),
    existingDraft: existingTradeDraft,
    focusTickers,
    userMessage: message,
    userName: nextDisplayName ?? "Trader"
  });
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

      if (savedTradeEntry) {
        tradeCalendarNotice = buildTradeCalendarNotice(savedTradeEntry);
        await deleteTradeCaptureDraft(supabase, conversation.id);
      } else {
        tradeCaptureReplyOverride = `${
          nextDisplayName ?? "Trader"
        }, I couldn't save that trade to the P&L calendar yet because the calendar storage isn't available in Supabase. I left the entry unsaved for now.`;
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

        const donePayload = await persistAssistantTurn(assistantMessage, extraNotifications);
        didPersistAssistant = true;
        send({
          assistantMessage,
          ...donePayload,
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
