// Versioned filename ensures Chrome refreshes this unpacked service worker.
import "./installer-probe.js";
const DEFAULT_ANKI_URL = "http://127.0.0.1:8765";
const ANKI_REQUEST_TIMEOUT_MS = 8000;
const ADD_OPERATION_TIMEOUT_MS = 12000;
const IMMERSIONKIT_REQUEST_TIMEOUT_MS = 10000;
const BUSY_MESSAGE = "Your Anki is busy right now; try again later.";
const OFFLINE_MESSAGE = "Can't reach AnkiConnect. Open Anki, then try again.";
const DEFAULT_MODEL_NAME = "ImmersionKit Full Card";
const DEFAULT_MODEL_FIELDS = ["Sentence", "Translation", "Furigana", "Image", "Audio", "Source", "Source ID", "URL"];
const TEMPLATE_REVISION = 5;
const LEGACY_V2_SIGNATURES = { front: "b3duu8", back: "1rj835w", css: "xpkxat" };
const LEGACY_V3_SIGNATURES = { front: "wqkphf", back: "skbj6b", css: "1493s52" };
const LEGACY_V4_SIGNATURES = { front: "5gnity", back: "3e510a", css: "1qkuhgb" };
const LEGACY_MODEL_FRONT = `<main class="ik-card">
  <div class="ik-image">{{Image}}</div>
  <div class="ik-sentence">{{Sentence}}</div>
  <div class="ik-audio">{{Audio}}</div>
</main>`;
const LEGACY_MODEL_BACK = `{{FrontSide}}
<hr id="answer">
<section class="ik-answer">
  <div class="ik-translation">{{Translation}}</div>
  {{#Furigana}}<div class="ik-furigana">{{Furigana}}</div>{{/Furigana}}
  {{#Source}}<div class="ik-source">{{Source}}</div>{{/Source}}
  {{#URL}}<a class="ik-link" href="{{URL}}">Open ImmersionKit source</a>{{/URL}}
  {{#Source ID}}<div class="ik-id">{{Source ID}}</div>{{/Source ID}}
</section>`;
const LEGACY_MODEL_CSS = `.card{margin:0;background:#f5f3ee;color:#202124;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center}.ik-card,.ik-answer{box-sizing:border-box;max-width:720px;margin:0 auto;padding:24px}.ik-image img{display:block;width:100%;max-height:360px;object-fit:contain;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.16)}.ik-sentence{margin:22px 0 12px;font-size:34px;font-weight:700;line-height:1.45}.ik-audio{min-height:24px}.ik-answer{padding-top:14px}.ik-translation{font-size:25px;line-height:1.45}.ik-furigana{margin-top:14px;color:#59636d;font-size:20px;line-height:1.5}.ik-source{margin-top:20px;font-weight:650;color:#087f8c}.ik-link{display:inline-block;margin-top:8px;color:#087f8c}.ik-id{margin-top:16px;color:#91979d;font-size:11px}#answer{max-width:680px;border:0;border-top:1px solid #d5d1c8}@media(max-width:520px){.ik-card,.ik-answer{padding:16px}.ik-sentence{font-size:27px}.ik-translation{font-size:21px}}`;
const DEFAULT_MODEL_FRONT = `<!-- ImmersionKit Full Card template v${TEMPLATE_REVISION} -->
{{#Sentence}}
<main class="ik-shell ik-question">
  <div class="ik-kicker">Listen · understand</div>
  {{#Image}}<div class="ik-media">{{Image}}</div>{{/Image}}
  <div class="ik-sentence" lang="ja">{{Sentence}}</div>
  {{#Audio}}<div class="ik-audio" aria-label="Sentence audio">{{Audio}}</div>{{/Audio}}
  {{#Furigana}}
  <details class="ik-furigana-toggle ik-front-hint">
    <summary>Furigana</summary>
    <div class="ik-hint-reading" lang="ja">{{furigana:Furigana}}</div>
  </details>
  {{/Furigana}}
</main>
{{/Sentence}}`;
const DEFAULT_MODEL_BACK = `<!-- ImmersionKit Full Card template v${TEMPLATE_REVISION} -->
<div class="ik-back-context" onclick="var media=event.target.closest('.ik-media');if(media){var expanded=this.classList.toggle('ik-image-expanded');media.setAttribute('aria-expanded',String(expanded));}">
  {{FrontSide}}
</div>
<div class="ik-divider" role="presentation"></div>
<section class="ik-shell ik-answer">
  <div class="ik-kicker">Meaning</div>
  <div class="ik-translation" dir="auto">{{Translation}}</div>

  {{#Source}}<div class="ik-source">{{Source}}</div>{{/Source}}
  {{#URL}}<a class="ik-source-link" href="{{URL}}">Open on ImmersionKit <span aria-hidden="true">↗</span></a>{{/URL}}

  <details class="ik-details">
    <summary>Card details</summary>
    <div class="ik-details-body">
      {{#Source ID}}<div><span>Source ID</span><code>{{Source ID}}</code></div>{{/Source ID}}
      <div><span>Deck</span><b>{{Deck}}</b></div>
      <div><span>Tags</span><b>{{Tags}}</b></div>
    </div>
  </details>
</section>`;
const DEFAULT_MODEL_CSS = `/* ImmersionKit Full Card template v${TEMPLATE_REVISION} */
:root {
  --ik-bg: #f4f1ea;
  --ik-surface: #fffdf9;
  --ik-surface-soft: #e9f4f3;
  --ik-text: #202528;
  --ik-muted: #667074;
  --ik-border: #d8d5cd;
  --ik-accent: #087f8c;
  --ik-accent-dark: #05616b;
  --ik-shadow: 0 18px 50px rgba(32, 37, 40, .12);
}

.card {
  box-sizing: border-box;
  min-height: 100vh;
  margin: 0;
  padding: 22px 14px 40px;
  background: var(--ik-bg);
  color: var(--ik-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif;
  text-align: center;
  -webkit-font-smoothing: antialiased;
}

*, *::before, *::after { box-sizing: border-box; }

.ik-shell {
  width: min(100%, 760px);
  margin: 0 auto;
  padding: 26px;
  border: 1px solid var(--ik-border);
  border-radius: 22px;
  background: var(--ik-surface);
  box-shadow: var(--ik-shadow);
}

.ik-kicker {
  margin-bottom: 16px;
  color: var(--ik-accent);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.ik-media {
  overflow: hidden;
  margin: 0 auto 24px;
  border-radius: 16px;
  background: #15191b;
  box-shadow: 0 10px 30px rgba(0, 0, 0, .18);
}

.ik-media img {
  display: block;
  width: 100%;
  max-height: 420px;
  margin: 0 auto;
  object-fit: contain;
}

.ik-back-context .ik-media {
  width: 50%;
  max-width: 360px;
  cursor: zoom-in;
  transition: width .18s ease, max-width .18s ease;
}

.ik-back-context.ik-image-expanded .ik-media {
  width: 100%;
  max-width: none;
  cursor: zoom-out;
}

.ik-sentence {
  margin: 6px auto 14px;
  font-size: 31px;
  font-weight: 720;
  line-height: 1.48;
  letter-spacing: .015em;
  overflow-wrap: anywhere;
}

.ik-audio {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
}

.ik-furigana-toggle {
  margin: 16px auto 0;
  color: var(--ik-muted);
}

.ik-furigana-toggle summary {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 9px 16px;
  border: 1px solid var(--ik-border);
  border-radius: 999px;
  background: transparent;
  color: var(--ik-accent-dark);
  cursor: pointer;
  font-size: 14px;
  font-weight: 750;
  list-style: none;
  -webkit-tap-highlight-color: transparent;
}

.ik-furigana-toggle summary::-webkit-details-marker { display: none; }
.ik-furigana-toggle summary::after { content: "＋"; margin-left: 8px; font-size: 15px; }
.ik-furigana-toggle[open] summary::after { content: "−"; }
.ik-furigana-toggle summary:hover { background: var(--ik-surface-soft); }
.ik-furigana-toggle summary:focus-visible { outline: 3px solid var(--ik-accent); outline-offset: 3px; }

.ik-hint-reading {
  margin-top: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--ik-surface-soft);
  font-size: 21px;
  line-height: 1.75;
}

.ik-hint-reading ruby { ruby-position: over; }
.ik-hint-reading rt { color: var(--ik-accent-dark); font-size: .55em; font-weight: 650; }

.ik-divider {
  width: min(86%, 620px);
  height: 1px;
  margin: 24px auto;
  background: var(--ik-border);
}

.ik-answer { box-shadow: none; }

.ik-translation {
  max-width: 660px;
  margin: 0 auto;
  font-size: 27px;
  font-weight: 650;
  line-height: 1.5;
}

.ik-source {
  margin-top: 24px;
  color: var(--ik-muted);
  font-size: 15px;
  font-weight: 700;
}

.ik-source-link {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  margin-top: 10px;
  padding: 10px 16px;
  border: 1px solid var(--ik-accent);
  border-radius: 999px;
  color: var(--ik-accent-dark);
  font-size: 14px;
  font-weight: 750;
  text-decoration: none;
}

.ik-source-link:hover { background: var(--ik-surface-soft); }

.ik-details {
  max-width: 560px;
  margin: 24px auto 0;
  border-top: 1px solid var(--ik-border);
  color: var(--ik-muted);
  font-size: 12px;
  text-align: left;
}

.ik-details summary {
  min-height: 44px;
  padding: 14px 4px 8px;
  cursor: pointer;
  font-weight: 700;
  text-align: center;
}

.ik-details-body { padding: 6px 4px 0; }
.ik-details-body div { display: grid; grid-template-columns: 84px 1fr; gap: 10px; padding: 5px 0; }
.ik-details-body span { color: var(--ik-muted); }
.ik-details-body b, .ik-details-body code { min-width: 0; color: var(--ik-text); font: inherit; overflow-wrap: anywhere; }

.nightMode, .night_mode {
  --ik-bg: #111719;
  --ik-surface: #1b2326;
  --ik-surface-soft: #203538;
  --ik-text: #f2f4f3;
  --ik-muted: #aab4b6;
  --ik-border: #354246;
  --ik-accent: #63d3da;
  --ik-accent-dark: #8fe4e8;
  --ik-shadow: 0 18px 50px rgba(0, 0, 0, .32);
}

@media (max-width: 520px) {
  .card { padding: 10px 8px 28px; }
  .ik-shell { padding: 18px 14px; border-radius: 16px; }
  .ik-media { margin-bottom: 18px; border-radius: 12px; }
  .ik-sentence { font-size: 25px; line-height: 1.5; }
  .ik-translation { font-size: 23px; }
  .ik-hint-reading { font-size: 19px; }
  .ik-divider { margin: 16px auto; }
}

@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }`;

