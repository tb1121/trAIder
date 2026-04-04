"use client";

import { useEffect, useState } from "react";
import { saveDisplayNameAction, signOutAction } from "@/app/auth-actions";
import { ChatWorkspace } from "@/components/chat-workspace";
import { LogoMark } from "@/components/logo-mark";
import { MarketHoverStrip } from "@/components/market-hover-strip";
import { NotificationBell } from "@/components/notification-bell";
import { WorkspaceAnalysisPanel, WorkspaceHistoryPanel } from "@/components/workspace-panels";
import type { WorkspaceState } from "@/lib/data";
import { parseTickerList } from "@/lib/market";
import type { TradingProfile } from "@/lib/coach";
import type { TradeCalendarEntry } from "@/lib/trade-calendar";

type WorkspaceView = "desk" | "history" | "analysis";

type WorkspaceShellProps = {
  initialActiveView: WorkspaceView;
  initialDraftMessage: string | null;
  initialMessage: string | undefined;
  initialShowHero: boolean;
  workspace: WorkspaceState;
};

type WorkspaceSyncEventDetail = {
  conversationId: string;
  conversationSummary: WorkspaceState["conversations"][number];
  profile: TradingProfile;
  tradeCalendarEntry: TradeCalendarEntry | null;
  userName: string;
};

function buildWorkspaceHref(
  view: WorkspaceView,
  options?: {
    chat?: string | null;
  }
) {
  const search = new URLSearchParams();
  if (view !== "desk") {
    search.set("view", view);
  }
  if (options?.chat) {
    search.set("chat", options.chat);
  }

  const query = search.toString();
  return query ? `/workspace?${query}` : "/workspace";
}

function readViewFromLocation(): WorkspaceView {
  if (typeof window === "undefined") {
    return "desk";
  }

  const search = new URLSearchParams(window.location.search);
  const value = search.get("view");
  return value === "history" || value === "analysis" ? value : "desk";
}

