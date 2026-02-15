const $ = id => document.getElementById(id);

const els = {
  enabled: $("enabled"),
  quickpaste: $("quickpaste"),
  protocol: $("protocol"),
  host: $("host"),
  port: $("port"),
  user: $("user"),
  pass: $("pass"),
  save: $("save"),
  status: $("status"),
  tz: $("tzDisplay"),
};

function showStatus(text, type) {
  els.status.textContent = text;
  els.status.className = "status " + type;
  if (type === "ok") setTimeout(() => { els.status.className = "status"; }, 3000);
}

function showTZ(tz) {
  els.tz.innerHTML = tz ? "Timezone: <span>" + tz + "</span>" : "";
}

function populateForm(settings) {
  if (!settings) return;
  els.enabled.checked = !!settings.enabled;
  els.protocol.value = settings.protocol || "http";
  els.host.value = settings.host || "";
  els.port.value = settings.port || "";
  els.user.value = settings.user || "";
  els.pass.value = settings.pass || "";
}

function getFormSettings() {
  return {
    protocol: els.protocol.value,
    host: els.host.value.trim(),
    port: els.port.value.trim(),
    user: els.user.value.trim(),
    pass: els.pass.value.trim(),
    enabled: els.enabled.checked,
  };
}

// Quick paste: [protocol://]host:port[:user:pass]
els.quickpaste.addEventListener("input", () => {
  let raw = els.quickpaste.value.trim();
  if (!raw) return;

  // Extract protocol prefix if present
  let protocol = "http";
  const protoMatch = raw.match(/^([a-zA-Z0-9]+):\/\//);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    raw = raw.slice(protoMatch[0].length);
  }

  const parts = raw.split(":");
  if (parts.length < 2) return;

  els.protocol.value = protocol;
  els.host.value = parts[0];
  els.port.value = parts[1];
  els.user.value = parts[2] || "";
  els.pass.value = parts.slice(3).join(":") || "";
});

// Load current settings on popup open
chrome.runtime.sendMessage({ type: "getSettings" }, resp => {
  if (resp) {
    populateForm(resp.settings);
    showTZ(resp.timezone);
  }
});

// Save & Apply
els.save.addEventListener("click", () => {
  const settings = getFormSettings();
  if (!settings.host || !settings.port) {
    showStatus("Host and port are required", "error");
    return;
  }
  const isSocksAuth = settings.protocol.startsWith("socks") && (settings.user || settings.pass);
  if (isSocksAuth) {
    showStatus("SOCKS auth not supported by Chrome. Use HTTP or auth-free SOCKS.", "error");
    return;
  }
  showStatus("Applying...", "info");
  chrome.runtime.sendMessage({ type: "saveSettings", settings }, resp => {
    if (resp && resp.ok) {
      const msg = settings.enabled ? "Proxy enabled" : "Proxy disabled";
      showStatus(resp.timezone ? msg + " — timezone detected" : msg, "ok");
      showTZ(resp.timezone);
    } else {
      showStatus("Error: " + (resp && resp.error || "unknown"), "error");
    }
  });
});

// Toggle on/off
els.enabled.addEventListener("change", () => {
  const enabled = els.enabled.checked;
  showStatus(enabled ? "Enabling..." : "Disabling...", "info");
  chrome.runtime.sendMessage({ type: "toggleProxy", enabled }, resp => {
    if (resp && resp.ok) {
      showStatus(enabled ? "Proxy enabled" : "Proxy disabled", "ok");
      showTZ(resp.timezone);
    } else if (resp && resp.error === "No settings saved") {
      els.enabled.checked = false;
      showStatus("Enter proxy settings and click Save first", "error");
    } else {
      showStatus("Error: " + (resp && resp.error || "unknown"), "error");
    }
  });
});
