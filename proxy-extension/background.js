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

// --- Profile helpers ---

function getActiveProfile(state) {
  return state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0];
}

function makeDefaultState() {
  return {
    enabled: false,
    activeProfileId: "default",
    profiles: [
      { id: "default", name: "Default", protocol: "http", host: "", port: "", user: "", pass: "" },
    ],
  };
}

// --- Init ---

async function init() {
  try {
    // Load cached timezone for injection
    const tzData = await chrome.storage.local.get("proxyTZ");
    if (tzData.proxyTZ) cachedTZ = tzData.proxyTZ;

    // Migration / load
    const stored = await chrome.storage.local.get(["proxyState", "proxySettings"]);

    let state;

    if (stored.proxyState) {
      // Already migrated
      state = stored.proxyState;
    } else if (stored.proxySettings && stored.proxySettings.host) {
      // Migrate from old format
      const old = stored.proxySettings;
      state = {
        enabled: !!old.enabled,
        activeProfileId: "default",
        profiles: [
          {
            id: "default",
            name: "Default",
            protocol: old.protocol || "http",
            host: old.host,
            port: old.port,
            user: old.user || "",
            pass: old.pass || "",
          },
        ],
      };
      await chrome.storage.local.set({ proxyState: state });
      await chrome.storage.local.remove("proxySettings");
    } else {
      // Check config.json fallback
      try {
        const resp = await fetch(chrome.runtime.getURL("config.json"));
        const cfg = await resp.json();

        if (cfg.host) {
          state = {
            enabled: true,
            activeProfileId: "default",
            profiles: [
              {
                id: "default",
                name: "Default",
                protocol: cfg.protocol || "http",
                host: cfg.host,
                port: cfg.port,
                user: cfg.user || "",
                pass: cfg.pass || "",
              },
            ],
          };
        } else {
          state = makeDefaultState();
        }
      } catch (e) {
        state = makeDefaultState();
      }
      await chrome.storage.local.set({ proxyState: state });
    }

    // Apply active profile if enabled
    if (state.enabled) {
      const profile = getActiveProfile(state);
      if (profile && profile.host) {
        await applyProxy(profile);
      }
    }
  } catch (err) {
    console.error("[proxy-extension] init() failed:", err);
  }
}

// --- Message handler (from popup) ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "getState") {
    chrome.storage.local.get(["proxyState", "proxyTZ"]).then(data => {
      sendResponse({
        state: data.proxyState || makeDefaultState(),
        timezone: data.proxyTZ || null,
      });
    });
    return true;
  }

  if (msg.type === "saveProfile") {
    (async () => {
      try {
        const data = await chrome.storage.local.get("proxyState");
        const state = data.proxyState || makeDefaultState();
        const idx = state.profiles.findIndex(p => p.id === msg.profile.id);
        if (idx === -1) {
          sendResponse({ ok: false, error: "Profile not found" });
          return;
        }
        // Update profile fields (keep id and name)
        const existing = state.profiles[idx];
        state.profiles[idx] = {
          id: existing.id,
          name: existing.name,
          protocol: msg.profile.protocol,
          host: msg.profile.host,
          port: msg.profile.port,
          user: msg.profile.user,
          pass: msg.profile.pass,
        };
        await chrome.storage.local.set({ proxyState: state });

        // Re-apply if this is the active profile and proxy is enabled
        if (state.enabled && state.activeProfileId === msg.profile.id) {
          await applyProxy(state.profiles[idx]);
          const tz = await detectTimezone();
          sendResponse({ ok: true, state, timezone: tz });
        } else {
          const tzData = await chrome.storage.local.get("proxyTZ");
          sendResponse({ ok: true, state, timezone: tzData.proxyTZ || null });
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
        const data = await chrome.storage.local.get("proxyState");
        const state = data.proxyState;
        if (!state) {
          sendResponse({ ok: false, error: "No settings saved" });
          return;
        }
        state.enabled = msg.enabled;
        await chrome.storage.local.set({ proxyState: state });
        if (state.enabled) {
          const profile = getActiveProfile(state);
          if (profile && profile.host) {
            await applyProxy(profile);
            const tz = await detectTimezone();
            sendResponse({ ok: true, state, timezone: tz });
          } else {
            sendResponse({ ok: false, error: "Active profile has no host configured" });
          }
        } else {
          await clearProxy();
          cachedTZ = null;
          await chrome.storage.local.remove("proxyTZ");
          sendResponse({ ok: true, state, timezone: null });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === "switchProfile") {
    (async () => {
      try {
        const data = await chrome.storage.local.get("proxyState");
        const state = data.proxyState;
        state.activeProfileId = msg.profileId;
        await chrome.storage.local.set({ proxyState: state });
        if (state.enabled) {
          const profile = getActiveProfile(state);
          if (profile && profile.host) {
            await applyProxy(profile);
            const tz = await detectTimezone();
            sendResponse({ ok: true, state, timezone: tz });
          } else {
            await clearProxy();
            cachedTZ = null;
            await chrome.storage.local.remove("proxyTZ");
            sendResponse({ ok: true, state, timezone: null });
          }
        } else {
          const tzData = await chrome.storage.local.get("proxyTZ");
          sendResponse({ ok: true, state, timezone: tzData.proxyTZ || null });
        }
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === "addProfile") {
    (async () => {
      try {
        const data = await chrome.storage.local.get("proxyState");
        const state = data.proxyState || makeDefaultState();
        const newProfile = {
          id: "p" + Date.now(),
          name: "Profile " + state.profiles.length,
          protocol: "http",
          host: "",
          port: "",
          user: "",
          pass: "",
        };
        state.profiles.push(newProfile);
        state.activeProfileId = newProfile.id;
        await chrome.storage.local.set({ proxyState: state });
        const tzData = await chrome.storage.local.get("proxyTZ");
        sendResponse({ ok: true, state, timezone: tzData.proxyTZ || null });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === "deleteProfile") {
    (async () => {
      try {
        if (msg.profileId === "default") {
          sendResponse({ ok: false, error: "Cannot delete the Default profile" });
          return;
        }
        const data = await chrome.storage.local.get("proxyState");
        const state = data.proxyState;
        state.profiles = state.profiles.filter(p => p.id !== msg.profileId);
        if (state.activeProfileId === msg.profileId) {
          state.activeProfileId = "default";
          // Re-apply default profile if enabled
          if (state.enabled) {
            const profile = getActiveProfile(state);
            if (profile && profile.host) {
              await applyProxy(profile);
            } else {
              await clearProxy();
              cachedTZ = null;
              await chrome.storage.local.remove("proxyTZ");
            }
          }
        }
        await chrome.storage.local.set({ proxyState: state });
        const tzData = await chrome.storage.local.get("proxyTZ");
        sendResponse({ ok: true, state, timezone: tzData.proxyTZ || null });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === "renameProfile") {
    (async () => {
      try {
        const data = await chrome.storage.local.get("proxyState");
        const state = data.proxyState;
        const profile = state.profiles.find(p => p.id === msg.profileId);
        if (!profile) {
          sendResponse({ ok: false, error: "Profile not found" });
          return;
        }
        profile.name = msg.name;
        await chrome.storage.local.set({ proxyState: state });
        sendResponse({ ok: true, state });
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
