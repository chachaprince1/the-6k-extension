const BUSY_MESSAGE = "Your Anki is busy right now; try again later.";
const send = (message) => new Promise((resolve, reject) => {
  let settled = false;
  const timeoutMs = message.type === "add" ? 13500 : 11500;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    reject(new Error(message.type === "add" ? BUSY_MESSAGE : "The request took too long. Try again."));
  }, timeoutMs);
  chrome.runtime.sendMessage(message, (reply) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (!reply?.ok) reject(new Error(reply?.error || "Extension request failed."));
    else resolve(reply.result);
  });
});

const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
const isJapanese = (text) => /[\u3040-\u30ff\u3400-\u9fff]/.test(text || "");
const normalizeForMatch = (text) => clean(text).normalize("NFKC").replace(/\s+/g, "");

function sourceUrl(element, types, labels = types) {
  const candidates = [...element.querySelectorAll("audio[src], audio source[src], video[src], a[href], img[src]")];
  for (const node of candidates) {
    const url = node.src || node.href;
    if (!url) continue;
    const value = url.toLowerCase();
    const metadata = [node.textContent, node.getAttribute("aria-label"), node.getAttribute("title"), node.getAttribute("download")]
      .filter(Boolean).join(" ").toLowerCase();
    if (types.some((type) => value.includes(type)) || labels.some((label) => metadata.includes(label))) return url;
  }
  return "";
}

function attributeUrl(element, types) {
  for (const node of element.querySelectorAll("*")) {
    for (const attribute of [...node.attributes]) {
      const value = attribute.value;
      if (/^https?:/i.test(value) && types.some((type) => value.toLowerCase().includes(type))) return value;
    }
  }
  return "";
}

// ImmersionKit renders the playable sound as a React click handler rather than
// an <audio> or <a href> element. Read the public media values from those
// props when available, while keeping normal DOM-link extraction as fallback.
function reactMedia(element, targetSentence) {
  const nodes = [element, ...element.querySelectorAll("*")];
  const seen = new Set();
  let inspected = 0;
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 6 || seen.has(value) || inspected++ > 6000) return null;
    seen.add(value);
    const audio = value.sound_url || value.audio_url || value.audioUrl || value.audio;
    const image = value.image_url || value.imageUrl || value.picture;
    const sentence = value.sentence || value.expression;
    if (typeof audio === "string" && audio && (!targetSentence || clean(sentence) === clean(targetSentence))) {
      return { audio: audio, image: typeof image === "string" ? image : "" };
    }
    for (const key of Object.keys(value)) {
      if (/^(children|style|ownerDocument|parentNode|stateNode|return|child|sibling|alternate)$/.test(key)) continue;
      const found = visit(value[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      if (!key.startsWith("__reactProps$") && !key.startsWith("__reactFiber$")) continue;
      const found = visit(node[key]);
      if (found) return found;
    }
  }
  return { audio: "", image: "" };
}

function cardRoot(miningLink) {
  let node = miningLink;
  for (let i = 0; i < 7 && node?.parentElement; i += 1, node = node.parentElement) {
    for (const sibling of [node.previousElementSibling, node.nextElementSibling]) {
      if (sibling?.querySelector("img[src][alt]")) return sibling;
    }
    const text = clean(node.innerText);
    if (node.querySelector("img") && text.length > 25 && isJapanese(text)) return node;
  }
  return miningLink.parentElement;
}

function rootJapaneseSentence(root) {
  const lines = fallbackText(root);
  return lines.find((line) => isJapanese(line) && line.length > 1) || "";
}

