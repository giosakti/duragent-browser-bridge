// WebSocket RPC handler for the browser bridge.
// Connects to Duragent and handles browser control commands.

let bridgeWs = null;
let bridgeReconnectTimer = null;
let bridgePingTimer = null;

async function connectBridge() {
  const baseUrl = await getBaseUrl();
  const wsUrl = baseUrl.replace(/^http/, "ws") + "/ws/browser-bridge";

  try {
    bridgeWs = new WebSocket(wsUrl);
  } catch (err) {
    console.log("[bridge] WebSocket construction failed:", err.message);
    scheduleBridgeReconnect();
    return;
  }

  bridgeWs.onopen = () => {
    console.log("[bridge] Connected to", wsUrl);
    bridgeWs.send(JSON.stringify({ type: "hello", version: "0.1.0" }));
    startBridgePing();
  };

  bridgeWs.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "pong") return;

    if (msg.type === "rpc") {
      handleRpc(msg).then((response) => {
        if (bridgeWs?.readyState === WebSocket.OPEN) {
          bridgeWs.send(JSON.stringify(response));
        }
      });
    }
  };

  bridgeWs.onclose = () => {
    console.log("[bridge] Disconnected");
    stopBridgePing();
    bridgeWs = null;
    scheduleBridgeReconnect();
  };

  bridgeWs.onerror = () => {
    // onclose will fire after onerror, so we just log here
    console.log("[bridge] WebSocket error");
  };
}

function scheduleBridgeReconnect() {
  if (bridgeReconnectTimer) return;
  bridgeReconnectTimer = setTimeout(() => {
    bridgeReconnectTimer = null;
    connectBridge();
  }, 5000);
}

function startBridgePing() {
  stopBridgePing();
  bridgePingTimer = setInterval(() => {
    if (bridgeWs?.readyState === WebSocket.OPEN) {
      bridgeWs.send(JSON.stringify({ type: "ping" }));
    }
  }, 25000);
}

function stopBridgePing() {
  if (bridgePingTimer) {
    clearInterval(bridgePingTimer);
    bridgePingTimer = null;
  }
}

// ── RPC dispatch ─────────────────────────────────────────────────────

async function handleRpc(msg) {
  const { id, cmd, args } = msg;
  try {
    const result = await dispatchCommand(cmd, args || {});
    return { type: "rpc_result", id, success: true, result };
  } catch (err) {
    return {
      type: "rpc_result",
      id,
      success: false,
      error: {
        code: err.code || "INTERNAL",
        message: err.message || String(err),
      },
    };
  }
}

async function dispatchCommand(cmd, args) {
  switch (cmd) {
    case "snapshot":
      return await cmdSnapshot(args);
    case "getPageInfo":
      return await cmdGetPageInfo(args);
    case "listTabs":
      return await cmdListTabs();
    case "attach":
      return await cmdAttach(args);
    case "detach":
      return await cmdDetach(args);
    default:
      throw { code: "UNKNOWN_CMD", message: `Unknown command: ${cmd}` };
  }
}

// ── Command handlers ─────────────────────────────────────────────────

async function cmdSnapshot(args) {
  const tabId = await resolveTabId(args.tabId);

  // Auto-attach if not already
  if (!attachedTabs.has(tabId)) {
    await cdpAttach(tabId);
  }

  const tab = await chrome.tabs.get(tabId);
  const mode = args.mode || "interactive";
  const snapshot = await takeSnapshot(tabId, mode);

  return {
    title: tab.title || "(untitled)",
    url: tab.url || "(unknown)",
    nodes: snapshot.nodes,
    focusedRef: snapshot.focusedRef,
  };
}

async function cmdGetPageInfo(args) {
  const tabId = await resolveTabId(args.tabId);
  const tab = await chrome.tabs.get(tabId);
  return {
    tabId: tab.id,
    title: tab.title,
    url: tab.url,
    status: tab.status,
  };
}

async function cmdListTabs() {
  const tabs = await chrome.tabs.query({});
  return {
    tabs: tabs.map((t) => ({
      tabId: t.id,
      title: t.title,
      url: t.url,
      active: t.active,
      windowId: t.windowId,
    })),
  };
}

async function cmdAttach(args) {
  const tabId = await resolveTabId(args.tabId);
  await cdpAttach(tabId);
  return { tabId, attached: true };
}

async function cmdDetach(args) {
  const tabId = await resolveTabId(args.tabId);
  await cdpDetach(tabId);
  return { tabId, attached: false };
}

// ── Helpers ──────────────────────────────────────────────────────────

async function resolveTabId(tabId) {
  if (tabId) return tabId;

  // Service workers have no window context, so use lastFocusedWindow
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw { code: "NO_ACTIVE_TAB", message: "No active tab found" };
  return tab.id;
}