async function configuredUrl() {
  const { connection } = await chrome.storage.local.get("connection");
  return connection || DEFAULT_ANKI_URL;
}

function localUrl(value) {
  const parsed = new URL(String(value || DEFAULT_ANKI_URL));
  if (!/^https?:$/.test(parsed.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("AnkiConnect must use a local URL (127.0.0.1, localhost, or ::1).");
  }
  return parsed.toString().replace(/\/$/, "");
}

async function anki(action, params = {}, urlOverride = "", timeoutMs = ANKI_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(localUrl(urlOverride || await configuredUrl()), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AnkiConnect returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(body.error);
    return body.result;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(BUSY_MESSAGE);
    }
    if (error instanceof TypeError || /failed to fetch|fetch failed|networkerror/i.test(String(error?.message || ""))) {
      throw new Error(OFFLINE_MESSAGE);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function filename(url, fallback) {
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").pop().split("?")[0];
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) return base.replace(/[^a-z0-9._-]/gi, "_");
  } catch (_) {}
  return fallback;
}

function mediaName(prefix, source, extension) {
  const hash = [...new TextEncoder().encode(source)].reduce((n, b) => ((n * 33) ^ b) >>> 0, 5381).toString(36);
  return `${prefix}-${hash}.${extension}`;
}

async function storeMedia(url, kind, call = anki) {
  if (!url) return "";
  const ext = kind === "audio" ? "mp3" : "jpg";
  const name = filename(url, mediaName(`immersionkit-${kind}`, url, ext));
  await call("storeMediaFile", { filename: name, url, deleteExisting: false });
  return kind === "audio" ? `[sound:${name}]` : `<img src="${name}">`;
}

function normalize(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

function templateSignature(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function fieldFor(fields, candidates) {
  return fields.find((field) => candidates.includes(normalize(field))) || "";
}

function resolveFieldMap(modelFields) {
  return {
    sentence: fieldFor(modelFields, ["expression", "sentence", "japanese", "front"]),
    translation: fieldFor(modelFields, ["english", "translation", "meaning", "back"]),
    furigana: fieldFor(modelFields, ["reading", "furigana", "sentencewithfurigana"]),
    image: fieldFor(modelFields, ["image", "picture", "sentenceimage"]),
    audio: fieldFor(modelFields, ["audiosentence", "sentenceaudio", "audio", "sound"]),
    id: fieldFor(modelFields, ["id", "sourceid", "immersionkitid"]),
    source: fieldFor(modelFields, ["source", "show", "title"]),
    url: fieldFor(modelFields, ["url", "sourceurl", "link"])
  };
}

async function ensureDefaultModel() {
  let models = await anki("modelNames");
  if (!models.includes(DEFAULT_MODEL_NAME)) {
    await anki("createModel", {
      modelName: DEFAULT_MODEL_NAME,
      inOrderFields: DEFAULT_MODEL_FIELDS,
      css: DEFAULT_MODEL_CSS,
      isCloze: false,
      cardTemplates: [{ Name: "Recognition", Front: DEFAULT_MODEL_FRONT, Back: DEFAULT_MODEL_BACK }]
    });
    models = await anki("modelNames");
  } else {
    const [fields, templates, styling] = await Promise.all([
      anki("modelFieldNames", { modelName: DEFAULT_MODEL_NAME }),
      anki("modelTemplates", { modelName: DEFAULT_MODEL_NAME }),
      anki("modelStyling", { modelName: DEFAULT_MODEL_NAME })
    ]);
    const recognition = templates?.Recognition;
    const hasBundledFields = JSON.stringify(fields) === JSON.stringify(DEFAULT_MODEL_FIELDS);
    const isUnmodifiedV1 = hasBundledFields
      && recognition?.Front === LEGACY_MODEL_FRONT
      && recognition?.Back === LEGACY_MODEL_BACK
      && styling?.css === LEGACY_MODEL_CSS;
    const isUnmodifiedV2 = hasBundledFields
      && templateSignature(recognition?.Front) === LEGACY_V2_SIGNATURES.front
      && templateSignature(recognition?.Back) === LEGACY_V2_SIGNATURES.back
      && templateSignature(styling?.css) === LEGACY_V2_SIGNATURES.css;
    const isUnmodifiedV3 = hasBundledFields
      && templateSignature(recognition?.Front) === LEGACY_V3_SIGNATURES.front
      && templateSignature(recognition?.Back) === LEGACY_V3_SIGNATURES.back
      && templateSignature(styling?.css) === LEGACY_V3_SIGNATURES.css;
    const isUnmodifiedV4 = hasBundledFields
      && templateSignature(recognition?.Front) === LEGACY_V4_SIGNATURES.front
      && templateSignature(recognition?.Back) === LEGACY_V4_SIGNATURES.back
      && templateSignature(styling?.css) === LEGACY_V4_SIGNATURES.css;
    if (isUnmodifiedV1 || isUnmodifiedV2 || isUnmodifiedV3 || isUnmodifiedV4) {
      await Promise.all([
        anki("updateModelTemplates", { model: { name: DEFAULT_MODEL_NAME, templates: { Recognition: { Front: DEFAULT_MODEL_FRONT, Back: DEFAULT_MODEL_BACK } } } }),
        anki("updateModelStyling", { model: { name: DEFAULT_MODEL_NAME, css: DEFAULT_MODEL_CSS } })
      ]);
    }
  }
  return models;
}

async function getSetup() {
  const [decks, models, saved, connection] = await Promise.all([
    anki("deckNames"), ensureDefaultModel(), chrome.storage.local.get("setup"), configuredUrl()
  ]);
  return { decks, models, saved: saved.setup || null, connection };
}

function validateMap(fields, map) {
  for (const key of ["sentence", "translation", "furigana", "image", "audio"]) {
    if (!map[key]) throw new Error(`Choose an Anki field for ${key}.`);
  }
  for (const target of Object.values(map)) {
    if (target && !fields.includes(target)) throw new Error(`Anki field “${target}” no longer exists. Open settings to update the mapping.`);
  }
  if (!Object.values(map).includes(fields[0])) throw new Error(`Map content to the first Anki field (“${fields[0]}”); Anki requires it for new notes.`);
}

function noteQuery(setup, data) {
  const map = setup.fieldMap || {};
  const quote = value => String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const target = map.id || map.sentence;
  const value = map.id ? (data.id || data.sentence) : data.sentence;
  if (!target || !value) return "";
  return `note:"${quote(setup.model)}" "${quote(target)}:${quote(value)}"`;
}

async function findExistingCard(data, call = anki) {
  const { setup } = await chrome.storage.local.get("setup");
  if (!setup) return { noteId: null };
  const query = noteQuery(setup, data || {});
  if (!query) return { noteId: null };
  const notes = await call("findNotes", { query });
  return { noteId: notes[0] || null, deck: setup.deck };
}

async function configure({ deck, createDeck, model, fieldMap: requestedMap, connection, skipPreview, useOriginalAnkiOnly }) {
  deck = String(deck || "").trim();
  if (!deck) throw new Error("Enter a deck name.");
  const selectedConnection = localUrl(connection || await configuredUrl());
  const models = await anki("modelNames", {}, selectedConnection);
  const selectedModel = model || models.find((m) => m === DEFAULT_MODEL_NAME) || models.find((m) => /immersion.*kit.*sentence/i.test(m)) || models[0];
  if (!selectedModel) throw new Error("No Anki note types are available.");
  const fields = await anki("modelFieldNames", { modelName: selectedModel }, selectedConnection);
  const defaults = resolveFieldMap(fields);
  const fieldMap = Object.fromEntries(Object.keys(defaults).map(key => [key, requestedMap ? String(requestedMap[key] || "") : defaults[key]]));
  validateMap(fields, fieldMap);
  if (createDeck) await anki("createDeck", { deck }, selectedConnection);
  else if (!(await anki("deckNames", {}, selectedConnection)).includes(deck)) throw new Error("That deck no longer exists. Choose a deck again.");
  const setup = { deck, model: selectedModel, fieldMap, skipPreview: Boolean(skipPreview), useOriginalAnkiOnly: Boolean(useOriginalAnkiOnly) };
  await chrome.storage.local.set({ setup, connection: selectedConnection });
  return setup;
}

async function addCard(data) {
  const deadline = Date.now() + ADD_OPERATION_TIMEOUT_MS;
  const call = async (action, params = {}) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(BUSY_MESSAGE);
    return anki(action, params, "", Math.min(ANKI_REQUEST_TIMEOUT_MS, remaining));
  };
  const { setup } = await chrome.storage.local.get("setup");
  if (!setup) throw new Error("Choose an Anki deck first.");
  const fields = await call("modelFieldNames", { modelName: setup.model });
  const map = setup.fieldMap || resolveFieldMap(fields);
  validateMap(fields, map);
  const existing = await findExistingCard(data, call);
  if (existing.noteId) return { ...existing, alreadyExists: true };
  const [image, audio] = await Promise.all([storeMedia(data.imageUrl, "image", call), storeMedia(data.audioUrl, "audio", call)]);
  const cardFields = Object.fromEntries(fields.map((name) => [name, ""]));
  const escape = value => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const values = { sentence: escape(data.sentence), translation: escape(data.translation), furigana: escape(data.furigana || data.sentence), image, audio, id: escape(data.id || data.sentence), source: escape(data.source), url: escape(data.url) };
  for (const [key, target] of Object.entries(map)) {
    if (target && values[key]) cardFields[target] += (cardFields[target] ? "<br>" : "") + values[key];
  }
  const noteId = await call("addNote", { note: { deckName: setup.deck, modelName: setup.model, fields: cardFields, tags: ["ImmersionKit", "sentence-mining"], options: { allowDuplicate: false } } });
  return { noteId, deck: setup.deck };
}

function trustedImmersionKitUrl(value) {
  const parsed = new URL(String(value || ""));
  if (parsed.protocol !== "https:" || (parsed.hostname !== "immersionkit.com" && !parsed.hostname.endsWith(".immersionkit.com"))) {
    throw new Error("The card must come from ImmersionKit.");
  }
  return parsed;
}

function sourceFromMediaUrl(value) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    const mediaIndex = parts.lastIndexOf("media");
    return mediaIndex > 0 ? decodeURIComponent(parts[mediaIndex - 1]).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() : "";
  } catch (_) { return ""; }
}

