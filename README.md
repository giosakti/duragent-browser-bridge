# Duragent Browser Bridge

Chrome extension that connects to [Duragent](https://github.com/giosakti/duragent) via a sidebar chat panel. Talk to your AI agent about the page you're viewing.

## Setup

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this directory
4. Click the extension icon to open the side panel

## Configuration

Open the settings panel (gear icon) to configure:

- **Duragent URL** — defaults to `http://localhost:8080`
- **Agent** — select from agents loaded in Duragent

## Requirements

- Chrome 116+ (side panel API)
- A running [Duragent](https://github.com/giosakti/duragent) server with at least one agent deployed

## Architecture

All HTTP requests are routed through the MV3 service worker to bypass CORS. The side panel communicates with the service worker via `chrome.runtime.sendMessage` (API calls) and `chrome.runtime.connect` (SSE streaming).

```
Side Panel  ──chrome.runtime──►  Service Worker  ──fetch──►  Duragent
  (chat UI)                      (CORS-free proxy)            (HTTP API)
```