export function WorkspaceShell({
  initialActiveView,
  initialDraftMessage,
  initialMessage,
  initialShowHero,
  workspace
}: WorkspaceShellProps) {
  const [deskSeed, setDeskSeed] = useState(() => ({
    conversationId: workspace.conversationId,
    draftMessage: initialDraftMessage,
    intro: workspace.workspaceIntro,
    messages: workspace.messages,
    resetKey: 0,
    showHero: initialShowHero
  }));
  const [activeView, setActiveView] = useState<WorkspaceView>(initialActiveView);
  const [workspaceConversationSummaries, setWorkspaceConversationSummaries] = useState(
    workspace.conversations
  );
  const [workspaceConversationId, setWorkspaceConversationId] = useState(workspace.conversationId);
  const [workspaceProfile, setWorkspaceProfile] = useState(workspace.profile);
  const [workspaceTradeCalendarEntries, setWorkspaceTradeCalendarEntries] = useState(
    workspace.tradeCalendarEntries
  );
  const [workspaceUserName, setWorkspaceUserName] = useState(workspace.userName);
  const deskViewKey = `desk-${deskSeed.resetKey}`;
  const needsSetup = workspace.needsDisplayName;
  const userInitial = workspaceUserName.trim().charAt(0).toUpperCase() || "T";
  const userTickers = parseTickerList(workspaceProfile.focus_tickers);
  const currentConversationId = workspaceConversationId;

  useEffect(() => {
    setActiveView(initialActiveView);
  }, [initialActiveView]);

  useEffect(() => {
    setWorkspaceConversationSummaries(workspace.conversations);
    setWorkspaceConversationId(workspace.conversationId);
    setWorkspaceProfile(workspace.profile);
    setWorkspaceTradeCalendarEntries(workspace.tradeCalendarEntries);
    setWorkspaceUserName(workspace.userName);
    setDeskSeed((current) => {
      const shouldResetDesk =
        current.conversationId !== workspace.conversationId ||
        current.draftMessage !== initialDraftMessage ||
        current.showHero !== initialShowHero ||
        current.messages.length !== workspace.messages.length ||
        current.messages[0]?.createdAt !== workspace.messages[0]?.createdAt;

      if (!shouldResetDesk) {
        return current;
      }

      return {
        conversationId: workspace.conversationId,
        draftMessage: initialDraftMessage,
        intro: workspace.workspaceIntro,
        messages: workspace.messages,
        resetKey: current.resetKey + 1,
        showHero: initialShowHero
      };
    });
  }, [workspace]);

  useEffect(() => {
    function handlePopState() {
      setActiveView(readViewFromLocation());
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    function handleWorkspaceSync(event: Event) {
      const detail = (event as CustomEvent<WorkspaceSyncEventDetail>).detail;
      if (!detail) {
        return;
      }

      setWorkspaceConversationId(detail.conversationId);
      setWorkspaceConversationSummaries((current) => {
        const next = current.filter((entry) => entry.id !== detail.conversationSummary.id);
        return [detail.conversationSummary, ...next].sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
      });
      setWorkspaceProfile(detail.profile);
      setWorkspaceUserName(detail.userName);
      if (detail.tradeCalendarEntry) {
        const nextEntry = detail.tradeCalendarEntry;
        setWorkspaceTradeCalendarEntries((current) => {
          const next = current.filter((entry) => entry.id !== nextEntry.id);
          return [nextEntry, ...next].sort((left, right) => {
            const tradedOnCompare = right.tradedOn.localeCompare(left.tradedOn);
            if (tradedOnCompare !== 0) {
              return tradedOnCompare;
            }

            return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
          });
        });
      }
    }

    window.addEventListener("trader:workspace:sync", handleWorkspaceSync as EventListener);
    return () => {
      window.removeEventListener("trader:workspace:sync", handleWorkspaceSync as EventListener);
    };
  }, []);

  function switchView(nextView: WorkspaceView) {
    if (nextView === activeView) {
      return;
    }

    setActiveView(nextView);
    if (typeof window !== "undefined") {
      const nextUrl = buildWorkspaceHref(nextView, { chat: currentConversationId });
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }

  function startNewChat() {
    setActiveView("desk");
    setWorkspaceConversationId(null);
    setDeskSeed((current) => ({
      conversationId: null,
      draftMessage: null,
      intro: workspace.workspaceIntro,
      messages: [],
      resetKey: current.resetKey + 1,
      showHero: false
    }));
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", "/workspace?new=1");
    }
  }

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
            ) : (
              <button
                aria-controls="thread-drawer"
                aria-expanded={activeView === "desk" ? "false" : undefined}
                aria-label={activeView === "desk" ? "Open coaching threads" : "Return to the desk"}
                className="workspace-brand-button"
                onClick={() => switchView("desk")}
                type="button"
              >
                <LogoMark as="span" className="workspace-brand" variant="nav" />
              </button>
            )}
            {!needsSetup ? (
              <nav className="workspace-nav" aria-label="Workspace sections">
                <button
                  className={`workspace-nav-link ${activeView === "desk" ? "active" : ""}`}
                  onClick={() => switchView("desk")}
                  type="button"
                >
                  The Desk
                </button>
                <button
                  className={`workspace-nav-link ${activeView === "history" ? "active" : ""}`}
                  onClick={() => switchView("history")}
                  type="button"
                >
                  History
                </button>
                <button
                  className={`workspace-nav-link ${activeView === "analysis" ? "active" : ""}`}
                  onClick={() => switchView("analysis")}
                  type="button"
                >
                  Analysis
                </button>
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

                {initialMessage ? <p className="auth-feedback">{initialMessage}</p> : null}

                <button className="primary-button" type="submit">
                  Continue to my desk
                </button>
              </form>
            </section>
          </section>
        ) : (
          <>
            <div
              aria-hidden={activeView !== "desk"}
              className={`workspace-view-panel ${activeView === "desk" ? "active" : ""}`}
              hidden={activeView !== "desk"}
            >
              <ChatWorkspace
                key={deskViewKey}
                deskTitle={workspace.deskTitle}
                initialConversationSummaries={workspaceConversationSummaries}
                initialConversationId={deskSeed.conversationId}
                initialDraftMessage={deskSeed.draftMessage}
                initialIntro={deskSeed.intro}
                initialIntroTimestamp={new Date().toISOString()}
                initialMessages={deskSeed.messages}
                onStartNewChat={startNewChat}
                initialProfile={workspaceProfile}
                initialShowHero={deskSeed.showHero}
                userName={workspaceUserName}
              />
            </div>

            <div
              aria-hidden={activeView !== "history"}
              className={`workspace-view-panel ${activeView === "history" ? "active" : ""}`}
              hidden={activeView !== "history"}
            >
              <WorkspaceHistoryPanel
                activeConversationId={workspaceConversationId}
                conversations={workspaceConversationSummaries}
              />
            </div>

            <div
              aria-hidden={activeView !== "analysis"}
              className={`workspace-view-panel ${activeView === "analysis" ? "active" : ""}`}
              hidden={activeView !== "analysis"}
            >
              <WorkspaceAnalysisPanel
                activeConversationId={workspaceConversationId}
                conversations={workspaceConversationSummaries}
                messages={workspace.messages}
                profile={workspaceProfile}
                tradeCalendarEntries={workspaceTradeCalendarEntries}
                userName={workspaceUserName}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
