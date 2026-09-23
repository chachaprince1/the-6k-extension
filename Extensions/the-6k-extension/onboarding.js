(function () {
  "use strict";

  const Core = globalThis.JYACore;
  const byId = (id) => document.getElementById(id);
  const state = {jpdb: null, yomitan: null, anki: null, formats: [], formatError: ""};
  let checking = false;
  let lastCheckAt = 0;
  let saveTimer = 0;

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "The extension did not respond.");
    return response.result;
  }

  function setSaveStatus(text, isError = false) {
    const output = byId("save-status");
    output.textContent = text;
    output.classList.toggle("error", isError);
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get("settings");
    const value = Core.mergeSettings(stored.settings);
    const keyInput = byId("jpdb-api-key");
    keyInput.value = "";
    keyInput.placeholder = value.jpdbApiKey ? "Key saved locally" : "Paste API key";
    byId("yomitan-url").value = value.yomitanUrl;
    byId("anki-url").value = value.ankiUrl;
    byId("skip-particles").checked = value.filters.skipParticles;
    byId("skip-vocalizations").checked = value.filters.skipVocalizations;
    byId("skip-semantic-grammar").checked = value.filters.skipSemanticGrammar;
    byId("skip-title-honorifics").checked = value.filters.skipTitleHonorifics;
    byId("skip-title-positions").checked = value.filters.skipTitlePositions;
    byId("include-media").checked = value.includeMedia;
    return value;
  }

  async function saveSettings(options = {}) {
    try {
      const stored = await chrome.storage.local.get("settings");
      const previous = Core.mergeSettings(stored.settings);
      const suppliedKey = byId("jpdb-api-key").value.trim();
      const value = Core.mergeSettings({
        ...previous,
        jpdbApiKey: options.saveApiKey && suppliedKey ? suppliedKey : previous.jpdbApiKey,
        yomitanUrl: byId("yomitan-url").value.trim() || Core.DEFAULT_SETTINGS.yomitanUrl,
        ankiUrl: byId("anki-url").value.trim() || Core.DEFAULT_SETTINGS.ankiUrl,
        includeMedia: byId("include-media").checked,
        filters: {
          skipParticles: byId("skip-particles").checked,
          skipVocalizations: byId("skip-vocalizations").checked,
          skipSemanticGrammar: byId("skip-semantic-grammar").checked,
          skipTitleHonorifics: byId("skip-title-honorifics").checked,
          skipTitlePositions: byId("skip-title-positions").checked
        }
      });
      await chrome.storage.local.set({settings: value});
      if (options.saveApiKey && suppliedKey) {
        byId("jpdb-api-key").value = "";
        byId("jpdb-api-key").placeholder = "Key saved locally";
        setSaveStatus("Key saved. Checking jpdb…");
      } else {
        setSaveStatus("Saved automatically.");
      }
      return value;
    } catch (error) {
      setSaveStatus(error?.message || String(error), true);
      throw error;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    setSaveStatus("Saving…");
    saveTimer = setTimeout(() => void saveSettings(), 250);
  }

  function setConnection(name, kind, badge, detail) {
    const row = byId(`${name}-row`);
    row.className = `connection-row ${kind}`;
    byId(`${name}-badge`).textContent = badge;
    byId(`${name}-detail`).textContent = detail;
  }

  function formatCountText(count) {
    return `${count} card format${count === 1 ? "" : "s"}`;
  }

  function render() {
    const jpdbActions = byId("jpdb-actions");
    const jpdbConnectedActions = byId("jpdb-connected-actions");
    const connectJpdbButton = byId("connect-jpdb");
    const yomitanSetupActions = byId("yomitan-setup-actions");
    const yomitanFormatActions = byId("yomitan-format-actions");
    const ankiActions = byId("anki-actions");

    jpdbActions.hidden = Boolean(state.jpdb?.ok) || state.jpdb === null;
    jpdbConnectedActions.hidden = !state.jpdb?.ok;
    if (state.jpdb !== null && !state.jpdb.ok) {
      connectJpdbButton.disabled = false;
      connectJpdbButton.textContent = "Connect signed-in account";
    }
    yomitanSetupActions.hidden = Boolean(state.yomitan?.ok) || state.yomitan === null;
    yomitanFormatActions.hidden = !state.yomitan?.ok || state.formats.length > 0;
    ankiActions.hidden = Boolean(state.anki?.ok) || state.anki === null;

    if (state.jpdb === null) {
      setConnection("jpdb", "checking", "Checking", "Checking the official API…");
    } else if (state.jpdb.ok) {
      setConnection("jpdb", "ok", "Connected", "You’re connected. You do not need to change jpdb settings or Study Tools. Choose an anime below; Add to Anki buttons appear beside episodes.");
    } else {
      setConnection("jpdb", "bad", "Action needed", "Create a free jpdb account if needed, then sign in and securely connect this Chrome profile.");
    }

    if (state.yomitan === null) {
      setConnection("yomitan", "checking", "Checking", "Checking the local Yomitan bridge…");
    } else if (!state.yomitan.ok) {
      setConnection("yomitan", "bad", "Action needed", "Yomitan API is not ready yet. If you used The 6K Installer, its helper is already installed. In Yomitan settings, turn on Advanced and then Enable Yomitan API under General.");
    } else if (state.formats.length === 0) {
      setConnection("yomitan", "warn", "Format needed", state.formatError || "The API works, but Yomitan has no usable Anki card format yet.");
    } else {
      const version = state.yomitan.version !== undefined ? ` · v${state.yomitan.version}` : "";
      setConnection("yomitan", "ok", "Connected", `${formatCountText(state.formats.length)}${version}`);
    }

    if (state.anki === null) {
      setConnection("anki", "checking", "Checking", "Checking AnkiConnect…");
    } else if (state.anki.ok) {
      setConnection("anki", "ok", "Connected", `AnkiConnect v${state.anki.version ?? "connected"} is ready.`);
    } else {
      setConnection("anki", "warn", "Optional for export", "Open Anki with AnkiConnect to add cards directly. TSV export already works without it.");
    }

    const checked = [state.jpdb, state.yomitan, state.anki].filter((value) => value !== null).length;
    const jpdbReady = Boolean(state.jpdb?.ok);
    const yomitanReady = Boolean(state.yomitan?.ok && state.formats.length > 0);
    const ankiReady = Boolean(state.anki?.ok);
    const exportReady = jpdbReady && yomitanReady;
    const readyPanel = byId("ready-panel");
    readyPanel.hidden = !exportReady;

    if (exportReady && ankiReady) {
      byId("overall-status").textContent = "All three connections are ready.";
      byId("ready-title").textContent = "You’re ready to study from three sources";
      byId("ready-detail").textContent = "Make Anki decks from jpdb anime episodes and create flashcards from ImmersionKit without an account.";
    } else if (exportReady) {
      byId("overall-status").textContent = "Episode export is ready. Anki is optional.";
      byId("ready-title").textContent = "You’re ready to export";
      byId("ready-detail").textContent = "Open Anki later if you want cards added directly.";
    } else if (checked < 3) {
      byId("overall-status").textContent = "Checking your connections…";
    } else {
      const readyCount = [jpdbReady, yomitanReady, ankiReady].filter(Boolean).length;
      byId("overall-status").textContent = `${readyCount} of 3 connections ready. Complete the highlighted steps below.`;
    }
  }

  async function testConnections(options = {}) {
    if (checking) return;
    checking = true;
    const button = byId("test-connections");
    button.disabled = true;
    button.textContent = "Checking…";
    if (!options.keepState) {
      state.jpdb = null;
      state.yomitan = null;
      state.anki = null;
      render();
    }
    try {
      await saveSettings();
      const result = await send({type: "getConnections"});
      state.jpdb = result.jpdb;
      state.yomitan = result.yomitan;
      state.anki = result.anki;
      state.formats = Array.isArray(result.formats) ? result.formats : [];
      state.formatError = result.formatError || "";
      lastCheckAt = Date.now();
      render();
    } catch (error) {
      setSaveStatus(error?.message || String(error), true);
      byId("overall-status").textContent = "Could not check connections. Try again.";
    } finally {
      checking = false;
      button.disabled = false;
      button.textContent = "Check again";
    }
  }

  async function connectJpdb() {
    const button = byId("connect-jpdb");
    button.disabled = true;
    button.textContent = "Opening jpdb…";
    try {
      await send({type: "beginJpdbConnection"});
      setSaveStatus("On jpdb, click Use this API key. Setup updates when you return.");
    } catch (error) {
      setSaveStatus(error?.message || String(error), true);
    } finally {
      button.disabled = false;
      button.textContent = "Connect signed-in account";
    }
  }

  async function saveManualKey() {
    const key = byId("jpdb-api-key").value.trim();
    if (!key) {
      setSaveStatus("Paste your jpdb API key first.", true);
      byId("jpdb-api-key").focus();
      return;
    }
    const button = byId("save-jpdb-key");
    button.disabled = true;
    try {
      await saveSettings({saveApiKey: true});
      await testConnections({keepState: true});
    } finally {
      button.disabled = false;
    }
  }

  async function disconnectJpdb() {
    const button = byId("disconnect-jpdb");
    button.disabled = true;
    try {
      await send({type: "clearJpdbConnection"});
      state.jpdb = {ok: false, error: "API key removed"};
      byId("jpdb-api-key").value = "";
      byId("jpdb-api-key").placeholder = "Paste API key";
      setSaveStatus("jpdb API key removed from Chrome storage.");
      render();
    } catch (error) {
      setSaveStatus(error?.message || String(error), true);
    } finally {
      button.disabled = false;
    }
  }

  function openManualKey() {
    byId("manual-settings").open = true;
    byId("jpdb-api-key").focus();
  }

  function bindEvents() {
    byId("connect-jpdb").addEventListener("click", () => void connectJpdb());
    byId("show-manual-key").addEventListener("click", openManualKey);
    byId("save-jpdb-key").addEventListener("click", () => void saveManualKey());
    byId("disconnect-jpdb").addEventListener("click", () => void disconnectJpdb());
    byId("jpdb-api-key").addEventListener("keydown", (event) => {
      if (event.key === "Enter") void saveManualKey();
    });
    byId("test-connections").addEventListener("click", () => void testConnections());
    byId("open-yomitan-api").addEventListener("click", () => void send({type: "openYomitanApiSettings"}));
    byId("open-yomitan-formats").addEventListener("click", () => void send({type: "openYomitanSettings"}));

    for (const id of ["skip-particles", "skip-vocalizations", "skip-semantic-grammar", "skip-title-honorifics", "skip-title-positions", "include-media", "yomitan-url", "anki-url"]) {
      byId(id).addEventListener("change", scheduleSave);
    }

    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local" || !changes.settings) return;
        const before = Core.mergeSettings(changes.settings.oldValue);
        const after = Core.mergeSettings(changes.settings.newValue);
        if (before.jpdbApiKey !== after.jpdbApiKey) {
          byId("jpdb-api-key").value = "";
          byId("jpdb-api-key").placeholder = after.jpdbApiKey ? "Key saved locally" : "Paste API key";
          setSaveStatus(after.jpdbApiKey ? "jpdb connected. Checking everything else…" : "jpdb key removed.");
          void testConnections({keepState: true});
        }
      });
    }

    window.addEventListener("focus", () => {
      if (Date.now() - lastCheckAt > 2_000) void testConnections({keepState: true});
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - lastCheckAt > 2_000) void testConnections({keepState: true});
    });
  }

  async function init() {
    bindEvents();
    await loadSettings();
    render();
    await testConnections();
  }

  void init();
})();
