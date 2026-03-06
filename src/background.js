// Service worker for Duragent Browser Bridge
// All HTTP requests go through here to bypass CORS.

// --- Setup & event listeners ---

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "api") {
    handleApiRequest(msg).then(sendResponse);
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sse-stream") return;

  let controller = null;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === "start") {
      controller = new AbortController();
      streamSSE(port, msg.sessionId, msg.content, controller.signal);
    } else if (msg.type === "abort") {
      controller?.abort();
    }
  });

  port.onDisconnect.addListener(() => {
    controller?.abort();
  });
});

// --- Handlers ---

async function handleApiRequest({ method, path, body }) {
  const baseUrl = await getBaseUrl();
  try {
    const opts = { method: method || "GET" };
    if (body) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${path}`, opts);
    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const data = isJson ? await res.json().catch(() => null) : await res.text();
    if (!res.ok) {
      const detail = isJson ? data?.detail : data;
      return { ok: false, status: res.status, error: detail || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function streamSSE(port, sessionId, content, signal) {
  const baseUrl = await getBaseUrl();
  try {
    const res = await fetch(
      `${baseUrl}/api/v1/sessions/${sessionId}/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal,
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      safeSend(port, {
        type: "error",
        message: err.detail || `Stream request failed: ${res.status}`,
      });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = null;
    let dataLines = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        } else if (line === "") {
          // Empty line dispatches the accumulated event (per SSE spec)
          if (dataLines.length > 0) {
            const raw = dataLines.join("\n");
            try {
              const data = JSON.parse(raw);
              safeSend(port, { type: eventType || "message", data });
            } catch {
              // skip malformed JSON
            }
          }
          eventType = null;
          dataLines = [];
        }
      }
    }

    safeSend(port, { type: "stream_end" });
  } catch (err) {
    if (err.name !== "AbortError") {
      safeSend(port, { type: "error", message: err.message });
    }
  }
}

// --- Helpers ---

function safeSend(port, msg) {
  try {
    port.postMessage(msg);
  } catch {
    // Port disconnected — side panel closed mid-stream
  }
}

async function getBaseUrl() {
  const stored = await chrome.storage.local.get("duragentUrl");
  return (stored.duragentUrl || "http://localhost:8080").replace(/\/$/, "");
}
