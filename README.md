# Smart Proxy Switcher

Chromium extension that routes traffic through a proxy and automatically spoofs your browser's timezone to match the proxy's geographic location — defeating common proxy/VPN detection checks.

<div align="center">
  <img src="assets/ui.png" alt="Popup UI" width="300">
</div>

## Features

- **Automatic timezone spoofing** — detects proxy location via GeoIP, overrides `Date`, `Intl.DateTimeFormat`, Workers, and iframes
- **Proxy authentication** — handles HTTP/HTTPS proxy auth challenges automatically
- **WebRTC leak prevention** — blocks non-proxied UDP to prevent IP leaks
- **`Function.prototype.toString` spoofing** — patched APIs return `[native code]` to avoid fingerprint detection

## Install

1. Clone this repo
2. Open `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `proxy-extension` folder
5. Click the extension icon → enter proxy details → **Save & Apply**

## Supported Protocols

| Protocol | Auth | Notes |
|----------|------|-------|
| HTTP | Yes | Recommended |
| HTTPS | Yes | |
| SOCKS4 | No | |
| SOCKS5 | No | Chrome limitation — no SOCKS5 auth support |

## How It Works

**Proxy** — configured via `chrome.proxy.settings` API with credentials supplied through `webRequest.onAuthRequired`.

**Timezone** — on proxy enable, the background service worker fetches the proxy's timezone from [ipapi.is](https://ipapi.is) (falling back to [ip-api.com](http://ip-api.com)). On each page navigation, it injects the timezone into the page's main world via `chrome.scripting.executeScript`, where `tz-inject.js` patches all Date/Intl APIs to report the spoofed timezone. A setter-trap fallback handles race conditions.

**WebRTC** — `chrome.privacy.network.webRTCIPHandlingPolicy` is set to `disable_non_proxied_udp`.