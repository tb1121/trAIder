const form = document.getElementById("chat-form");
const messageInput = document.getElementById("message");
const attachmentInput = document.getElementById("attachment");
const messagesEl = document.getElementById("messages");
const sendButton = document.getElementById("send-button");
const profilePills = document.getElementById("profile-pills");
const promptButtons = document.querySelectorAll(".prompt-chip");
const deskUser = document.getElementById("desk-user");
const initialBootstrap = window.__TRAIDER_BOOTSTRAP__ ?? null;

let sessionId = null;
const emptyProfile = {
  experience_level: null,
  preferred_assets: null,
  strategy_style: null,
  risk_tolerance: null,
  trading_goal: null,
};

function addMessage(role, content) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = content;
  article.appendChild(paragraph);
  messagesEl.appendChild(article);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function clearMessages() {
  messagesEl.innerHTML = "";
}

function defaultIntro(data) {
  return (
    data.workspace_intro ||
    (data.user?.display_name
      ? `${data.user.display_name}, I'm trAIder, your AI trading coach. Send a setup, screenshot, trade idea, or question and I'll help you think through it clearly.`
      : "I'm trAIder, your AI trading coach. Send a setup, screenshot, trade idea, or question and I'll help you think through it clearly.")
  );
}

function renderMessages(data) {
  const messages = data.messages ?? [];
  clearMessages();
  if (!messages.length) {
    addMessage("assistant", defaultIntro(data));
    return;
  }

  messages.forEach((message) => addMessage(message.role, message.content));
}

function renderProfile(profile) {
  profilePills.innerHTML = "";
  const entries = Object.entries(profile).filter(([, value]) => Boolean(value));
  entries.forEach(([key, value]) => {
    const pill = document.createElement("span");
    pill.className = "profile-pill";
    pill.textContent = `${key.replaceAll("_", " ")}: ${value}`;
    profilePills.appendChild(pill);
  });
}

function applyBootstrap(data) {
  if (!data.authenticated) {
    window.location.href = "/";
    return;
  }

  sessionId = data.session_id ?? null;
  deskUser.textContent = data.user ? `Signed in as ${data.user.display_name}` : "Signed in";
  renderProfile(data.profile ?? emptyProfile);
  renderMessages(data);
}

async function submitMessage(event) {
  event.preventDefault();
  const text = messageInput.value.trim();
  const file = attachmentInput.files[0];
  if (!text && !file) {
    return;
  }

  addMessage("user", text || `Uploaded ${file.name}`);
  sendButton.disabled = true;
  sendButton.textContent = "Thinking...";

  const body = new FormData();
  body.append("message", text || "Please review my upload.");
  if (sessionId) {
    body.append("session_id", sessionId);
  }
  if (file) {
    body.append("attachment", file);
  }

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      body,
    });

    if (response.status === 401) {
      window.location.href = "/";
      return;
    }

    if (!response.ok) {
      throw new Error("Request failed");
    }

    const data = await response.json();
    sessionId = data.session_id;
    addMessage("assistant", data.assistant_message);
    renderProfile(data.profile);
    messageInput.value = "";
    attachmentInput.value = "";
  } catch (error) {
    addMessage(
      "assistant",
      error.message || "I hit a connection issue on my side. Try again and I'll pick the thread back up."
    );
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "Coach me";
  }
}

form.addEventListener("submit", submitMessage);

promptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    messageInput.value = button.dataset.prompt;
    messageInput.focus();
  });
});

if (initialBootstrap) {
  applyBootstrap(initialBootstrap);
} else {
  messagesEl.innerHTML = "";
  addMessage("assistant", "I couldn't load your workspace yet. Try refreshing.");
}
