import type { User, SupabaseClient } from "@supabase/supabase-js";
import { formatDisplayNameCandidate } from "@/lib/display-name";
import {
  buildProfileChangeNotifications,
  buildWorkspaceIntro,
  emptyTradingProfile,
  fallbackConversationTitle,
  normalizeTradingProfile,
  type TradingProfile,
  type WorkspaceMessage
} from "@/lib/coach";
import {
  normalizeTradeCalendarTickers,
  serializeTradeCalendarTickers,
  type TradeCalendarEntry,
  type TradeCalendarEntryInput,
  type TradeCaptureDraft,
  type TradeCaptureDraftInput
} from "@/lib/trade-calendar";

type ConversationRow = {
  id: string;
  title: string | null;
  updated_at: string;
};

type ConversationMessageRow = {
  attachment_data_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  content: string;
  conversation_id: string;
  created_at: string;
  role: "user" | "assistant";
};

type ProfileState = {
  displayName: string | null;
  needsDisplayName: boolean;
  profile: TradingProfile;
};

type NotificationRow = {
  change_type: "added" | "updated" | "removed";
  created_at: string;
  detail: string | null;
  field_key: string;
  id: string;
  title: string;
};

type TradeCalendarEntryRow = {
  conversation_id: string | null;
  created_at: string;
  id: string;
  notes: string | null;
  pnl_amount: number | string;
  tickers: string;
  traded_on: string;
  updated_at: string;
};

type TradeCaptureDraftRow = {
  conversation_id: string;
  created_at: string;
  notes: string | null;
  pnl_amount: number | string | null;
  source_message: string | null;
  status: "pending_confirmation" | "collecting_details";
  tickers: string | null;
  traded_on: string;
  updated_at: string;
};

export type DeskNotificationInput = {
  changeType: "added" | "updated" | "removed";
  detail: string | null;
  fieldKey: string;
  title: string;
};

export type WorkspaceState = {
  conversations: ConversationSummary[];
  conversationId: string | null;
  deskTitle: string;
  messages: WorkspaceMessage[];
  needsDisplayName: boolean;
  notifications: WorkspaceNotification[];
  profile: TradingProfile;
  tradeCalendarEntries: TradeCalendarEntry[];
  userName: string;
  workspaceIntro: string;
};

export type ConversationSummary = {
  id: string;
  preview: string | null;
  title: string;
  updatedAt: string;
};

export type WorkspaceNotification = {
  changeType: "added" | "updated" | "removed";
  createdAt: string;
  detail: string | null;
  fieldKey: string;
  id: string;
  title: string;
};

function isMissingConversationTitleColumnError(message: string) {
  return (
    /could not find the 'title' column/i.test(message) ||
    /column .*title/i.test(message) ||
    /schema cache/i.test(message)
  );
}

function isMissingNotificationsTableError(message: string) {
  return (
    /memory_notifications/i.test(message) ||
    /profile_notifications/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /schema cache/i.test(message)
  );
}

function isMissingMessageAttachmentDataColumnError(message: string) {
  return (
    /attachment_data_url/i.test(message) ||
    (/schema cache/i.test(message) && /messages/i.test(message))
  );
}

