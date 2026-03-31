const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const displayNameInput = document.getElementById("display-name");
const authTabs = document.querySelectorAll(".auth-tab");
const authFeedback = document.getElementById("auth-feedback");
const authSubmit = document.getElementById("auth-submit");

let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  authForm.dataset.mode = mode;
  authTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.mode === mode);
  });
  authFeedback.textContent = "";
  authSubmit.textContent = mode === "login" ? "Continue to trAIder" : "Create account";
}

async function checkBootstrap() {
  const response = await fetch("/api/bootstrap");
  const data = await response.json();
  if (data.authenticated) {
    window.location.href = "/app";
  }
}

async function submitAuth(event) {
  event.preventDefault();
  authFeedback.textContent = "";
  authSubmit.disabled = true;

  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: authEmail.value.trim(),
        password: authPassword.value,
        display_name: displayNameInput.value.trim(),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Unable to continue.");
    }

    window.location.href = "/app";
  } catch (error) {
    authFeedback.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
}

authForm.addEventListener("submit", submitAuth);

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => setAuthMode(tab.dataset.mode));
});

checkBootstrap().catch(() => {
  authFeedback.textContent = "I couldn't load the sign-in screen yet. Try refreshing.";
});
