import { NextResponse } from "next/server";
import { ensureProfile } from "@/lib/data";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");
  const destination =
    next && next.startsWith("/") && !next.startsWith("//") ? new URL(next, requestUrl.origin) : new URL("/workspace", requestUrl.origin);

  if (!code) {
    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set("message", "That sign-in link is missing a code. Request a new one.");
    return NextResponse.redirect(loginUrl);
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    const loginUrl = new URL("/login", requestUrl.origin);
    loginUrl.searchParams.set(
      "message",
      error?.message ?? "That sign-in link could not be verified. Request a new one."
    );
    return NextResponse.redirect(loginUrl);
  }

  await ensureProfile(supabase, data.user);
  if (destination.pathname === "/workspace") {
    destination.searchParams.delete("chat");
    destination.searchParams.set("new", "1");
    destination.searchParams.set("signedIn", "1");
  }

  return NextResponse.redirect(destination);
}
