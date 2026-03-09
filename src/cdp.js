// Chrome DevTools Protocol helpers for the browser bridge.

const CDP_VERSION = "1.3";
const attachedTabs = new Set();

async function cdpAttach(tabId) {
  if (attachedTabs.has(tabId)) return;

  await chrome.debugger.attach({ tabId }, CDP_VERSION);
  attachedTabs.add(tabId);

  // Enable domains we need
  await cdpSend(tabId, "Page.enable");
  await cdpSend(tabId, "Accessibility.enable");
}

async function cdpDetach(tabId) {
  if (!attachedTabs.has(tabId)) return;

  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Already detached — ignore
  }
  attachedTabs.delete(tabId);
}

function cdpSend(tabId, method, params = {}) {
  if (!attachedTabs.has(tabId)) {
    throw { code: "NOT_ATTACHED", message: `Debugger not attached to tab ${tabId}` };
  }
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

// Clean up when Chrome detaches the debugger (user clicks "Cancel", tab closes, etc.)
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId) {
    attachedTabs.delete(source.tabId);
    console.log(`[cdp] Detached from tab ${source.tabId}: ${reason}`);
  }
});