function toTitleCase(value: string) {
  return value.replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function humanizeEmailLocalPart(email: string | null | undefined) {
  const localPart = email?.split("@", 1)[0]?.trim() ?? "";
  if (!localPart) {
    return null;
  }

  const withoutTrailingDigits = localPart.replace(/\d+$/, "");
  const base = withoutTrailingDigits || localPart;
  const spaced = base.replace(/[._-]+/g, " ").trim();
  if (!spaced) {
    return null;
  }

  return toTitleCase(spaced.toLowerCase());
}

function readMetadataDisplayName(user: User) {
  const fromMetadata = user.user_metadata?.display_name;
  if (typeof fromMetadata === "string" && fromMetadata.trim()) {
    return fromMetadata.trim();
  }

  return null;
}

function isPlaceholderDisplayName(currentName: string, user: User) {
  const localPart = user.email?.split("@", 1)[0]?.trim().toLowerCase();
  const normalizedCurrent = currentName.trim().toLowerCase();
  if (!localPart) {
    return normalizedCurrent === "trader";
  }

  const metadataDisplayName = readMetadataDisplayName(user)?.trim().toLowerCase();
  if (metadataDisplayName && metadataDisplayName === normalizedCurrent) {
    return false;
  }

  const humanizedLocalPart = humanizeEmailLocalPart(user.email)?.toLowerCase();
  return (
    normalizedCurrent === "trader" ||
    normalizedCurrent === localPart ||
    normalizedCurrent === localPart.replace(/\d+$/, "") ||
    normalizedCurrent === humanizedLocalPart ||
    /^[a-z0-9._-]+$/.test(normalizedCurrent)
  );
}

function resolveDisplayName(storedName: string | null, user: User) {
  const normalizedStoredName = storedName ? formatDisplayNameCandidate(storedName) : null;
  if (normalizedStoredName && !isPlaceholderDisplayName(normalizedStoredName, user)) {
    return normalizedStoredName;
  }

  const metadataDisplayName = readMetadataDisplayName(user);
  const normalizedMetadataDisplayName = metadataDisplayName
    ? formatDisplayNameCandidate(metadataDisplayName)
    : null;
  if (normalizedMetadataDisplayName) {
    return normalizedMetadataDisplayName;
  }

  return null;
}

export async function ensureProfile(
  supabase: SupabaseClient,
  user: User
): Promise<ProfileState> {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, profile_json")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    const displayName = resolveDisplayName(null, user);
    const insert = await supabase.from("profiles").insert({
      user_id: user.id,
      display_name: displayName,
      profile_json: emptyTradingProfile
    });

    if (insert.error) {
      throw new Error(insert.error.message);
    }

    return {
      displayName,
      needsDisplayName: !displayName,
      profile: { ...emptyTradingProfile }
    };
  }

  const currentDisplayName =
    typeof data.display_name === "string" && data.display_name.trim()
      ? data.display_name.trim()
      : null;
  const displayName = resolveDisplayName(currentDisplayName, user);
  const profile = normalizeTradingProfile(data.profile_json);

  if (displayName !== data.display_name) {
    await supabase
      .from("profiles")
      .update({
        display_name: displayName
      })
      .eq("user_id", user.id);
  }

  return {
    displayName,
    needsDisplayName: !displayName,
    profile
  };
}

export async function updateStoredProfile(
  supabase: SupabaseClient,
  userId: string,
  displayName: string | null,
  profile: TradingProfile
) {
  const result = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      profile_json: profile
    })
    .eq("user_id", userId);

  if (result.error) {
    throw new Error(result.error.message);
  }
}

function normalizeWorkspaceNotification(row: NotificationRow): WorkspaceNotification {
  return {
    changeType: row.change_type,
    createdAt: row.created_at,
    detail: row.detail,
    fieldKey: row.field_key,
    id: row.id,
    title: row.title
  };
}

function normalizeTradeCalendarEntry(row: TradeCalendarEntryRow): TradeCalendarEntry {
  const pnlAmount =
    typeof row.pnl_amount === "number" ? row.pnl_amount : Number(row.pnl_amount);

  return {
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    id: row.id,
    notes: row.notes,
    pnlAmount: Number.isFinite(pnlAmount) ? pnlAmount : 0,
    tickers: normalizeTradeCalendarTickers(row.tickers),
    tradedOn: row.traded_on,
    updatedAt: row.updated_at
  };
}

