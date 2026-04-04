import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getWorkspaceState } from "@/lib/data";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
  const activeView =
    searchParams?.view === "history" || searchParams?.view === "analysis"
      ? searchParams.view
      : "desk";
  const initialDraftMessage = searchParams?.starter ? STARTER_PROMPTS[searchParams.starter] ?? null : null;

  return (
    <WorkspaceShell
      initialActiveView={activeView}
      initialDraftMessage={initialDraftMessage}
      initialMessage={searchParams?.message}
      initialShowHero={searchParams?.signedIn === "1"}
      workspace={workspace}
    />
  );
}
