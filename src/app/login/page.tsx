import { redirect } from "next/navigation";
import { sendMagicLinkAction, signInWithGoogleAction } from "@/app/auth-actions";
import { LogoMark } from "@/components/logo-mark";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function LoginPage({
  searchParams
}: {
  searchParams?: { message?: string };
}) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/workspace");
  }

  const message = searchParams?.message;

  return (
    <div className="page-shell auth-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <main className="auth-layout">
        <section className="brand-panel">
          <p className="eyebrow">AI trading coach</p>
          <LogoMark as="h1" className="wordmark" variant="hero" />
          <p className="tagline">
            <span>simple.</span>
            <span>smart.</span>
            <span className="tagline-ai">AI</span>
            <span>powered.</span>
          </p>
          <p className="summary">
            A clean trading workspace that learns how you trade over time and coaches with
            structured context instead of generic chatbot memory.
          </p>
        </section>

        <section className="auth-card">
          <p className="eyebrow">Personal workspace</p>
          <h2 className="auth-title">Open your trading desk.</h2>
          <p className="auth-copy">
            Enter your email and we will send a secure sign-in link. If you are new, trAIder will
            ask what to call you after you land.
          </p>

          <form className="auth-form" action={sendMagicLinkAction}>
            <label className="field">
              <span>Email</span>
              <input
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>

            {message ? <p className="auth-feedback">{message}</p> : null}

            <div className="auth-actions">
              <button className="primary-button" type="submit">
                Continue with email
              </button>
            </div>
          </form>

          <div className="auth-divider" aria-hidden="true">
            <span className="auth-divider-line" />
            <span className="auth-divider-label">or sign in with Google</span>
            <span className="auth-divider-line" />
          </div>

          <form className="auth-oauth-form" action={signInWithGoogleAction}>
            <button className="ghost-button auth-google-button" type="submit">
              <span className="auth-google-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="presentation">
                  <path
                    d="M21.805 12.225c0-.74-.066-1.45-.19-2.13H12v4.032h5.488a4.695 4.695 0 0 1-2.037 3.082v2.56h3.296c1.93-1.776 3.058-4.394 3.058-7.544Z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 22c2.754 0 5.062-.914 6.75-2.474l-3.296-2.56c-.914.614-2.083.978-3.454.978-2.654 0-4.902-1.79-5.704-4.196H2.89v2.642A9.997 9.997 0 0 0 12 22Z"
                    fill="#34A853"
                  />
                  <path
                    d="M6.296 13.748A5.997 5.997 0 0 1 5.977 12c0-.608.11-1.196.319-1.748V7.61H2.89A9.996 9.996 0 0 0 2 12c0 1.61.386 3.135 1.072 4.39l3.224-2.642Z"
                    fill="#FBBC04"
                  />
                  <path
                    d="M12 6.056c1.498 0 2.842.516 3.9 1.53l2.924-2.924C17.058 3.02 14.75 2 12 2a9.997 9.997 0 0 0-9.11 5.61l3.406 2.642C7.098 7.846 9.346 6.056 12 6.056Z"
                    fill="#EA4335"
                  />
                </svg>
              </span>
              <span>Continue with Google</span>
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