async function immersionKitSearch(query, exactMatch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMMERSIONKIT_REQUEST_TIMEOUT_MS);
  try {
    const url = new URL("https://apiv2.immersionkit.com/search");
    url.searchParams.set("q", query);
    url.searchParams.set("exactMatch", String(Boolean(exactMatch)));
    url.searchParams.set("limit", "100");
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`ImmersionKit returned HTTP ${response.status}`);
    const body = await response.json();
    return Array.isArray(body) ? body : body.examples || [];
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("ImmersionKit took too long to provide this card. Try again.");
    throw error;
  } finally { clearTimeout(timeout); }
}

async function resolveExample({ id, imageUrl, pageUrl, sentenceHint }) {
  id = String(id || "").trim();
  if (!id) throw new Error("ImmersionKit did not expose an ID for this result. Reload the page and try again.");
  const page = trustedImmersionKitUrl(pageUrl);
  const image = new URL(String(imageUrl || ""), page);
  if (image.protocol !== "https:") throw new Error("ImmersionKit did not expose a usable picture URL.");

  const candidates = [];
  const keyword = page.searchParams.get("keyword") || page.searchParams.get("q") || "";
  if (String(sentenceHint || "").trim()) candidates.push([String(sentenceHint).trim(), true]);
  if (keyword.trim()) candidates.push([keyword.trim(), page.searchParams.get("exact") === "true"]);
  if (String(sentenceHint || "").trim()) candidates.push([String(sentenceHint).trim(), false]);
  const seen = new Set();
  let example = null;
  for (const [query, exact] of candidates) {
    const key = `${query}\u0000${exact}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const examples = await immersionKitSearch(query, exact);
    example = examples.find(item => item?.id === id);
    if (example) break;
  }
  if (!example) throw new Error("ImmersionKit could not provide the full data for this result. Reload the page and try again.");

  const audioUrl = example.sound_url || example.audio_url || (example.sound ? new URL(example.sound, image).href : "");
  const resolvedImage = example.image_url || image.href;
  if (!audioUrl) throw new Error("ImmersionKit did not provide audio for this result.");
  return {
    sentence: String(example.sentence || ""),
    translation: String(example.translation || ""),
    furigana: String(example.sentence_with_furigana || ""),
    imageUrl: resolvedImage,
    audioUrl,
    id,
    source: sourceFromMediaUrl(resolvedImage),
    url: page.href
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const supportedTypes = new Set([
    "setup",
    "testConnection",
    "view",
    "configure",
    "fields",
    "resolveExample",
    "findExisting",
    "add",
    "health"
  ]);
  if (!supportedTypes.has(message?.type)) return;
  (async () => {
    if (message.type === "setup") return getSetup();
    if (message.type === "testConnection") return { version: await anki("version", {}, localUrl(message.connection)) };
    if (message.type === "view") {
      const noteId = Number(message.noteId);
      if (!Number.isSafeInteger(noteId) || noteId <= 0) throw new Error("That Anki note is no longer available.");
      const cards = await anki("guiBrowse", { query: `nid:${noteId}` });
      if (!cards.length) throw new Error("That Anki note is no longer available.");
      const cardId = Number(cards[0]);
      try {
        await anki("guiSelectCard", { card: cardId });
      } catch (error) {
        if (!/unsupported action/i.test(String(error?.message || ""))) throw error;
        await anki("guiSelectNote", { note: cardId });
      }
      return true;
    }
    if (message.type === "configure") return configure(message);
    if (message.type === "fields") {
      const fields = await anki("modelFieldNames", { modelName: message.model }, localUrl(message.connection || await configuredUrl()));
      return { fields, suggested: resolveFieldMap(fields) };
    }
    if (message.type === "resolveExample") return resolveExample(message);
    if (message.type === "findExisting") return findExistingCard(message.data);
    if (message.type === "add") return addCard(message.data);
    if (message.type === "health") return { version: await anki("version") };
    throw new Error("Unknown request.");
  })().then((result) => sendResponse({ ok: true, result }), (error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