function markOriginalAnkiControl(link) {
  const menu = link.closest(".ui.secondary.menu");
  const responsiveMenu = menu?.closest(".mobile.or.lower.hidden");
  const cards = [cardRoot(link), responsiveMenu?.previousElementSibling, responsiveMenu?.nextElementSibling];
  for (const card of cards) {
    const sentence = rootJapaneseSentence(card);
    const expected = normalizeForMatch(sentence);
    const controls = [...(card?.querySelectorAll(".ui.button.floating.labeled.dropdown.icon, [role='listbox'].ui.button, [role='combobox'].ui.button") || [])]
      .filter((control) => {
        const label = [control.textContent, control.getAttribute("aria-label"), control.getAttribute("title")].filter(Boolean).join(" ");
        return /anki/i.test(label) && !control.closest(".ik-full-controls");
      });
    if (!controls.length) continue;
    for (const control of controls) {
      control.classList.add("ik-native-anki");
      if (!expected) continue;
      const menuElement = control.parentElement?.querySelector(".menu") || control.nextElementSibling;
      if (!menuElement) continue;
      let visible = 0;
      const emptyMessageClass = "ik-native-anki-empty";
      for (const item of menuElement.querySelectorAll(".item")) {
        const candidate = normalizeForMatch(item.textContent);
        const matched = candidate.includes(expected) || expected.includes(candidate);
        item.hidden = !matched;
        if (matched) visible += 1;
      }
      const previousEmpty = menuElement.querySelector(`.${emptyMessageClass}`);
      previousEmpty?.remove();
      if (visible === 0) {
        const empty = document.createElement("div");
        empty.className = `item ${emptyMessageClass}`;
        empty.style.display = "block";
        empty.style.opacity = "0.7";
        empty.textContent = "No exact word match on this card in the current list.";
        menuElement.prepend(empty);
      }
    }
  }
}

function setOriginalAnkiOnly(enabled) {
  document.documentElement.classList.toggle("ik-use-original-anki-only", Boolean(enabled));
}

function fallbackText(root) {
  const values = [...root.querySelectorAll("h1,h2,h3,h4,p,span")]
    .filter(el => !el.children.length)
    .map(el => clean(el.textContent))
    .filter((value, index, values) => value && values.indexOf(value) === index && value.length < 240);
  return values;
}

async function extract(root) {
  const imageNode = root.querySelector("img[src][alt]") || root.querySelector("img[src]");
  const image = imageNode?.src || sourceUrl(root, [".jpg", ".jpeg", ".png", ".webp"]) || attributeUrl(root, [".jpg", ".jpeg", ".png", ".webp"]);
  const id = clean(imageNode?.alt);
  const leafText = fallbackText(root);
  const sentenceElement = id ? root.querySelector(`#example_${CSS.escape(id)}`) : null;
  const sentenceHint = clean(sentenceElement?.textContent) || leafText.find(value => isJapanese(value) && !/anki|mining|download/i.test(value)) || "";
  if (id && image) {
    const resolved = await send({ type: "resolveExample", id, imageUrl: image, pageUrl: location.href, sentenceHint });
    return { ...resolved, missing: [[resolved.sentence, "sentence"], [resolved.translation, "translation"], [resolved.imageUrl, "image"], [resolved.audioUrl, "audio"]].filter(([value]) => !value).map(([, name]) => name) };
  }
  const rawLines = [...root.querySelectorAll("h1,h2,h3,h4,p,span,div")]
    .map((el) => clean(el.innerText)).filter((text, index, array) => text && array.indexOf(text) === index && text.length < 500);
  const japanese = rawLines.find((line) => isJapanese(line) && line.length > 1) || "";
  const english = rawLines.find((line) => !isJapanese(line) && /[a-z]/i.test(line) && line.length > 2 && !/anki|mining|download/i.test(line)) || "";
  const reading = rawLines.find((line) => line !== japanese && isJapanese(line) && /^[\u3040-\u30ff\s\u30fc]+$/.test(line)) || japanese;
  const react = reactMedia(root, japanese);
  const fallbackImage = react.image || root.querySelector("img[src]")?.src || sourceUrl(root, [".jpg", ".jpeg", ".png", ".webp"]) || attributeUrl(root, [".jpg", ".jpeg", ".png", ".webp"]);
  const audio = react.audio || sourceUrl(root, [".mp3", ".ogg", ".wav", ".m4a", ".webm", "audio", "sound"], ["audio", "sound", "mp3", "listen", "play"]) || attributeUrl(root, [".mp3", ".ogg", ".wav", ".m4a", ".webm", "audio", "sound"]);
  const href = location.href;
  const show = rawLines.find((line) => /anime|game|drama|movie|season/i.test(line)) || "";
  const fallbackId = `${href}|${japanese}|${audio || fallbackImage}`;
  const missing = [[japanese, "sentence"], [english, "translation"], [fallbackImage, "image"], [audio, "audio"]].filter(([value]) => !value).map(([, name]) => name);
  return { sentence: japanese, translation: english, furigana: reading, imageUrl: fallbackImage, audioUrl: audio, id: fallbackId, source: show, url: href, missing };
}

