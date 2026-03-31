import Link from "next/link";
import { redirect } from "next/navigation";
import { saveDisplayNameAction, signOutAction } from "@/app/auth-actions";
import { ChatWorkspace } from "@/components/chat-workspace";
import { LogoMark } from "@/components/logo-mark";
import { MarketHoverStrip } from "@/components/market-hover-strip";
import { NotificationBell } from "@/components/notification-bell";
import { WorkspaceAnalysisPanel, WorkspaceHistoryPanel } from "@/components/workspace-panels";
import { getWorkspaceState } from "@/lib/data";
import { parseTickerList } from "@/lib/market";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const STARTER_PROMPTS: Record<string, string> = {
  "desk-map":
    "Map my trading desk with the fewest high-value questions possible. Figure out my tickers, markets, style, risk tolerance, and trading goal.",
  playbook:
    "Start a trading playbook draft from what you know about me so far. Organize it into markets, setups, risk rules, and execution notes.",
  "rulebook":
    "Build me a simple trading rulebook with max risk per trade, daily loss guardrails, and my non-negotiables. Keep it practical.",
  "trade-review":
    "Help me review my last trade like a pro coach. Ask only for the missing details you truly need, then turn it into a structured review."
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

export default async function WorkspacePage({
  searchParams
}: {
  searchParams?: {
    chat?: string;
    message?: string;
    new?: string;
    signedIn?: string;
    starter?: string;
    view?: string;
  };
}) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const workspace = await getWorkspaceState(supabase, user, {
    conversationId: searchParams?.chat ?? null,
    forceNewConversation: searchParams?.new === "1"
  });
  const message = searchParams?.message;
  const needsSetup = workspace.needsDisplayName;
  const activeView =
    searchParams?.view === "history" || searchParams?.view === "analysis"
      ? searchParams.view
      : "desk";
  const initialDraftMessage = searchParams?.starter ? STARTER_PROMPTS[searchParams.starter] ?? null : null;
  const userInitial = workspace.userName.trim().charAt(0).toUpperCase() || "T";
  const userTickers = parseTickerList(workspace.profile.focus_tickers);
  const currentConversationId = workspace.conversationId;

  return (
    <div className="page-shell workspace-shell-page">
      <div className="ambient-grid" aria-hidden="true" />
      <header className={`workspace-topbar ${needsSetup ? "setup-state" : ""}`}>
        <div className="workspace-topbar-inner">
          <div className="workspace-topbar-left">
            {needsSetup ? (
              <span className="workspace-brand-button workspace-brand-static">
                <LogoMark as="span" className="workspace-brand" variant="nav" />
              </span>
            ) : activeView === "desk" ? (
              <button
                aria-controls="thread-drawer"
                aria-expanded="false"
                aria-label="Open coaching threads"
                className="workspace-brand-button"
                type="button"
              >
                <LogoMark as="span" className="workspace-brand" variant="nav" />
              </button>
            ) : (
              <Link
                aria-label="Return to the desk"
                className="workspace-brand-button"
                href={buildWorkspaceHref("desk", { chat: currentConversationId })}
              >
                <LogoMark as="span" className="workspace-brand" variant="nav" />
              </Link>
            )}
            {!needsSetup ? (
              <nav className="workspace-nav" aria-label="Workspace sections">
                <Link
                  className={`workspace-nav-link ${activeView === "desk" ? "active" : ""}`}
                  href={buildWorkspaceHref("desk", { chat: currentConversationId })}
                >
                  The Desk
                </Link>
                <Link
                  className={`workspace-nav-link ${activeView === "history" ? "active" : ""}`}
                  href={buildWorkspaceHref("history", { chat: currentConversationId })}
                >
                  History
                </Link>
                <Link
                  className={`workspace-nav-link ${activeView === "analysis" ? "active" : ""}`}
                  href={buildWorkspaceHref("analysis", { chat: currentConversationId })}
                >
                  Analysis
                </Link>
              </nav>
            ) : null}
          </div>

          <div className="workspace-topbar-right">
            {!needsSetup ? (
              <>
                <label className="workspace-search">
                  <span className="workspace-search-icon" aria-hidden="true">
                    ⌕
                  </span>
                  <input placeholder="Search markets..." type="text" />
                </label>
                <button
                  aria-label="Workspace settings"
                  className="workspace-icon-button"
                  type="button"
                >
                  ⚙
                </button>
                <NotificationBell initialNotifications={workspace.notifications} />
              </>
            ) : null}
            <form action={signOutAction}>
              <button className="ghost-button workspace-logout-button" type="submit">
                Log out
              </button>
            </form>
            {!needsSetup ? (
              <div className="workspace-avatar" aria-hidden="true">
                {userInitial}
              </div>
            ) : null}
          </div>
        </div>
        {!needsSetup && activeView === "desk" ? (
          <MarketHoverStrip introDelayMs={7600} userTickers={userTickers} />
        ) : null}
      </header>

      <main className={`workspace-shell-main ${needsSetup ? "setup-state" : ""}`}>
        {needsSetup ? (
          <section className="workspace-setup-panel">
            <section className="workspace-setup-card name-capture-card">
              <p className="chat-kicker">One quick setup step</p>
              <h3>What should trAIder call you?</h3>
              <p className="name-capture-copy">
                This is only used to personalize your coaching and workspace. You only have to set
                it once.
              </p>
              <form className="name-capture-form" action={saveDisplayNameAction}>
                <label className="field">
                  <span>Your name</span>
                  <input
                    name="display_name"
                    type="text"
                    placeholder="Taylor"
                    autoComplete="name"
                    required
                  />
                </label>

                {message ? <p className="auth-feedback">{message}</p> : null}

                <button className="primary-button" type="submit">
                  Continue to my desk
                </button>
              </form>
            </section>
          </section>
        ) : (
          <>
            {activeView === "desk" ? (
              <ChatWorkspace
                key={`${workspace.conversationId ?? "new-chat"}-${searchParams?.starter ?? "none"}-${searchParams?.signedIn ?? "steady"}`}
                deskTitle={workspace.deskTitle}
                initialConversationSummaries={workspace.conversations}
                initialConversationId={workspace.conversationId}
                initialDraftMessage={initialDraftMessage}
                initialIntro={workspace.workspaceIntro}
                initialIntroTimestamp={new Date().toISOString()}
                initialMessages={workspace.messages}
                initialProfile={workspace.profile}
                initialShowHero={searchParams?.signedIn === "1"}
                userName={workspace.userName}
              />
            ) : null}

            {activeView === "history" ? (
              <WorkspaceHistoryPanel
                activeConversationId={workspace.conversationId}
                conversations={workspace.conversations}
              />
            ) : null}

            {activeView === "analysis" ? (
              <WorkspaceAnalysisPanel
                activeConversationId={workspace.conversationId}
                conversations={workspace.conversations}
                messages={workspace.messages}
                profile={workspace.profile}
                tradeCalendarEntries={workspace.tradeCalendarEntries}
                userName={workspace.userName}
              />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
