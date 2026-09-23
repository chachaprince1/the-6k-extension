"use strict";

import "./core.js";
import "./jpdb-connect-background.js";
import "./installer-probe.js";

const Core = globalThis.JYACore;
const YOMITAN_ANKI_SETTINGS_URL = "chrome-extension://likgccmbimhjbgkjambclfkhldnlhbnn/settings.html#anki";
const YOMITAN_API_SETTINGS_URL = "chrome-extension://likgccmbimhjbgkjambclfkhldnlhbnn/settings.html#general";
const JPDB_API_ROOT = "https://jpdb.io/api/v1";
const DEFAULT_TIMEOUT_MS = 20_000;
const MEDIA_TIMEOUT_MS = 60_000;
const EXPORT_MODEL_NAME = "jpdb → Yomitan → Anki";
const storageAccessReady = chrome.storage.local.setAccessLevel({accessLevel: "TRUSTED_CONTEXTS"});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    void chrome.tabs.create({url: chrome.runtime.getURL("onboarding.html")});
  }
});

function localEndpoint(value, fallback) {
  const parsed = new URL(String(value || fallback));
  const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (parsed.protocol !== "http:" || !allowedHosts.has(parsed.hostname)) {
    throw new Error("Local services must use an http://127.0.0.1, localhost, or ::1 address.");
  }
  return parsed.toString().replace(/\/$/, "");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`Timed out while contacting ${new URL(url).host}.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function settings() {
  await storageAccessReady;
  const stored = await chrome.storage.local.get("settings");
  return Core.mergeSettings(stored.settings);
}

function contentSettings(config) {
  return {
    hasJpdbApiKey: Boolean(String(config.jpdbApiKey || "").trim()),
    includeMedia: Boolean(config.includeMedia),
    matchExactFlashcard: config.matchExactFlashcard !== false,
    matchSameWord: Boolean(config.matchSameWord),
    filters: {
      skipParticles: Boolean(config.filters?.skipParticles),
      skipVocalizations: Boolean(config.filters?.skipVocalizations),
      skipSemanticGrammar: Boolean(config.filters?.skipSemanticGrammar),
      skipTitleHonorifics: Boolean(config.filters?.skipTitleHonorifics ?? config.filters?.skipHonorifics),
      skipTitlePositions: Boolean(config.filters?.skipTitlePositions ?? config.filters?.skipHonorifics),
      skipJlptN5: Boolean(config.filters?.skipJlptN5),
      skipJlptN4: Boolean(config.filters?.skipJlptN4),
      skipFrequencyAbove10k: Boolean(config.filters?.skipFrequencyAbove10k),
      skipFrequencyAbove20k: Boolean(config.filters?.skipFrequencyAbove20k),
      skipFrequencyAbove30k: Boolean(config.filters?.skipFrequencyAbove30k),
      skipFrequencyAbove45k: Boolean(config.filters?.skipFrequencyAbove45k),
      skipUsedOnce: Boolean(config.filters?.skipUsedOnce)
    },
    customExcludedIds: Array.isArray(config.customExcludedIds)
      ? config.customExcludedIds.map(String).slice(0, 10_000)
      : []
  };
}

function senderUrl(sender) {
  try {
    return new URL(String(sender?.url || ""));
  } catch (_) {
    return null;
  }
}

function requireOnboardingSender(sender) {
  const url = senderUrl(sender);
  const expected = new URL(chrome.runtime.getURL("onboarding.html"));
  if (!url || url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname) {
    throw new Error("This request is only available from the extension setup.");
  }
}

function requireJpdbContentSender(sender, {deckOnly = false} = {}) {
  const url = senderUrl(sender);
  const allowedPath = deckOnly
    ? /^\/deck\/?$/.test(url?.pathname || "")
    : /^(?:\/deck\/?|\/anime(?:\/|$))/.test(url?.pathname || "");
  if (url?.origin !== "https://jpdb.io" || !allowedPath) {
    throw new Error("This request is only available from a jpdb import page.");
  }
  if (deckOnly && !/^\d+$/.test(url.searchParams.get("id") || "")) {
    throw new Error("This request requires a valid jpdb deck URL.");
  }
  return url;
}

async function getContentSettings(sender) {
  requireJpdbContentSender(sender);
  return contentSettings(await settings());
}

async function saveContentPreferences(value, sender) {
  requireJpdbContentSender(sender, {deckOnly: true});
  const requested = value && typeof value === "object" ? value : {};
  const current = await settings();
  const next = {...current};

  if (Object.prototype.hasOwnProperty.call(requested, "includeMedia")) {
    next.includeMedia = Boolean(requested.includeMedia);
  }
  for (const key of ["matchExactFlashcard", "matchSameWord"]) {
    if (Object.prototype.hasOwnProperty.call(requested, key)) next[key] = Boolean(requested[key]);
  }
  if (requested.filters && typeof requested.filters === "object") {
    const filters = {...current.filters};
    for (const key of ["skipParticles", "skipVocalizations", "skipSemanticGrammar", "skipTitleHonorifics", "skipTitlePositions", "skipJlptN5", "skipJlptN4", "skipFrequencyAbove10k", "skipFrequencyAbove20k", "skipFrequencyAbove30k", "skipFrequencyAbove45k", "skipUsedOnce"]) {
      if (Object.prototype.hasOwnProperty.call(requested.filters, key)) filters[key] = Boolean(requested.filters[key]);
    }
    next.filters = filters;
  }

  await chrome.storage.local.set({settings: next});
  return contentSettings(next);
}

async function downloadApkg(message, sender) {
  requireJpdbContentSender(sender, {deckOnly: true});
  const filename = Core.sanitizeFilename(message.filename, "jpdb-yomitan-anki.apkg").replace(/\.apkg$/i, "") + ".apkg";
  const data = String(message.data || "").replace(/\s/g, "");
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("The APKG export data is invalid.");
  return chrome.downloads.download({url: `data:application/apkg;base64,${data}`, filename, saveAs: false});
}

async function showDownload(downloadId, sender) {
  requireJpdbContentSender(sender, {deckOnly: true});
  const shown = await chrome.downloads.show(Number(downloadId));
  if (!shown) throw new Error("Chrome could not reveal the exported APKG yet.");
  return true;
}

async function clearJpdbConnection() {
  const current = await settings();
  await chrome.storage.local.set({settings: {...current, jpdbApiKey: ""}});
  await chrome.storage.session.remove("jpdbConnectAttempt");
  return true;
}

async function postJson(url, body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {"Content-Type": "application/json", ...headers},
    body: body === undefined ? undefined : JSON.stringify(body)
  }, timeoutMs);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
    throw new Error(`${new URL(url).host} returned an invalid response.`);
  }
  if (!response.ok) {
    const detail = typeof data?.error_message === "string" ? data.error_message : typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : "Request failed";
    throw new Error(`${detail} (HTTP ${response.status})`);
  }
  return data;
}

async function yomitan(path, body, config, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = `${localEndpoint(config?.yomitanUrl, Core.DEFAULT_SETTINGS.yomitanUrl)}/${path}`;
  return postJson(url, body, {}, timeoutMs);
}

function numericRanks(value, output = []) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 9_999_999) output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => numericRanks(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => numericRanks(item, output));
  else if (typeof value === "string") {
    for (const match of value.matchAll(/(?:^|[^0-9])(\d{1,6})(?:[^0-9]|$)/g)) {
      const rank = Number(match[1]);
      if (rank > 0 && rank < 9_999_999) output.push(rank);
    }
  }
  return output;
}

function frequencyRankFromFields(fieldSets, query) {
  const ranks = [];
  const all = Array.isArray(fieldSets) ? fieldSets : [];
  const wanted = String(query || "").normalize("NFKC").replace(/\s/g, "");
  const matching = wanted ? all.filter((fields) => {
    const expression = String(fields?.expression || "").normalize("NFKC").replace(/\s/g, "");
    const reading = String(fields?.reading || "").normalize("NFKC").replace(/\s/g, "");
    return expression === wanted || reading === wanted;
  }) : [];
  for (const fields of (matching.length ? matching : all)) {
    const harmonic = fields?.["frequency-harmonic-rank"];
    const harmonicRanks = numericRanks(harmonic);
    if (harmonicRanks.length) ranks.push(...harmonicRanks);
    else numericRanks(fields?.frequencies, ranks);
  }
  return ranks.length ? Math.min(...ranks) : null;
}

async function getYomitanFrequencyRanks(words) {
  const config = await settings();
  const unique = new Map();
  for (const word of Array.isArray(words) ? words.slice(0, 5000) : []) {
    if (!word || !word.spelling) continue;
    unique.set(Core.wordKey(word), word);
  }
  const entries = [...unique.entries()];
  const output = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const [, word] = entries[cursor++];
      const queries = [...new Set([String(word.spelling || ""), String(word.reading || "")].filter(Boolean))];
      const ranks = [];
      for (const text of queries) {
        try {
          const result = await yomitan("ankiFields", {
            text,
            type: "term",
            markers: ["expression", "reading", "frequencies", "frequency-harmonic-rank"],
            maxEntries: 8,
            includeMedia: false
          }, config);
          const rank = frequencyRankFromFields(result?.fields, text);
          if (rank !== null) ranks.push(rank);
        } catch (_) {
          // Missing dictionary data for one spelling should not abort the import.
        }
      }
      output.push({key: Core.wordKey(word), rank: ranks.length ? Math.min(...ranks) : null});
    }
  };
  await Promise.all(Array.from({length: Math.min(6, Math.max(1, entries.length))}, worker));
  return output;
}

async function anki(action, params, config, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const url = localEndpoint(config?.ankiUrl, Core.DEFAULT_SETTINGS.ankiUrl);
  const payload = await postJson(url, {action, version: 6, params: params || {}}, {}, timeoutMs);
  if (!payload || !("error" in payload) || !("result" in payload)) {
    throw new Error("AnkiConnect returned an unexpected response.");
  }
  if (payload.error) throw new Error(String(payload.error));
  return payload.result;
}

async function sameWordExists(word, config) {
  const expression = String(word?.spelling || "").replace(/([\\"])/g, "\\$1");
  const reading = String(word?.reading || "").normalize("NFKC").trim();
  if (!expression) return false;
  const ids = await anki("findNotes", {query: `"${expression}"`}, config);
  if (!Array.isArray(ids) || !ids.length) return false;
  const infos = await anki("notesInfo", {notes: ids.slice(0, 100)}, config);
  return (infos || []).some((info) => {
    const values = Object.values(info?.fields || {}).map((field) => String(field?.value || "").replace(/<[^>]*>/g, "").normalize("NFKC").trim());
    return values.includes(String(word.spelling).normalize("NFKC").trim()) && (!reading || values.includes(reading));
  });
}

async function jpdb(path, body, config) {
  const token = String(config?.jpdbApiKey || "").trim();
  if (!token) throw new Error("Add your jpdb API key in the extension settings first.");
  return postJson(`${JPDB_API_ROOT}/${path}`, body, {Authorization: `Bearer ${token}`}, DEFAULT_TIMEOUT_MS);
}

async function getConnections() {
  const config = await settings();
  const [jpdbResult, yomitanResult, ankiResult] = await Promise.allSettled([
    jpdb("ping", undefined, config),
    yomitan("serverVersion", undefined, config),
    anki("version", {}, config)
  ]);
  let formats = [];
  let formatError = "";
  if (yomitanResult.status === "fulfilled") {
    try {
      const value = await yomitan("ankiCardFormats", {}, config);
      formats = Array.isArray(value) ? value : [];
    } catch (error) {
      formatError = error.message;
    }
  }
  let decks = [];
  if (ankiResult.status === "fulfilled") {
    try {
      const value = await anki("deckNames", {}, config);
      decks = Array.isArray(value) ? value.map(String).filter(Boolean).sort((left, right) => left.localeCompare(right)) : [];
    } catch (_) {}
  }
  return {
    jpdb: jpdbResult.status === "fulfilled" ? {ok: true} : {ok: false, error: jpdbResult.reason?.message || String(jpdbResult.reason)},
    yomitan: yomitanResult.status === "fulfilled" ? {ok: true, version: yomitanResult.value?.version ?? "connected"} : {ok: false, error: yomitanResult.reason?.message || String(yomitanResult.reason)},
    anki: ankiResult.status === "fulfilled" ? {ok: true, version: ankiResult.value} : {ok: false, error: ankiResult.reason?.message || String(ankiResult.reason)},
    formats,
    formatError,
    decks
  };
}

async function getJpdbDeckWords(deckId) {
  const config = await settings();
  const numericId = Number(deckId);
  if (!Number.isInteger(numericId) || numericId <= 0) throw new Error("This jpdb deck URL has no valid deck ID.");
  let listed = null;
  let fallback = null;
  for (const occurrenceField of ["fetch_occurences", "fetch_occurence", "fetch_occurrence"]) {
    try {
      const candidate = await jpdb("deck/list-vocabulary", {id: numericId, [occurrenceField]: true}, config);
      fallback ||= candidate;
      const candidatePairs = Array.isArray(candidate?.vocabulary) ? candidate.vocabulary : [];
      const candidateCounts = candidate?.occurences ?? candidate?.occurrences ?? candidate?.occurence ?? candidate?.occurrence ?? candidate?.vocabulary_occurrences;
      if ((Array.isArray(candidateCounts) && candidateCounts.length === candidatePairs.length) || candidatePairs.some((pair) => Array.isArray(pair) && Number.isFinite(Number(pair[2])))) {
        listed = candidate;
        break;
      }
    } catch (error) {
      if (!/malformed|schema|HTTP 400/i.test(error?.message || "")) throw error;
    }
  }
  listed ||= fallback || await jpdb("deck/list-vocabulary", {id: numericId}, config);
  const pairs = Array.isArray(listed?.vocabulary) ? listed.vocabulary : [];
  const occurrences = listed?.occurences ?? listed?.occurrences ?? listed?.occurence ?? listed?.occurrence ?? listed?.vocabulary_occurrences ?? [];
  const occurrenceAt = (index, pair) => {
    const direct = Array.isArray(occurrences) ? occurrences[index] : occurrences?.[`${pair?.[0]}:${pair?.[1]}`] ?? occurrences?.[index];
    const count = Number(direct ?? pair?.[2]);
    return Number.isFinite(count) && count > 0 ? count : null;
  };
  if (pairs.length === 0) return [];

  const words = [];
  for (let start = 0; start < pairs.length; start += 100) {
    const slice = pairs.slice(start, start + 100);
    const lookedUp = await jpdb("lookup-vocabulary", {
      list: slice,
      fields: ["spelling", "reading", "frequency_rank", "meanings"]
    }, config);
    const info = Array.isArray(lookedUp?.vocabulary_info) ? lookedUp.vocabulary_info : [];
    for (let index = 0; index < slice.length; index += 1) {
      const pair = slice[index];
      const row = Array.isArray(info[index]) ? info[index] : [];
      words.push({
        jpdbId: String(pair?.[0] ?? ""),
        sid: String(pair?.[1] ?? ""),
        spelling: String(row[0] ?? ""),
        reading: String(row[1] ?? row[0] ?? ""),
        frequencyRank: Number(row[2]) || null,
        meanings: Array.isArray(row[3]) ? row[3] : [],
        occurrences: occurrenceAt(start + index, pair)
      });
    }
  }
  return words.filter((word) => word.spelling);
}

function markerMediaToBase64(content) {
  if (typeof content === "string") {
    const comma = content.startsWith("data:") ? content.indexOf(",") : -1;
    return comma >= 0 ? content.slice(comma + 1) : content;
  }
  let values = null;
  if (Array.isArray(content)) values = content;
  else if (Array.isArray(content?.data)) values = content.data;
  else if (content && typeof content === "object") values = Object.values(content);
  if (!values) return "";
  let binary = "";
  for (let index = 0; index < values.length; index += 0x8000) {
    binary += String.fromCharCode(...values.slice(index, index + 0x8000));
  }
  return btoa(binary);
}

async function storeMedia(result, note, config, storedNames, ensureActive = () => {}) {
  const all = [...(result.dictionaryMedia || []), ...(result.audioMedia || [])];
  const referenced = Object.values(note?.fields || {}).join("\n");
  for (const item of all) {
    ensureActive();
    const filename = String(item?.ankiFilename || "");
    if (!filename || !referenced.includes(filename) || storedNames.has(filename)) continue;
    const data = markerMediaToBase64(item?.content);
    if (!data) continue;
    await anki("storeMediaFile", {filename, data, deleteExisting: false}, config, MEDIA_TIMEOUT_MS);
    ensureActive();
    storedNames.add(filename);
  }
}

function makeNote(format, markerValues, deckName, tags, matchExactFlashcard = true) {
  return {
    deckName,
    modelName: format.model,
    fields: Core.renderFormatFields(format, markerValues),
    tags,
    options: {
      allowDuplicate: !matchExactFlashcard,
      duplicateScope: "collection",
      duplicateScopeOptions: {deckName: null, checkChildren: false, checkAllModels: false}
    }
  };
}

function ankiCardTemplates(templates) {
  if (Array.isArray(templates)) return templates;
  return Object.entries(templates || {}).map(([Name, value]) => ({Name, Front: value?.Front || "", Back: value?.Back || ""}));
}

async function ensureExportModel(format, config) {
  const sourceModel = String(format.model || "");
  const configuredFields = Object.keys(format.fields || {});
  if (!sourceModel || !configuredFields.length) throw new Error("Configure a term card format in Yomitan first.");
  const names = await anki("modelNames", {}, config);
  const exists = Array.isArray(names) && names.includes(EXPORT_MODEL_NAME);
  if (!exists) {
    const [sourceFields, css, templates] = await Promise.all([
      anki("modelFieldNames", {modelName: sourceModel}, config),
      anki("modelStyling", {modelName: sourceModel}, config),
      anki("modelTemplates", {modelName: sourceModel}, config)
    ]);
    const missing = configuredFields.filter((field) => !sourceFields.includes(field));
    if (missing.length) throw new Error(`Yomitan's card format uses fields missing from ${sourceModel}: ${missing.join(", ")}`);
    const cardTemplates = ankiCardTemplates(templates);
    if (!cardTemplates.length) throw new Error(`Could not copy card templates from ${sourceModel}.`);
    await anki("createModel", {modelName: EXPORT_MODEL_NAME, inOrderFields: sourceFields, css: String(css?.css || css || ""), isCloze: false, cardTemplates}, config);
  }
  const modelFields = await anki("modelFieldNames", {modelName: EXPORT_MODEL_NAME}, config);
  const missing = configuredFields.filter((field) => !modelFields.includes(field));
  if (missing.length) throw new Error(`${EXPORT_MODEL_NAME} is missing fields required by Yomitan: ${missing.join(", ")}`);
  return modelFields;
}

