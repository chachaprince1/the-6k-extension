(function () {
  "use strict";

  if (window.top !== window || location.origin !== "https://jpdb.io" || location.pathname !== "/settings") return;

  const prefix = "#jya-connect=";
  if (!location.hash.startsWith(prefix)) return;
  let nonce;
  try {
    nonce = decodeURIComponent(location.hash.slice(prefix.length));
  } catch (_) {
    return;
  }
  if (!/^[a-f\d]{48}$/i.test(nonce)) return;

  // Keep the short-lived connection token out of the address bar and history.
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);

  function findApiKey() {
    for (const row of document.querySelectorAll("tr")) {
      const cells = [...row.querySelectorAll(":scope > th, :scope > td")];
      const labelIndex = cells.findIndex((cell) => cell.textContent.trim().toLowerCase() === "api key");
      if (labelIndex < 0) continue;
      const value = cells.slice(labelIndex + 1).map((cell) => cell.textContent).join(" ");
      const match = value.match(/\b(?:[a-f\d]{32}|[A-Za-z\d_-]{40,128})\b/i);
      if (match) return match[0];
    }
    return "";
  }

  function panel() {
    const existing = document.getElementById("jya-jpdb-connect-host");
    if (existing) return existing;
    const host = document.createElement("aside");
    host.id = "jya-jpdb-connect-host";
    host.setAttribute("aria-live", "polite");
    const root = host.attachShadow({mode: "open"});
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .box { position: fixed; z-index: 2147483647; right: 20px; bottom: 20px; width: min(390px, calc(100vw - 40px));
        box-sizing: border-box; padding: 18px 20px; color: #f6f3ea; background: #171914; border: 1px solid #525949;
        border-radius: 14px; box-shadow: 0 18px 50px rgba(0,0,0,.32); font: 15px/1.45 system-ui, sans-serif; }
      strong { display: block; margin-bottom: 6px; font-size: 16px; }
      p { margin: 0; color: #d7d9cf; }
      button { margin-top: 14px; border: 1px solid #7a846b; border-radius: 8px; padding: 8px 12px; color: #f6f3ea;
        background: #2b3027; font: inherit; cursor: pointer; }
      button:hover { background: #373e32; }
      .success { color: #b8e994; }
      .error { color: #ffb4ab; }
    `;
    const box = document.createElement("div");
    box.className = "box";
    const heading = document.createElement("strong");
    heading.textContent = "jpdb → Yomitan → Anki";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "Use the signed-in account shown on this page?";
    const connect = document.createElement("button");
    connect.type = "button";
    connect.textContent = "Use this API key";
    box.append(heading, status, connect);
    root.append(style, box);
    document.body.append(host);
    return {host, box, status, connect};
  }

  async function complete(ui) {
    ui.connect.disabled = true;
    ui.connect.textContent = "Verifying…";
    ui.status.textContent = "Checking the API key through jpdb’s official API…";
    let apiKey = findApiKey();
    if (!apiKey) {
      apiKey = await new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          const found = findApiKey();
          if (found) {
            observer.disconnect();
            clearTimeout(timer);
            resolve(found);
          }
        });
        observer.observe(document.documentElement, {childList: true, subtree: true});
        const timer = setTimeout(() => {
          observer.disconnect();
          resolve("");
        }, 5000);
      });
    }
    if (!apiKey) {
      ui.status.className = "error";
      ui.status.textContent = "Could not find an API key. Make sure you are signed in, then start Connect jpdb again from the extension setup.";
      ui.connect.disabled = false;
      ui.connect.textContent = "Try again";
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({type: "completeJpdbConnection", nonce, apiKey});
      apiKey = "";
      if (!response?.ok) throw new Error(response?.error || "The extension did not respond.");
      ui.status.className = "success";
      ui.status.textContent = "Connected. The API key was verified and saved in this extension.";
      ui.connect.remove();
      const done = document.createElement("button");
      done.type = "button";
      done.textContent = "Return to extension setup";
      done.addEventListener("click", () => void chrome.runtime.sendMessage({type: "openExtensionSettings"}));
      ui.box.append(done);
    } catch (error) {
      apiKey = "";
      ui.status.className = "error";
      ui.status.textContent = error?.message || "Could not connect jpdb.";
      ui.connect.disabled = false;
      ui.connect.textContent = "Try again";
    }
  }

  const ui = panel();
  ui.connect.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    void complete(ui);
  });
})();
