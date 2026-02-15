const $ = id => document.getElementById(id);

let currentState = null;

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
  profileSelect: $("profileSelect"),
  profileRename: $("profileRename"),
  profileAdd: $("profileAdd"),
  profileDelete: $("profileDelete"),
};

function showStatus(text, type) {
  els.status.textContent = text;
  els.status.className = "status " + type;
  if (type === "ok") setTimeout(() => { els.status.className = "status"; }, 3000);
}

function showTZ(tz) {
  els.tz.innerHTML = tz ? "Timezone: <span>" + tz + "</span>" : "";
}

function populateForm(profile) {
  if (!profile) return;
  els.protocol.value = profile.protocol || "http";
  els.host.value = profile.host || "";
  els.port.value = profile.port || "";
  els.user.value = profile.user || "";
  els.pass.value = profile.pass || "";
}

function getFormProfile() {
  return {
    protocol: els.protocol.value,
    host: els.host.value.trim(),
    port: els.port.value.trim(),
    user: els.user.value.trim(),
    pass: els.pass.value.trim(),
  };
}

function renderProfiles(state) {
  currentState = state;
  els.enabled.checked = !!state.enabled;

  // Populate dropdown
  els.profileSelect.innerHTML = "";
  for (const p of state.profiles) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    els.profileSelect.appendChild(opt);
  }
  els.profileSelect.value = state.activeProfileId;

  // Fill form with active profile
  const active = state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0];
  populateForm(active);
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

// Load current state on popup open
chrome.runtime.sendMessage({ type: "getState" }, resp => {
  if (resp) {
    renderProfiles(resp.state);
    showTZ(resp.timezone);
  }
});

// Save & Apply
els.save.addEventListener("click", () => {
  const formData = getFormProfile();
  if (!formData.host || !formData.port) {
    showStatus("Host and port are required", "error");
    return;
  }
  const isSocksAuth = formData.protocol.startsWith("socks") && (formData.user || formData.pass);
  if (isSocksAuth) {
    showStatus("SOCKS auth not supported by Chrome. Use HTTP or auth-free SOCKS.", "error");
    return;
  }
  showStatus("Applying...", "info");
  const profile = { id: currentState.activeProfileId, ...formData };
  chrome.runtime.sendMessage({ type: "saveProfile", profile }, resp => {
    if (resp && resp.ok) {
      renderProfiles(resp.state);
      const msg = currentState.enabled ? "Proxy enabled" : "Settings saved";
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
      renderProfiles(resp.state);
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

// Switch profile
els.profileSelect.addEventListener("change", () => {
  const profileId = els.profileSelect.value;
  chrome.runtime.sendMessage({ type: "switchProfile", profileId }, resp => {
    if (resp && resp.ok) {
      renderProfiles(resp.state);
      showTZ(resp.timezone);
    } else {
      showStatus("Error: " + (resp && resp.error || "unknown"), "error");
    }
  });
});

// Add profile
els.profileAdd.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "addProfile" }, resp => {
    if (resp && resp.ok) {
      renderProfiles(resp.state);
      showTZ(resp.timezone);
    } else {
      showStatus("Error: " + (resp && resp.error || "unknown"), "error");
    }
  });
});

// Delete profile
els.profileDelete.addEventListener("click", () => {
  const profileId = els.profileSelect.value;
  chrome.runtime.sendMessage({ type: "deleteProfile", profileId }, resp => {
    if (resp && resp.ok) {
      renderProfiles(resp.state);
      showTZ(resp.timezone);
    } else {
      showStatus("Error: " + (resp && resp.error || "unknown"), "error");
    }
  });
});

// Rename profile
els.profileRename.addEventListener("click", () => {
  const profileId = els.profileSelect.value;
  const current = currentState.profiles.find(p => p.id === profileId);
  const name = window.prompt("Rename profile:", current ? current.name : "");
  if (name === null || !name.trim()) return;
  chrome.runtime.sendMessage({ type: "renameProfile", profileId, name: name.trim() }, resp => {
    if (resp && resp.ok) {
      renderProfiles(resp.state);
    } else {
      showStatus("Error: " + (resp && resp.error || "unknown"), "error");
    }
  });
});