function showBusyNotice() {
  document.querySelector(".ik-busy-notice")?.remove();
  const notice = document.createElement("div");
  notice.className = "ik-busy-notice";
  notice.setAttribute("role", "alert");
  notice.textContent = BUSY_MESSAGE;
  document.body.append(notice);
  setTimeout(() => notice.remove(), 6000);
}

function reportError(button, error) {
  if (error?.message === BUSY_MESSAGE) showBusyNotice();
  toast(button, error?.message || "Something went wrong.", true);
}

function toast(button, text, error = false) {
  button.textContent = text;
  button.style.background = error ? "#b3261e" : "#087f8c";
  setTimeout(() => { button.textContent = button.dataset.noteId ? "View in Anki" : "Add full card to Anki"; button.style.background = ""; button.disabled = false; }, 3200);
}

function addButton(link) {
  if (link.parentElement.querySelector(".ik-full-add")) return;
  markOriginalAnkiControl(link);
  const button = document.createElement("button");
  button.className = "ik-full-add";
  button.type = "button";
  button.textContent = "Add full card to Anki";
  button.addEventListener("click", async () => {
    if (button.dataset.noteId) {
      button.disabled = true;
      button.textContent = "Opening in Anki…";
      try {
        await send({ type: "view", noteId: Number(button.dataset.noteId) });
        button.textContent = "View in Anki";
        button.disabled = false;
      } catch (error) { reportError(button, error); }
      return;
    }
    button.disabled = true;
    button.textContent = "Preparing card…";
    try {
      let { saved } = await send({ type: "setup" });
      if (!saved) { await showSetup(); ({ saved } = await send({ type: "setup" })); }
      if (!saved) throw new Error("Set up was cancelled.");
      const data = await extract(cardRoot(link));
      if (saved.skipPreview) {
        if (!data.sentence || !data.translation) throw new Error("ImmersionKit did not provide the sentence and translation for this card.");
        button.textContent = "Adding to Anki…";
        showAddResult(button, await send({ type: "add", data }));
      } else {
        await showPreview(data, button);
      }
    } catch (error) { reportError(button, error); }
  });
  const group = document.createElement("span");
  group.className = "ik-full-controls";
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "ik-full-settings";
  gear.textContent = "⚙";
  gear.title = "Change Anki deck and field mappings";
  gear.setAttribute("aria-label", "Anki settings: deck and fields");
  gear.onclick = () => {
    const root = cardRoot(link);
    const image = root.querySelector("img[src][alt]");
    const id = clean(image?.alt);
    const sentence = clean(id ? root.querySelector(`#example_${CSS.escape(id)}`)?.textContent : "");
    showSetup({ id, sentence }).catch(error => reportError(button, error));
  };
  group.append(button, gear);
  link.insertAdjacentElement("afterend", group);
}

function mediaStatus(data) {
  const image = data.imageUrl ? "✓ picture found" : "⚠ picture missing";
  const audio = data.audioUrl ? "✓ audio found" : "⚠ audio missing";
  return `${image} · ${audio}`;
}

function showAddResult(sourceButton, result) {
  sourceButton.disabled = false;
  sourceButton.dataset.noteId = String(result.noteId);
  sourceButton.dataset.mode = "view";
  sourceButton.textContent = "View in Anki";
  sourceButton.title = result.alreadyExists ? "This card is already in Anki" : `Added to ${result.deck}`;
  sourceButton.style.background = "#087f8c";
}

