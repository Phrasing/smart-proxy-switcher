let proxyUser = "";
let proxyPass = "";
let cachedTZ = null;

// --- Proxy management ---

async function applyProxy(settings) {
  const scheme = settings.protocol || "http";
  const schemeMap = { http: "http", https: "https", socks4: "socks4", socks5: "socks5" };

  await chrome.proxy.settings.set({
    value: {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: schemeMap[scheme] || "http",
          host: settings.host,
          port: parseInt(settings.port, 10),
        },
        bypassList: ["localhost", "127.0.0.1", "::1"],
      },
    },
    scope: "regular",
  });

  // Store credentials for onAuthRequired
  const isSocks = scheme.startsWith("socks");
  if (settings.user && settings.pass && !isSocks) {
    proxyUser = settings.user;
    proxyPass = settings.pass;
  } else {
    proxyUser = "";
    proxyPass = "";
  }

  // Prevent WebRTC IP leaks
  await chrome.privacy.network.webRTCIPHandlingPolicy.set({
    value: "disable_non_proxied_udp",
  });
}

async function clearProxy() {
  await chrome.proxy.settings.clear({ scope: "regular" });
  await chrome.privacy.network.webRTCIPHandlingPolicy.clear({ scope: "regular" });
  proxyUser = "";
  proxyPass = "";
  cachedTZ = null;
}

// --- Timezone detection ---

async function detectTimezone() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch("http://ip-api.com/json/?fields=timezone", {
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await resp.json();
      if (data.timezone && data.timezone.includes("/")) {
        cachedTZ = data.timezone;
        await chrome.storage.local.set({ proxyTZ: data.timezone });
        return data.timezone;
      }
    } catch (e) {
      // retry after delay
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

// --- Init ---

async function init() {
  try {
    // Load cached timezone for injection
    const tzData = await chrome.storage.local.get("proxyTZ");
    if (tzData.proxyTZ) cachedTZ = tzData.proxyTZ;

    // Check storage first (standalone mode / persisted settings)
    const stored = await chrome.storage.local.get(["proxySettings"]);

    if (stored.proxySettings && stored.proxySettings.host) {
      // Settings exist in storage — apply if enabled
      if (stored.proxySettings.enabled) {
        await applyProxy(stored.proxySettings);
      }
      return;
    }

    // Fall back to config.json (launch.bat mode)
    const resp = await fetch(chrome.runtime.getURL("config.json"));
    const cfg = await resp.json();

    if (!cfg.host) return; // empty config

    // Mirror launch.bat config into storage so popup can display it
    const settings = {
      protocol: cfg.protocol || "http",
      host: cfg.host,
      port: cfg.port,
      user: cfg.user || "",
      pass: cfg.pass || "",
      enabled: true,
    };
    await chrome.storage.local.set({ proxySettings: settings });
    await applyProxy(settings);
  } catch (err) {
    console.error("[proxy-extension] init() failed:", err);
  }
}

// --- Message handler (from popup) ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "getSettings") {
    chrome.storage.local.get(["proxySettings", "proxyTZ"]).then(data => {
      sendResponse({
        settings: data.proxySettings || null,
        timezone: data.proxyTZ || null,
      });
    });
    return true; // async response
  }

  if (msg.type === "saveSettings") {
    const settings = msg.settings;
    (async () => {
      try {
        await chrome.storage.local.set({ proxySettings: settings });
        if (settings.enabled) {
          await applyProxy(settings);
          const tz = await detectTimezone();
          sendResponse({ ok: true, timezone: tz });
        } else {
          await clearProxy();
          cachedTZ = null;
          await chrome.storage.local.remove("proxyTZ");
          sendResponse({ ok: true, timezone: null });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === "toggleProxy") {
    (async () => {
      try {
        const data = await chrome.storage.local.get(["proxySettings"]);
        const settings = data.proxySettings;
        if (!settings) {
          sendResponse({ ok: false, error: "No settings saved" });
          return;
        }
        settings.enabled = msg.enabled;
        await chrome.storage.local.set({ proxySettings: settings });
        if (settings.enabled) {
          await applyProxy(settings);
          const tz = await detectTimezone();
          sendResponse({ ok: true, timezone: tz });
        } else {
          await clearProxy();
          cachedTZ = null;
          await chrome.storage.local.remove("proxyTZ");
          sendResponse({ ok: true, timezone: null });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }
});

// --- Inject timezone into pages via MAIN world ---

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!cachedTZ) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId, frameIds: [details.frameId] },
      world: 'MAIN',
      injectImmediately: true,
      func: (tz) => { self.__PROXY_TZ = tz; },
      args: [cachedTZ],
    });
  } catch (e) {
    // Ignore errors for chrome://, edge cases
  }
});

// --- Auth handler ---

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (details.isProxy && proxyUser) {
      callback({
        authCredentials: { username: proxyUser, password: proxyPass },
      });
    } else {
      callback();
    }
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

init();
