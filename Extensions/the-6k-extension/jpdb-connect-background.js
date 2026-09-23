"use strict";

(function () {
  const ATTEMPT_KEY = "jpdbConnectAttempt";
  const ATTEMPT_TTL_MS = 2 * 60 * 1000;
  const JPDB_SETTINGS_URL = "https://jpdb.io/settings";
  const JPDB_PING_URL = "https://jpdb.io/api/v1/ping";
  const REQUEST_TIMEOUT_MS = 20_000;

  function nonce() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function candidateKey(value) {
    const key = String(value || "").trim();
    // Current jpdb keys are 32 hexadecimal characters. The second form keeps
    // the bridge compatible if jpdb moves to a longer URL-safe token later.
    if (!/^(?:[a-f\d]{32}|[A-Za-z\d_-]{40,128})$/i.test(key)) {
      throw new Error("The API key on jpdb's settings page was not in a recognized format.");
    }
    return key;
  }

  function verifiedSender(sender) {
    let url;
    try {
      url = new URL(String(sender?.url || sender?.tab?.url || ""));
    } catch (_) {
      throw new Error("The connection request did not come from jpdb settings.");
    }
    if (url.origin !== "https://jpdb.io" || url.pathname !== "/settings") {
      throw new Error("The connection request did not come from jpdb settings.");
    }
  }

  async function begin() {
    const value = nonce();
    await chrome.storage.session.set({
      [ATTEMPT_KEY]: {nonce: value, createdAt: Date.now()}
    });
    try {
      await chrome.tabs.create({url: `${JPDB_SETTINGS_URL}#jya-connect=${value}`});
    } catch (error) {
      await chrome.storage.session.remove(ATTEMPT_KEY);
      throw error;
    }
    return {started: true};
  }

  async function ping(key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(JPDB_PING_URL, {
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? "jpdb rejected this API key. Refresh the settings page and try again."
          : `jpdb could not verify the API key (HTTP ${response.status}).`);
      }
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Timed out while verifying the API key with jpdb.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function complete(message, sender) {
    verifiedSender(sender);
    const suppliedNonce = String(message?.nonce || "");
    const stored = await chrome.storage.session.get(ATTEMPT_KEY);
    const attempt = stored?.[ATTEMPT_KEY];
    const expired = !attempt || Date.now() - Number(attempt?.createdAt || 0) > ATTEMPT_TTL_MS;
    if (expired) {
      await chrome.storage.session.remove(ATTEMPT_KEY);
      throw new Error("This jpdb connection request expired. Start again from the extension setup.");
    }
    if (suppliedNonce.length !== 48 || suppliedNonce !== attempt.nonce) {
      throw new Error("This jpdb connection request does not match the active setup attempt.");
    }

    const key = candidateKey(message?.apiKey);
    await ping(key);

    // Read immediately before writing so other setup choices are preserved.
    const current = await chrome.storage.local.get("settings");
    const settings = globalThis.JYACore.mergeSettings(current.settings);
    await chrome.storage.local.set({settings: {...settings, jpdbApiKey: key}});
    await chrome.storage.session.remove(ATTEMPT_KEY);
    return {connected: true};
  }

  globalThis.JYAJpdbConnect = Object.freeze({begin, complete});
})();
