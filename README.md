# Proxied Browser

Chromium extension that routes traffic through a proxy and automatically spoofs your browser's timezone to match the proxy's geographic location — defeating common proxy/VPN detection checks.

## Features

- **Automatic timezone spoofing** — detects proxy location via GeoIP, overrides `Date`, `Intl.DateTimeFormat`, Workers, and iframes
- **Proxy authentication** — handles HTTP/HTTPS proxy auth challenges automatically
- **WebRTC leak prevention** — blocks non-proxied UDP to prevent IP leaks
- **`Function.prototype.toString` spoofing** — patched APIs return `[native code]` to avoid fingerprint detection
- **Two modes** — install as a standalone extension with popup UI, or launch ephemeral sessions via `launch.bat`

## Install

### Standalone Extension

1. Clone this repo
2. Open `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `proxy-extension` folder
5. Click the extension icon → enter proxy details → **Save & Apply**

### Launch Script (Ephemeral Sessions)

For one-off sessions with a temporary browser profile that's cleaned up on exit:

```
launch.bat [protocol://]host:port:user:pass [url]
```

Examples:
```
launch.bat http://proxy.example.com:8080:user:pass
launch.bat socks5://proxy.example.com:1080:user:pass https://example.com
```

Set `BROWSER` env var to override the default browser path (defaults to Brave).

SOCKS5 with authentication requires [gost](https://github.com/go-gost/gost/releases) — place `gost.exe` next to `launch.bat`. It spins up a local HTTP relay automatically.

## Supported Protocols

| Protocol | Auth | Notes |
|----------|------|-------|
| HTTP | Yes | Recommended for standalone mode |
| HTTPS | Yes | |
| SOCKS4 | No | |
| SOCKS5 | No | Chrome limitation — use `launch.bat` with gost for SOCKS5+auth |

## How It Works

**Proxy** — configured via `chrome.proxy.settings` API with credentials supplied through `webRequest.onAuthRequired`.

**Timezone** — on proxy enable, the background service worker fetches the proxy's timezone from [ip-api.com](http://ip-api.com). On each page navigation, it injects the timezone into the page's main world via `chrome.scripting.executeScript`, where `tz-inject.js` patches all Date/Intl APIs to report the spoofed timezone. A setter-trap fallback handles race conditions.

**WebRTC** — `chrome.privacy.network.webRTCIPHandlingPolicy` is set to `disable_non_proxied_udp`.

## Project Structure

```
proxy-extension/
  manifest.json     Manifest V3 config
  background.js     Service worker — proxy, timezone detection, popup messaging
  tz-config.js      Sets initial timezone value (overwritten by launch.bat)
  tz-inject.js      MAIN world script — patches Date/Intl/Workers/iframes
  popup.html        Extension popup UI
  popup.js          Popup logic
  config.json       Proxy config placeholder (written by launch.bat)
launch.bat          Ephemeral session launcher (Windows)
```
