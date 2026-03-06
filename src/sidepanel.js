// Side panel chat UI controller

const STORAGE_KEYS = {
  duragentUrl: "duragentUrl",
  agentName: "agentName",
  sessionId: "sessionId",
};

const DEFAULT_URL = "http://localhost:8080";

let client = null;
let sessionId = null;
let activeStream = null;

// --- DOM refs ---

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const duragentUrlInput = document.getElementById("duragent-url");
const agentSelect = document.getElementById("agent-select");
const settingsSave = document.getElementById("settings-save");
const newSessionBtn = document.getElementById("new-session-btn");
const messagesContainer = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

// --- Init (entry point) ---

async function init() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.duragentUrl,
    STORAGE_KEYS.agentName,
    STORAGE_KEYS.sessionId,
  ]);

  const baseUrl = stored[STORAGE_KEYS.duragentUrl] || DEFAULT_URL;
  duragentUrlInput.value = baseUrl;
  sessionId = stored[STORAGE_KEYS.sessionId] || null;

  client = new DuragentClient();

  const connected = await checkConnection();
  if (!connected) {
    addSystemMessage(
      "Cannot reach Duragent. Check that the server is running and the URL is correct."
    );
    return;
  }

  const agents = await loadAgents();
  if (agents.length === 0) {
    addSystemMessage("No agents found. Deploy an agent to Duragent first.");
    return;
  }

  const savedAgent = stored[STORAGE_KEYS.agentName];
  if (savedAgent && agents.some((a) => a.name === savedAgent)) {
    agentSelect.value = savedAgent;
  }

  await ensureSession();
}

// --- Connection ---

async function checkConnection() {
  try {
    const ok = await client.checkHealth();
    if (ok) {
      setStatus("connected", "Connected to Duragent");
      return true;
    }
  } catch {
    // fall through
  }
  setStatus("error", "Disconnected");
  return false;
}

async function loadAgents() {
  try {
    const agents = await client.listAgents();
    agentSelect.innerHTML = "";
    for (const agent of agents) {
      const opt = document.createElement("option");
      opt.value = agent.name;
      opt.textContent = agent.description
        ? `${agent.name} — ${agent.description}`
        : agent.name;
      agentSelect.appendChild(opt);
    }
    return agents;
  } catch {
    agentSelect.innerHTML = '<option value="">Failed to load agents</option>';
    return [];
  }
}

// --- Session management ---

async function ensureSession() {
  const agentName = agentSelect.value;
  if (!agentName) {
    addSystemMessage("No agent selected. Open settings to choose one.");
    return false;
  }

  if (sessionId) {
    const session = await client.getSession(sessionId);
    if (session) {
      addSystemMessage(`Resumed session with ${session.agent}`);
      await loadHistory();
      return true;
    }
    sessionId = null;
    await chrome.storage.local.remove(STORAGE_KEYS.sessionId);
  }

  try {
    const session = await client.createSession(agentName);
    sessionId = session.session_id;
    await chrome.storage.local.set({
      [STORAGE_KEYS.sessionId]: sessionId,
    });
    addSystemMessage(`New session with ${session.agent}`);
    return true;
  } catch (err) {
    addSystemMessage(`Failed to create session: ${err.message}`);
    return false;
  }
}

async function loadHistory() {
  const messages = await client.getMessages(sessionId);
  messagesContainer.innerHTML = "";
  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      addMessage(msg.role, msg.content);
    }
  }
  scrollToBottom();
}

// --- Chat ---

async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || activeStream) return;

  if (!sessionId) {
    const ok = await ensureSession();
    if (!ok) return;
  }

  addMessage("user", content);
  messageInput.value = "";
  messageInput.style.height = "auto";
  scrollToBottom();

  const assistantEl = addMessage("assistant", "");
  let accumulated = "";

  sendBtn.disabled = true;

  activeStream = client.streamMessage(sessionId, content, {
    onStart() {},

    onToken(text) {
      accumulated += text;
      assistantEl.textContent = accumulated;
      scrollToBottom();
    },

    onDone() {
      activeStream = null;
      sendBtn.disabled = false;
      if (!accumulated) {
        assistantEl.remove();
      }
    },

    onError(message) {
      activeStream = null;
      sendBtn.disabled = false;
      if (!accumulated) {
        assistantEl.remove();
      }
      addSystemMessage(`Error: ${message}`);
      scrollToBottom();
    },
  });
}

// --- DOM helpers ---

function setStatus(state, text) {
  statusDot.className = state;
  statusText.textContent = text;
}

function addMessage(role, content) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  el.textContent = content;
  messagesContainer.appendChild(el);
  return el;
}

function addSystemMessage(text) {
  const el = document.createElement("div");
  el.className = "message system";
  el.textContent = text;
  messagesContainer.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  const chat = document.getElementById("chat-container");
  chat.scrollTop = chat.scrollHeight;
}

function isLocalhostUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

// --- Event listeners ---

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

settingsSave.addEventListener("click", async () => {
  const url = duragentUrlInput.value.trim() || DEFAULT_URL;
  const agent = agentSelect.value;

  const needsPermission = !isLocalhostUrl(url);
  if (needsPermission) {
    const origin = new URL(url).origin + "/*";
    const granted = await chrome.permissions.request({
      origins: [origin],
    });
    if (!granted) {
      addSystemMessage("Permission denied. Cannot connect to remote server.");
      return;
    }
  }

  const stored = await chrome.storage.local.get(STORAGE_KEYS.agentName);
  const agentChanged = agent !== stored[STORAGE_KEYS.agentName];

  await chrome.storage.local.set({
    [STORAGE_KEYS.duragentUrl]: url,
    [STORAGE_KEYS.agentName]: agent,
  });

  if (agentChanged) {
    await chrome.storage.local.remove(STORAGE_KEYS.sessionId);
    sessionId = null;
    messagesContainer.innerHTML = "";
  }

  settingsPanel.classList.add("hidden");
  await init();
});

newSessionBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove(STORAGE_KEYS.sessionId);
  sessionId = null;
  messagesContainer.innerHTML = "";
  settingsPanel.classList.add("hidden");
  await ensureSession();
});

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);

// --- Start ---

init();