async function showPreview(data, sourceButton) {
  const backdrop = document.createElement("div");
  backdrop.className = "ik-full-dialog-backdrop";
  backdrop.innerHTML = `<form class="ik-full-dialog ik-preview" role="dialog" aria-modal="true" aria-labelledby="ik-preview-title"><h2 id="ik-preview-title">Preview Anki card</h2><p>Check the captured values before creating the note.</p><label>Japanese sentence<textarea name="sentence" rows="2"></textarea></label><label>English translation<textarea name="translation" rows="2"></textarea></label><label>Reading / furigana<textarea name="furigana" rows="2"></textarea></label><label>Source title<textarea name="source" rows="1"></textarea></label><p class="ik-media-status"></p><label class="ik-missing-option"><input type="checkbox" name="allowMissing"> Add anyway when media is missing</label><div class="ik-full-status" role="status" aria-live="polite"></div><div class="actions"><button class="secondary ik-preview-cancel" type="button">Cancel</button><button class="ik-preview-add" type="submit">Create Anki card</button></div></form>`;
  document.body.append(backdrop);
  const form = backdrop.querySelector("form");
  for (const key of ["sentence", "translation", "furigana", "source"]) form.elements[key].value = data[key] || "";
  const status = form.querySelector(".ik-full-status");
  form.querySelector(".ik-media-status").textContent = mediaStatus(data);
  const hasRequiredText = data.sentence && data.translation;
  form.querySelector(".ik-preview-add").disabled = !hasRequiredText;
  const missing = data.missing.filter(key => ["image", "audio"].includes(key));
  form.querySelector(".ik-missing-option").hidden = !missing.length;
  let finish;
  const close = result => { backdrop.remove(); sourceButton.disabled = false; sourceButton.textContent = "Add full card to Anki"; finish?.(result); };
  form.querySelector(".ik-preview-cancel").onclick = close;
  backdrop.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); close(); } });
  return await new Promise(resolve => { finish = resolve; form.addEventListener("submit", async event => {
    event.preventDefault();
    if (missing.length && !form.elements.allowMissing.checked) { status.textContent = `Media missing: ${missing.join(", ")}. Check the box to create the card anyway.`; return; }
    const add = form.querySelector(".ik-preview-add"); add.disabled = true; status.textContent = "Adding to Anki…";
    const edited = { ...data, sentence: clean(form.elements.sentence.value), translation: clean(form.elements.translation.value), furigana: clean(form.elements.furigana.value), source: clean(form.elements.source.value) };
    try {
      const result = await send({ type: "add", data: edited });
      close(true);
      showAddResult(sourceButton, result);
    } catch (error) {
      add.disabled = false;
      status.textContent = error.message;
      if (error?.message === BUSY_MESSAGE) showBusyNotice();
    }
  }); });
}

let setupDialog = null;
async function showSetup(cardData = null) {
  if (setupDialog) return setupDialog;
  setupDialog = openSetup(cardData).finally(() => { setupDialog = null; });
  return setupDialog;
}