function normalizeTradeCaptureDraft(row: TradeCaptureDraftRow): TradeCaptureDraft {
  const pnlAmount =
    row.pnl_amount === null
      ? null
      : typeof row.pnl_amount === "number"
        ? row.pnl_amount
        : Number(row.pnl_amount);

  return {
    conversationId: row.conversation_id,
    createdAt: row.created_at,
    notes: row.notes,
    pnlAmount: pnlAmount !== null && Number.isFinite(pnlAmount) ? pnlAmount : null,
    sourceMessage: row.source_message,
    status: row.status,
    tickers: normalizeTradeCalendarTickers(row.tickers),
    tradedOn: row.traded_on,
    updatedAt: row.updated_at
  };
}

export async function listWorkspaceNotifications(
  supabase: SupabaseClient,
  userId: string,
  limit = 20
): Promise<WorkspaceNotification[]> {
  const { data, error } = await supabase
    .from("profile_notifications")
    .select("id, field_key, change_type, title, detail, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingNotificationsTableError(error.message)) {
      return [];
    }

    throw new Error(error.message);
  }

  return ((data ?? []) as NotificationRow[]).map(normalizeWorkspaceNotification);
}

export async function recordProfileNotifications(
  supabase: SupabaseClient,
  userId: string,
  previous: TradingProfile,
  next: TradingProfile,
  createdAt = new Date().toISOString()
): Promise<WorkspaceNotification[]> {
  const notifications = buildProfileChangeNotifications(previous, next);
  return recordDeskNotifications(supabase, userId, notifications, createdAt);
}

export async function recordDeskNotifications(
  supabase: SupabaseClient,
  userId: string,
  notifications: DeskNotificationInput[],
  createdAt = new Date().toISOString()
): Promise<WorkspaceNotification[]> {
  if (!notifications.length) {
    return [];
  }

  const rows = notifications.map((notification) => ({
    user_id: userId,
    field_key: notification.fieldKey,
    change_type: notification.changeType,
    title: notification.title,
    detail: notification.detail,
    created_at: createdAt
  }));

  const { data, error } = await supabase
    .from("profile_notifications")
    .insert(rows)
    .select("id, field_key, change_type, title, detail, created_at");

  if (error) {
    if (isMissingNotificationsTableError(error.message)) {
      return notifications.map((notification, index) => ({
        changeType: notification.changeType,
        createdAt,
        detail: notification.detail,
        fieldKey: notification.fieldKey,
        id: `${createdAt}-${notification.fieldKey}-${index}`,
        title: notification.title
      }));
    }

    throw new Error(error.message);
  }

  return ((data ?? []) as NotificationRow[]).map(normalizeWorkspaceNotification);
}

export async function listTradeCalendarEntries(
  supabase: SupabaseClient,
  userId: string,
  options?: {
    limit?: number;
    monthStart?: string | null;
  }
): Promise<TradeCalendarEntry[]> {
  let query = supabase
    .from("trade_calendar_entries")
    .select("id, conversation_id, traded_on, tickers, pnl_amount, notes, created_at, updated_at")
    .eq("user_id", userId)
    .order("traded_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (options?.monthStart) {
    query = query.gte("traded_on", options.monthStart);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    if (
      /trade_calendar_entries/i.test(error.message) ||
      /relation .* does not exist/i.test(error.message) ||
      /schema cache/i.test(error.message)
    ) {
      return [];
    }

    throw new Error(error.message);
  }

  return ((data ?? []) as TradeCalendarEntryRow[]).map(normalizeTradeCalendarEntry);
}

export async function getTradeCaptureDraft(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string
): Promise<TradeCaptureDraft | null> {
  const { data, error } = await supabase
    .from("trade_capture_drafts")
    .select(
      "conversation_id, traded_on, tickers, pnl_amount, notes, source_message, status, created_at, updated_at"
    )
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (error) {
    if (
      /trade_capture_drafts/i.test(error.message) ||
      /relation .* does not exist/i.test(error.message) ||
      /schema cache/i.test(error.message)
    ) {
      return null;
    }

    throw new Error(error.message);
  }

  return data ? normalizeTradeCaptureDraft(data as TradeCaptureDraftRow) : null;
}

