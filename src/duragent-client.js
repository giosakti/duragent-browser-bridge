// Duragent API client — routes all requests through the service worker to bypass CORS.

class DuragentClient {
  async #api(method, path, body) {
    const res = await chrome.runtime.sendMessage({
      type: "api",
      method,
      path,
      body,
    });
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }

  async checkHealth() {
    try {
      await this.#api("GET", "/readyz");
      return true;
    } catch {
      return false;
    }
  }

  async listAgents() {
    const data = await this.#api("GET", "/api/v1/agents");
    return data.agents;
  }

  async createSession(agentName) {
    return this.#api("POST", "/api/v1/sessions", { agent: agentName });
  }

  async getSession(sessionId) {
    try {
      return await this.#api("GET", `/api/v1/sessions/${sessionId}`);
    } catch {
      return null;
    }
  }

  async getMessages(sessionId) {
    try {
      const data = await this.#api(
        "GET",
        `/api/v1/sessions/${sessionId}/messages`
      );
      return data.messages || data;
    } catch {
      return [];
    }
  }

  streamMessage(sessionId, content, callbacks) {
    const port = chrome.runtime.connect({ name: "sse-stream" });
    let settled = false;

    function settle() {
      if (settled) return;
      settled = true;
      port.disconnect();
    }

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case "start":
          callbacks.onStart?.();
          break;
        case "token":
          callbacks.onToken?.(msg.data.content);
          break;
        case "done":
          settle();
          callbacks.onDone?.(msg.data);
          break;
        case "cancelled":
          settle();
          callbacks.onDone?.({ finish_reason: "cancelled" });
          break;
        case "error":
          settle();
          callbacks.onError?.(msg.message);
          break;
        case "stream_end":
          settle();
          callbacks.onDone?.({});
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      settle();
    });

    port.postMessage({ type: "start", sessionId, content });

    return {
      abort: () => {
        if (!settled) port.postMessage({ type: "abort" });
      },
    };
  }
}