async function openSetup(cardData = null) {
  const { decks, models, saved, connection } = await send({ type: "setup" });
  const previousFocus = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "ik-full-dialog-backdrop";
  backdrop.innerHTML = `<form class="ik-full-dialog" role="dialog" aria-modal="true" aria-labelledby="ik-settings-title"><h2 id="ik-settings-title">Anki settings</h2><label class="ik-setting-toggle"><input type="checkbox" name="skipPreview"> Don’t show preview before adding cards</label><label class="ik-setting-toggle"><input type="checkbox" name="useOriginalAnkiOnly"> Restore ImmersionKit’s original Anki button</label><p class="ik-original-anki-note" hidden>The original Anki button must be set up on the ImmersionKit website for it to work. Compatibility is lower: it needs an exact word match, so grammar-pattern searches can choose the wrong entry.</p><label>Deck<select name="deck"></select></label><label class="new-deck">New deck name<input name="newDeck" value="Immersion Kit" maxlength="200"></label><label>Note type<select name="model"></select></label><details class="ik-mapping-details"><summary>Field mapping</summary><div class="ik-mapping-body"><div class="ik-mapping-heading"><p>Choose the destination for each item. Items sharing a field are combined. The first five are required.</p><button type="button" class="secondary ik-auto">Auto-map</button></div><div class="ik-mappings"></div><p class="ik-field-help"></p></div></details><label>AnkiConnect URL<input name="connection" type="url" spellcheck="false"></label><div class="ik-connection-actions"><button type="button" class="secondary ik-test">Test connection</button><span class="ik-connection-status" role="status"></span></div><div class="ik-full-status" role="status" aria-live="polite"></div><div class="actions"><button type="button" class="secondary ik-view-existing" hidden>View in Anki</button><button class="secondary ik-cancel" type="button">Cancel</button><button class="ik-save" type="submit">Save settings</button></div></form>`;
  document.body.append(backdrop);
  const form = backdrop.querySelector("form");
  form.querySelector(".ik-mapping-details").open = !saved;
  const deckSelect = form.elements.deck, newDeck = form.elements.newDeck, newDeckLabel = form.querySelector(".new-deck"), status = form.querySelector(".ik-full-status");
  form.elements.connection.value = connection;
  form.elements.skipPreview.checked = Boolean(saved?.skipPreview);
  form.elements.useOriginalAnkiOnly.checked = Boolean(saved?.useOriginalAnkiOnly);
  const originalAnkiNotice = form.querySelector(".ik-original-anki-note");
  const syncOriginalAnkiNotice = () => { originalAnkiNotice.hidden = !form.elements.useOriginalAnkiOnly.checked; };
  form.elements.useOriginalAnkiOnly.addEventListener("change", syncOriginalAnkiNotice);
  syncOriginalAnkiNotice();
  for (const deck of decks) deckSelect.add(new Option(deck, deck));
  deckSelect.add(new Option("Create a new deck…", ""));
  deckSelect.value = saved && decks.includes(saved.deck) ? saved.deck : (decks.includes("Immersion Kit") ? "Immersion Kit" : decks[0] || "");
  for (const model of models) form.elements.model.add(new Option(model, model));
  form.elements.model.value = saved && models.includes(saved.model) ? saved.model : models.find(m => /^ImmersionKit Full Card$/i.test(m)) || models.find(m => /immersion.*kit.*sentence/i.test(m)) || models[0] || "";
  newDeckLabel.hidden = Boolean(deckSelect.value);
  deckSelect.addEventListener("change", () => { newDeckLabel.hidden = Boolean(deckSelect.value); });
  const viewExisting = form.querySelector(".ik-view-existing");
  if (cardData?.id || cardData?.sentence) {
    send({ type: "findExisting", data: cardData }).then(({ noteId }) => {
      if (!noteId || !backdrop.isConnected) return;
      viewExisting.hidden = false;
      viewExisting.onclick = async () => {
        viewExisting.disabled = true;
        try {
          await send({ type: "view", noteId });
          viewExisting.disabled = false;
          viewExisting.textContent = "Opened in Anki";
          setTimeout(() => { if (viewExisting.isConnected) viewExisting.textContent = "View in Anki"; }, 1200);
        }
        catch (error) { viewExisting.disabled = false; status.textContent = error.message; }
      };
    }).catch(() => {});
  }
  const sources = [["sentence", "Japanese sentence"], ["translation", "English translation"], ["furigana", "Sentence reading / furigana"], ["image", "Picture"], ["audio", "Audio"], ["id", "Source ID (optional)"], ["source", "Show / source title (when available)"], ["url", "Page URL (optional)"]];
  const drafts = new Map();
  if (saved) drafts.set(saved.model, saved.fieldMap);
  let currentModel = "", generation = 0, saving = false;
  const mapping = () => Object.fromEntries(sources.map(([key]) => [key, form.elements[`map_${key}`]?.value || ""]));
  async function loadFields(auto = false) {
    if (currentModel && !auto) drafts.set(currentModel, mapping());
    const model = form.elements.model.value, version = ++generation;
    form.querySelector(".ik-save").disabled = true;
    status.textContent = "Loading fields from Anki…";
    try {
      const { fields, suggested } = await send({ type: "fields", model, connection: form.elements.connection.value });
      if (version !== generation) return;
      const selected = !auto && drafts.get(model) || suggested;
      const container = form.querySelector(".ik-mappings");
      container.replaceChildren();
      for (const [key, title] of sources) {
        const label = document.createElement("label"); label.textContent = title;
        const select = document.createElement("select"); select.name = `map_${key}`;
        select.add(new Option(["sentence", "translation", "furigana", "image", "audio"].includes(key) ? "Choose a field…" : "Do not include", ""));
        for (const field of fields) select.add(new Option(field, field));
        select.value = fields.includes(selected?.[key]) ? selected[key] : "";
        label.append(select); container.append(label);
      }
      currentModel = model;
      form.querySelector(".ik-field-help").textContent = `Anki needs content in its first field: ${fields[0] || "(none)"}. Your note's card template controls which mapped fields appear during review.`;
      status.textContent = "Connected to Anki. Review the mappings, then save.";
      form.querySelector(".ik-save").disabled = false;
    } catch (error) { if (version === generation) status.textContent = error.message; }
  }
  form.elements.model.onchange = () => loadFields();
  form.querySelector(".ik-auto").onclick = () => loadFields(true);
  form.querySelector(".ik-test").onclick = async () => {
    const target = form.querySelector(".ik-connection-status"); target.textContent = "Testing…";
    try { const result = await send({ type: "testConnection", connection: form.elements.connection.value }); target.textContent = `Connected (AnkiConnect ${result.version})`; }
    catch (error) { target.textContent = error.message; }
  };
  return new Promise(resolve => {
    const close = result => { if (saving) return; generation++; backdrop.remove(); previousFocus?.focus(); resolve(result); };
    form.querySelector(".ik-cancel").onclick = () => close(false);
    backdrop.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(false); }
      if (event.key === "Tab") {
        const controls = [...form.querySelectorAll("button,input,select")].filter(el => !el.disabled && !el.closest("[hidden]"));
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (saving) return;
      const payload = { type: "configure", connection: form.elements.connection.value, deck: deckSelect.value || clean(newDeck.value), createDeck: !deckSelect.value, model: form.elements.model.value, fieldMap: mapping(), skipPreview: form.elements.skipPreview.checked, useOriginalAnkiOnly: form.elements.useOriginalAnkiOnly.checked };
      saving = true; const controls = [...form.querySelectorAll("button,input,select")]; controls.forEach(el => el.disabled = true);
      status.textContent = "Saving settings…";
      try { await send(payload); setOriginalAnkiOnly(payload.useOriginalAnkiOnly); saving = false; close(true); }
      catch (error) { saving = false; controls.forEach(el => el.disabled = false); status.textContent = error.message; }
    });
    deckSelect.focus(); loadFields();
  });
}

function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }

function scan(root = document) {
  const candidates = [];
  if (root.matches?.("a,button")) candidates.push(root);
  const descendants = root.querySelectorAll?.("a,button") || [];
  candidates.push(...descendants);
  candidates.forEach((el) => {
    if (clean(el.textContent) === "Mining") addButton(el);
  });
}

const pendingRoots = new Set();
let scanQueued = false;

function scheduleScan(root) {
  pendingRoots.add(root);
  if (scanQueued) return;
  scanQueued = true;
  requestAnimationFrame(() => {
    scanQueued = false;
    const roots = [...pendingRoots];
    pendingRoots.clear();
    roots.forEach(scan);
  });
}

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scheduleScan(node);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
chrome.storage.local.get("setup").then(({ setup }) => setOriginalAnkiOnly(setup?.useOriginalAnkiOnly));
scan();