export async function upsertTradeCaptureDraft(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  draft: TradeCaptureDraftInput
) {
  const { error } = await supabase.from("trade_capture_drafts").upsert(
    {
      conversation_id: conversationId,
      user_id: userId,
      traded_on: draft.tradedOn,
      tickers: draft.tickers.length ? serializeTradeCalendarTickers(draft.tickers) : null,
      pnl_amount: draft.pnlAmount,
      notes: draft.notes,
      source_message: draft.sourceMessage,
      status: draft.status
    },
    {
      onConflict: "conversation_id"
    }
  );

  if (error) {
    if (
      /trade_capture_drafts/i.test(error.message) ||
      /relation .* does not exist/i.test(error.message) ||
      /schema cache/i.test(error.message)
    ) {
      return;
    }

    throw new Error(error.message);
  }
}

export async function deleteTradeCaptureDraft(
  supabase: SupabaseClient,
  conversationId: string
) {
  const { error } = await supabase
    .from("trade_capture_drafts")
    .delete()
    .eq("conversation_id", conversationId);

  if (error) {
    if (
      /trade_capture_drafts/i.test(error.message) ||
      /relation .* does not exist/i.test(error.message) ||
      /schema cache/i.test(error.message)
    ) {
      return;
    }

    throw new Error(error.message);
  }
}

export async function createTradeCalendarEntry(
  supabase: SupabaseClient,
  userId: string,
  entry: TradeCalendarEntryInput
): Promise<TradeCalendarEntry | null> {
  const { data, error } = await supabase
    .from("trade_calendar_entries")
    .insert({
      user_id: userId,
      conversation_id: entry.conversationId,
      traded_on: entry.tradedOn,
      tickers: serializeTradeCalendarTickers(entry.tickers),
      pnl_amount: entry.pnlAmount,
      notes: entry.notes
    })
    .select("id, conversation_id, traded_on, tickers, pnl_amount, notes, created_at, updated_at")
    .single();

  if (error) {
    if (
      /trade_calendar_entries/i.test(error.message) ||
      /relation .* does not exist/i.test(error.message) ||
      /schema cache/i.test(error.message)
    ) {
      return null;
    }

    throw new Error(error.message);
  }

  return normalizeTradeCalendarEntry(data as TradeCalendarEntryRow);
}

function normalizeConversationSummaryTitle(title: string | null, firstUserMessage: string | null) {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  return fallbackConversationTitle(firstUserMessage ?? "");
}

function buildConversationPreview(content: string | null) {
  if (!content) {
    return null;
  }

  const preview = content.replace(/\s+/g, " ").trim();
  if (!preview) {
    return null;
  }

  return preview.length > 72 ? `${preview.slice(0, 69)}...` : preview;
}

