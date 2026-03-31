"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatDisplayNameCandidate } from "@/lib/display-name";
import { ensureProfile } from "@/lib/data";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function messageRedirect(message: string): never {
  redirect(`/login?message=${encodeURIComponent(message)}`);
}

function getField(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function getBaseUrl() {
  const headerStore = headers();
  const origin = headerStore.get("origin");
  if (origin) {
    return origin;
  }

  const forwardedHost = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (forwardedHost) {
    const protocol = headerStore.get("x-forwarded-proto") ?? "https";
    return `${protocol}://${forwardedHost}`;
  }

  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function sendMagicLinkAction(formData: FormData) {
  const email = getField(formData, "email").toLowerCase();

  if (!email) {
    messageRedirect("Enter your email to receive a magic link.");
  }

  const supabase = createServerSupabaseClient();
  const redirectTo = `${getBaseUrl()}/auth/callback?next=/workspace`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true
    }
  });

  if (error) {
    messageRedirect(error.message);
  }

  redirect(
    `/login?message=${encodeURIComponent(
      "Check your email for your secure sign-in link. New users are created automatically."
    )}`
  );
}

export async function signInWithGoogleAction() {
  const supabase = createServerSupabaseClient();
  const redirectTo = `${getBaseUrl()}/auth/callback?next=/workspace`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo
    }
  });

  if (error) {
    messageRedirect(error.message);
  }

  if (!data.url) {
    messageRedirect("Google sign-in is unavailable right now. Try email instead.");
  }

  redirect(data.url);
}

export async function saveDisplayNameAction(formData: FormData) {
  const displayName = formatDisplayNameCandidate(getField(formData, "display_name"));
  if (!displayName) {
    redirect("/workspace?message=Use a real first name or clean nickname.");
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  await ensureProfile(supabase, user);

  const updateProfile = await supabase
    .from("profiles")
    .update({
      display_name: displayName
    })
    .eq("user_id", user.id);

  if (updateProfile.error) {
    redirect(`/workspace?message=${encodeURIComponent(updateProfile.error.message)}`);
  }

  const { error } = await supabase.auth.updateUser({
    data: {
      display_name: displayName
    }
  });

  if (error) {
    redirect(`/workspace?message=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/workspace");
  redirect("/workspace?new=1&signedIn=1");
}

export async function signOutAction() {
  const supabase = createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