async function exportApkg(deckName, config) {
  const mediaDirectory = await anki("getMediaDirPath", {}, config);
  const filename = `jpdb-yomitan-${Date.now()}.apkg`;
  const separator = String(mediaDirectory).includes("\\") ? "\\" : "/";
  const path = `${String(mediaDirectory).replace(/[\\/]+$/, "")}${separator}${filename}`;
  try {
    await anki("exportPackage", {deck: deckName, path, includeSched: false}, config, MEDIA_TIMEOUT_MS);
    const data = await anki("retrieveMediaFile", {filename}, config, MEDIA_TIMEOUT_MS);
    if (!data) throw new Error("Anki created an empty APKG export.");
    return data;
  } finally {
    try { await anki("deleteMediaFile", {filename}, config); } catch (_) {}
  }
}

async function runImport(payload, emit, isCancelled) {
  const ensureActive = () => {
    if (isCancelled()) throw new Error("Import cancelled.");
  };
  const config = await settings();
  ensureActive();
  const formats = await yomitan("ankiCardFormats", {}, config);
  ensureActive();
  const format = Array.isArray(formats) ? formats.find((candidate) => candidate?.type === "term") : null;
  if (!format) throw new Error("Configure a term card format in Yomitan first.");
  if (format.type !== "term") throw new Error("The selected Yomitan format is for kanji. Choose a term format.");
  if (!format.model || !Object.keys(format.fields || {}).length) throw new Error("Configure this card format's Anki note type and fields in Yomitan first.");

  const words = Array.isArray(payload.words) ? payload.words.slice(0, 5000) : [];
  if (!words.length) throw new Error("No vocabulary is selected.");
  const target = payload.target === "export" ? "export" : payload.target === "apkg" ? "apkg" : "anki";
  const isAnkiTarget = target !== "export";
  const deckName = String(payload.deckName || format.deck || "").trim();
  if (!deckName) throw new Error("Enter a destination deck name.");
  const requestedTags = Array.isArray(payload.tags) ? payload.tags : [];
  const tags = [...new Set(["jpdb", ...requestedTags].map(Core.sanitizeTag).filter(Boolean))];
  const includeMedia = isAnkiTarget && Boolean(payload.includeMedia);
  const maxEntries = Math.max(1, Math.min(20, Number(config.maxYomitanEntries) || 8));
  const markers = Core.extractMarkers(format);
  const generated = [];
  const failures = [];
  const storedMedia = new Set();
  let added = 0;
  let duplicates = 0;
  let pending = [];
  let consecutiveRequestFailures = 0;
  let modelFields = Object.keys(format.fields || {});
  let exportFieldOrderVerified = false;

  if (isAnkiTarget) {
    await anki("version", {}, config);
    ensureActive();
    modelFields = await ensureExportModel(format, config);
    ensureActive();
    await anki("createDeck", {deck: deckName}, config);
    ensureActive();
  } else {
    try {
      const liveFields = await ensureExportModel(format, config);
      if (Array.isArray(liveFields) && liveFields.length) {
        const missing = Object.keys(format.fields || {}).filter((field) => !liveFields.includes(field));
        if (!missing.length) {
          modelFields = liveFields;
          exportFieldOrderVerified = true;
        }
      }
    } catch (_) {
      // Offline export remains available. #columns names make manual mapping explicit in Anki.
    }
    ensureActive();
  }

  async function flushNotes() {
    ensureActive();
    if (!isAnkiTarget || pending.length === 0) return;
    const items = pending;
    pending = [];
    for (const item of items) {
      ensureActive();
      if (!item.mediaResult) continue;
      try {
        await storeMedia(item.mediaResult, item.note, config, storedMedia, ensureActive);
      } catch (error) {
        ensureActive();
        item.mediaError = error?.message || String(error);
        failures.push({word: item.word, error: `Media: ${item.mediaError}`});
      }
    }
    const ready = items.filter((item) => !item.mediaError);
    if (!ready.length) return;
    const filtered = [];
    for (const item of ready) {
      if (payload.matchSameWord && await sameWordExists(item.word, config)) duplicates += 1;
      else filtered.push(item);
    }
    if (!filtered.length) return;
    let results;
    try {
      ensureActive();
      results = await anki("multi", {
        actions: filtered.map((item) => ({action: "addNote", version: 6, params: {note: item.note}}))
      }, config, MEDIA_TIMEOUT_MS);
      ensureActive();
    } catch (error) {
      throw new Error(`AnkiConnect stopped after ${added} notes were added and ${duplicates} duplicates were skipped: ${error?.message || String(error)}`);
    }
    for (let index = 0; index < filtered.length; index += 1) {
      const item = results?.[index];
      if (!item?.error && item?.result !== null && item?.result !== undefined) {
        added += 1;
      } else if (/duplicate/i.test(String(item?.error || ""))) {
        duplicates += 1;
      } else {
        failures.push({word: filtered[index].word, error: item?.error || "Anki rejected this note"});
      }
    }
  }

  for (let index = 0; index < words.length; index += 1) {
    if (isCancelled()) throw new Error("Import cancelled.");
    const word = words[index];
    emit({type: "progress", phase: "render", current: index, total: words.length, spelling: word.spelling, added, duplicates, failures: failures.length});
    try {
      const result = await yomitan("ankiFields", {
        text: String(word.spelling || ""),
        type: "term",
        markers,
        maxEntries,
        includeMedia
      }, config, includeMedia ? MEDIA_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
      ensureActive();
      consecutiveRequestFailures = 0;
      const markerValues = Core.chooseYomitanFields(result?.fields, word.reading, word.spelling);
      if (!markerValues) {
        failures.push({word, error: "No Yomitan dictionary result"});
        continue;
      }
      const note = makeNote({...format, model: EXPORT_MODEL_NAME}, markerValues, deckName, tags, payload.matchExactFlashcard !== false);
      const firstFieldName = modelFields[0];
      if (!firstFieldName || !Core.stripHtml(note.fields[firstFieldName]).trim()) {
        failures.push({word, error: `Yomitan rendered an empty first field${firstFieldName ? ` (${firstFieldName})` : ""}`});
        continue;
      }
      generated.push(note);
      if (isAnkiTarget) pending.push({note, word, mediaResult: includeMedia ? result : null});
    } catch (error) {
      ensureActive();
      failures.push({word, error: error?.message || String(error)});
      consecutiveRequestFailures += 1;
      if (consecutiveRequestFailures >= 3) {
        throw new Error(`Yomitan failed three lookups in a row. Last error: ${error?.message || String(error)}`);
      }
    }
    if (pending.length >= 50) await flushNotes();
  }
  ensureActive();
  await flushNotes();
  const apkg = target === "apkg" ? await exportApkg(deckName, config) : "";
  emit({type: "progress", phase: "finish", current: words.length, total: words.length, added, duplicates, failures: failures.length});
  return {
    target,
    deckName,
    modelName: EXPORT_MODEL_NAME,
    selected: words.length,
    generated: generated.length,
    added,
    duplicates,
    failures,
    exportFieldOrderVerified,
    tsv: target === "export" ? Core.notesToTsv(generated, modelFields) : "",
    apkg
  };
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "beginJpdbConnection":
      requireOnboardingSender(sender);
      return globalThis.JYAJpdbConnect.begin();
    case "completeJpdbConnection": return globalThis.JYAJpdbConnect.complete(message, sender);
    case "clearJpdbConnection":
      requireOnboardingSender(sender);
      return clearJpdbConnection();
    case "getContentSettings": return getContentSettings(sender);
    case "saveContentPreferences": return saveContentPreferences(message.preferences, sender);
    case "downloadApkg": return downloadApkg(message, sender);
    case "showDownload": return showDownload(message.downloadId, sender);
    case "getConnections": return getConnections();
    case "getJpdbDeckWords":
      requireJpdbContentSender(sender, {deckOnly: true});
      return {words: await getJpdbDeckWords(message.deckId)};
    case "getYomitanFrequencyRanks":
      requireJpdbContentSender(sender, {deckOnly: true});
      return {ranks: await getYomitanFrequencyRanks(message.words)};
    case "openYomitanSettings":
      await chrome.tabs.create({url: YOMITAN_ANKI_SETTINGS_URL});
      return true;
    case "openYomitanApiSettings":
      await chrome.tabs.create({url: YOMITAN_API_SETTINGS_URL});
      return true;
    case "openExtensionSettings":
      await chrome.runtime.openOptionsPage();
      return true;
    default: throw new Error("Unknown extension request.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const supportedTypes = new Set([
    "beginJpdbConnection",
    "completeJpdbConnection",
    "clearJpdbConnection",
    "getContentSettings",
    "saveContentPreferences",
    "downloadApkg",
    "showDownload",
    "getConnections",
    "getJpdbDeckWords",
    "getYomitanFrequencyRanks",
    "openYomitanSettings",
    "openYomitanApiSettings",
    "openExtensionSettings"
  ]);
  if (!supportedTypes.has(message?.type)) return;
  handleMessage(message, sender)
    .then((result) => sendResponse({ok: true, result}))
    .catch((error) => sendResponse({ok: false, error: error?.message || String(error)}));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "jpdb-yomitan-import") return;
  try {
    requireJpdbContentSender(port.sender, {deckOnly: true});
  } catch (_) {
    port.disconnect();
    return;
  }
  let cancelled = false;
  let started = false;
  const emit = (value) => {
    if (!cancelled) {
      try { port.postMessage(value); } catch (_) { cancelled = true; }
    }
  };
  port.onDisconnect.addListener(() => { cancelled = true; });
  port.onMessage.addListener((message) => {
    if (started || message?.type !== "start") return;
    started = true;
    runImport(message.payload || {}, emit, () => cancelled)
      .then((result) => emit({type: "complete", result}))
      .catch((error) => emit({type: "error", error: error?.message || String(error)}));
  });
});