async function selectConversationRows(supabase: SupabaseClient, userId: string) {
  const withTitle = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(24);

  if (!withTitle.error) {
    return (withTitle.data ?? []) as ConversationRow[];
  }

  if (!isMissingConversationTitleColumnError(withTitle.error.message)) {
    throw new Error(withTitle.error.message);
  }

  const withoutTitle = await supabase
    .from("conversations")
    .select("id, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(24);

  if (withoutTitle.error) {
    throw new Error(withoutTitle.error.message);
  }

  return ((withoutTitle.data ?? []) as Array<{ id: string; updated_at: string }>).map((row) => ({
    id: row.id,
    title: null,
    updated_at: row.updated_at
  }));
}

export async function getLatestConversation(supabase: SupabaseClient, userId: string) {
  const rows = await selectConversationRows(supabase, userId);
  return rows[0] ?? null;
}

export async function getConversationById(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string
) {
  const withTitle = await supabase
    .from("conversations")
    .select("id, title, updated_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!withTitle.error) {
    return (withTitle.data as ConversationRow | null) ?? null;
  }

  if (!isMissingConversationTitleColumnError(withTitle.error.message)) {
    throw new Error(withTitle.error.message);
  }

  const withoutTitle = await supabase
    .from("conversations")
    .select("id, updated_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (withoutTitle.error) {
    throw new Error(withoutTitle.error.message);
  }

  if (!withoutTitle.data) {
    return null;
  }

  return {
    id: withoutTitle.data.id,
    title: null,
    updated_at: withoutTitle.data.updated_at
  } satisfies ConversationRow;
}

export async function deleteConversationMessagesFrom(
  supabase: SupabaseClient,
  conversationId: string,
  createdAtInclusive: string
) {
  const result = await supabase
    .from("messages")
    .delete()
    .eq("conversation_id", conversationId)
    .gte("created_at", createdAtInclusive);

  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function createConversation(
  supabase: SupabaseClient,
  userId: string,
  title?: string | null
) {
  const insertWithTitle = await supabase
    .from("conversations")
    .insert({
      user_id: userId,
      ...(title ? { title } : {})
    })
    .select("id, title, updated_at")
    .single();

  if (!insertWithTitle.error && insertWithTitle.data) {
    return insertWithTitle.data as ConversationRow;
  }

  if (insertWithTitle.error && !isMissingConversationTitleColumnError(insertWithTitle.error.message)) {
    throw new Error(insertWithTitle.error.message);
  }

  const insertWithoutTitle = await supabase
    .from("conversations")
    .insert({
      user_id: userId
    })
    .select("id, updated_at")
    .single();

  if (insertWithoutTitle.error || !insertWithoutTitle.data) {
    throw new Error(insertWithoutTitle.error?.message ?? "Unable to create a conversation.");
  }

  return {
    id: insertWithoutTitle.data.id,
    title: null,
    updated_at: insertWithoutTitle.data.updated_at
  } satisfies ConversationRow;
}

export async function getOrCreateConversation(
  supabase: SupabaseClient,
  userId: string,
  requestedConversationId: string | null,
  forceNewConversation = false
) {
  if (requestedConversationId) {
    const conversation = await getConversationById(supabase, userId, requestedConversationId);
    if (conversation) {
      return conversation;
    }
  }

  if (!forceNewConversation) {
    const latest = await getLatestConversation(supabase, userId);
    if (latest) {
      return latest;
    }
  }

  return createConversation(supabase, userId);
}

export async function touchConversation(supabase: SupabaseClient, conversationId: string) {
  const result = await supabase
    .from("conversations")
    .update({
      updated_at: new Date().toISOString()
    })
    .eq("id", conversationId);

  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function getConversationMessages(
  supabase: SupabaseClient,
  conversationId: string
): Promise<WorkspaceMessage[]> {
  const withAttachmentData = await supabase
    .from("messages")
    .select("role, content, created_at, attachment_name, attachment_type, attachment_data_url")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  let data: ConversationMessageRow[] | null = (withAttachmentData.data as ConversationMessageRow[]) ?? null;

  if (withAttachmentData.error) {
    if (!isMissingMessageAttachmentDataColumnError(withAttachmentData.error.message)) {
      throw new Error(withAttachmentData.error.message);
    }

    const withoutAttachmentData = await supabase
      .from("messages")
      .select("role, content, created_at, attachment_name, attachment_type")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (withoutAttachmentData.error) {
      throw new Error(withoutAttachmentData.error.message);
    }

    data = (withoutAttachmentData.data as ConversationMessageRow[]) ?? null;
  }

  return (data ?? []).map((entry) => ({
    attachmentDataUrl:
      "attachment_data_url" in entry ? (entry.attachment_data_url ?? null) : null,
    attachmentName: "attachment_name" in entry ? (entry.attachment_name ?? null) : null,
    attachmentType: "attachment_type" in entry ? (entry.attachment_type ?? null) : null,
    createdAt: String(entry.created_at),
    role: entry.role as "user" | "assistant",
    content: String(entry.content)
  }));
}

export async function seedConversationMessages(
  supabase: SupabaseClient,
  conversationId: string,
  messages: WorkspaceMessage[]
) {
  if (!messages.length) {
    return;
  }

  const rows = messages.map((message) => ({
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    attachment_name: message.attachmentName ?? null,
    attachment_type: message.attachmentType ?? null,
    attachment_data_url: message.attachmentDataUrl ?? null,
    created_at: message.createdAt
  }));

  let result = await supabase.from("messages").insert(rows);

  if (result.error && isMissingMessageAttachmentDataColumnError(result.error.message)) {
    result = await supabase.from("messages").insert(
      rows.map(({ attachment_data_url: _attachmentDataUrl, ...row }) => row)
    );
  }

  if (result.error) {
    throw new Error(result.error.message);
  }
}

export async function maybeUpdateConversationTitle(
  supabase: SupabaseClient,
  conversationId: string,
  title: string
) {
  const normalized = title.trim();
  if (!normalized) {
    return;
  }

  const result = await supabase
    .from("conversations")
    .update({
      title: normalized
    })
    .eq("id", conversationId);

  if (result.error && !isMissingConversationTitleColumnError(result.error.message)) {
    throw new Error(result.error.message);
  }
}

export async function getConversationSummaries(
  supabase: SupabaseClient,
  userId: string
): Promise<ConversationSummary[]> {
  const conversations = await selectConversationRows(supabase, userId);
  if (!conversations.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("messages")
    .select("conversation_id, role, content, created_at")
    .in(
      "conversation_id",
      conversations.map((conversation) => conversation.id)
    )
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const grouped = new Map<string, ConversationMessageRow[]>();
  for (const entry of (data ?? []) as ConversationMessageRow[]) {
    const items = grouped.get(entry.conversation_id) ?? [];
    items.push(entry);
    grouped.set(entry.conversation_id, items);
  }

  return conversations.map((conversation) => {
    const items = grouped.get(conversation.id) ?? [];
    const firstUser = items.find((item) => item.role === "user") ?? null;
    const lastMessage = items[items.length - 1] ?? null;

    return {
      id: conversation.id,
      preview: buildConversationPreview(lastMessage?.content ?? null),
      title: normalizeConversationSummaryTitle(conversation.title, firstUser?.content ?? null),
      updatedAt: conversation.updated_at
    };
  });
}

export async function getWorkspaceState(
  supabase: SupabaseClient,
  user: User,
  options?: {
    conversationId?: string | null;
    forceNewConversation?: boolean;
  }
): Promise<WorkspaceState> {
  const profileState = await ensureProfile(supabase, user);
  let selectedConversation: ConversationRow | null = null;
  if (!options?.forceNewConversation) {
    if (options?.conversationId) {
      selectedConversation = await getConversationById(supabase, user.id, options.conversationId);
    }

    if (!selectedConversation) {
      selectedConversation = await getLatestConversation(supabase, user.id);
    }
  }
  const messages = selectedConversation
    ? await getConversationMessages(supabase, selectedConversation.id)
    : [];
  const conversations = await getConversationSummaries(supabase, user.id);
  const notifications = await listWorkspaceNotifications(supabase, user.id);
  const tradeCalendarEntries = await listTradeCalendarEntries(supabase, user.id, {
    limit: 48
  });

  return {
    conversations,
    conversationId: selectedConversation?.id ?? null,
    deskTitle: profileState.displayName ? `${profileState.displayName}'s desk` : "Your desk",
    messages,
    needsDisplayName: profileState.needsDisplayName,
    notifications,
    profile: profileState.profile,
    tradeCalendarEntries,
    userName: profileState.displayName ?? "Trader",
    workspaceIntro: buildWorkspaceIntro(
      profileState.displayName ?? "Trader",
      profileState.profile,
      messages.length > 0
    )
  };
}
