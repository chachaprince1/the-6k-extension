(function () {
  "use strict";

  if (window.top !== window || globalThis.__jpdbYomitanAnkiLoaded) return;
  globalThis.__jpdbYomitanAnkiLoaded = true;

  const Core = globalThis.JYACore;
  const JPDB_ORIGIN = "https://jpdb.io";
  const EPISODE_VOCABULARY_PATH = /^\/anime\/(\d+)\/([^/]+)\/(\d+)\/([^/]+)\/vocabulary-list\/?$/;
  const ANIME_DETAILS_PATH = /^\/anime\/(\d+)\/([^/]+)\/?$/;
  const DECK_PATH = /^\/deck\/?$/;
  let deckImportOpen = false;
  let hasJpdbApiKey = false;
  let formSequence = 0;

  function pendingImport() {
    try {
      const value = JSON.parse(sessionStorage.getItem("jpdbYomitanPendingImport") || "null");
      if (!value || Date.now() - Number(value.createdAt || 0) > 5 * 60 * 1000) {
        sessionStorage.removeItem("jpdbYomitanPendingImport");
        return null;
      }
      return value;
    } catch (_) {
      sessionStorage.removeItem("jpdbYomitanPendingImport");
      return null;
    }
  }

  async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "The extension did not respond.");
    return response.result;
  }

  async function getSettings() {
    return Core.mergeSettings(await send({type: "getContentSettings"}));
  }

  function showToast(message, tone = "info", duration = 5000) {
    const existing = document.querySelector(".jya-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = `jya-toast ${tone}`;
    toast.textContent = message;
    document.body.append(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => toast.remove(), 220);
    }, duration);
  }

  function pageTitle() {
    const heading = document.querySelector("main h5, main h4, .container h5, h5, h1");
    return heading?.textContent?.trim() || document.title.replace(/\s*[|–-]\s*jpdb.*$/i, "").trim() || "jpdb";
  }

  function findNearbyDeckControl(vocabularyLink, metadata) {
    const episodeCard = vocabularyLink.parentElement?.parentElement || vocabularyLink.parentElement;
    if (!episodeCard) return {form: null, deckLink: null};
    const deckLink = [...episodeCard.querySelectorAll('a[href]')].find((candidate) => {
      try {
        const url = new URL(candidate.href, location.href);
        return url.origin === JPDB_ORIGIN && url.pathname === "/deck" && /^\d+$/.test(url.searchParams.get("id") || "");
      } catch (_) { return false; }
    });
    if (deckLink) return {form: null, deckLink};
    const form = [...episodeCard.querySelectorAll('form[action]')].find((candidate) => {
      try {
        const animeId = candidate.querySelector('input[name="id"]')?.value || "";
        const subentryId = candidate.querySelector('input[name="subentry"]')?.value || "";
        const action = new URL(candidate.action, location.href);
        return action.origin === JPDB_ORIGIN && action.pathname === "/add_prebuilt_deck" &&
          animeId === metadata.animeId && subentryId === metadata.subentryId;
      } catch (_) { return false; }
    });
    if (form) return {form, deckLink: null};
    return {form: null, deckLink: null};
  }

  function episodeDetails(link) {
    const url = new URL(link.href, location.href);
    const match = url.pathname.match(EPISODE_VOCABULARY_PATH);
    if (url.origin !== JPDB_ORIGIN || !match) throw new Error("This is not a jpdb episode vocabulary link.");
    const card = link.parentElement?.parentElement;
    const episodeLabel = card?.querySelector(":scope > h6")?.textContent?.trim() || decodeURIComponent(match?.[4] || "Episode");
    return {
      vocabularyUrl: url.href,
      animeId: match?.[1] || "",
      subentryId: match?.[3] || "",
      showTitle: pageTitle(),
      episodeLabel
    };
  }

  function formId(form) {
    const existing = form.getAttribute("id");
    if (existing) return existing;
    do {
      formSequence += 1;
      form.setAttribute("id", `jya-jpdb-deck-form-${formSequence}`);
    } while (document.getElementById(form.getAttribute("id")) !== form);
    return form.getAttribute("id");
  }

  function injectEpisodeButtons() {
    if (!ANIME_DETAILS_PATH.test(location.pathname)) return;
    for (const link of document.querySelectorAll("a[href]")) {
      let matches = false;
      try {
        const url = new URL(link.href, location.href);
        matches = url.origin === JPDB_ORIGIN && EPISODE_VOCABULARY_PATH.test(url.pathname);
      } catch (_) {}
      if (!matches || link.dataset.jyaInjected === "true") continue;
      link.dataset.jyaInjected = "true";
      const metadata = episodeDetails(link);
      const {form, deckLink} = findNearbyDeckControl(link, metadata);
      const control = deckLink ? document.createElement("a") : document.createElement("button");
      if (deckLink) {
        control.href = deckLink.href;
      } else if (form) {
        control.type = "submit";
        control.setAttribute("form", formId(form));
      } else {
        control.type = "button";
      }
      control.className = "jya-add-button";
      control.textContent = "Add to Anki";
      control.title = "Add this episode as a jpdb deck, review its vocabulary, then render it with Yomitan";
      control.addEventListener("click", (event) => {
        if (!event.isTrusted) {
          event.preventDefault();
          return;
        }
        if (!hasJpdbApiKey) {
          event.preventDefault();
          showToast("Connect jpdb in the extension setup first.", "error", 7000);
          void send({type: "openExtensionSettings"});
          return;
        }
        if (!form && !deckLink) {
          event.preventDefault();
          showToast("jpdb did not show an Add deck or Open deck control for this episode. Sign in, then reload this page.", "error", 9000);
          return;
        }
        sessionStorage.setItem("jpdbYomitanPendingImport", JSON.stringify({...metadata, createdAt: Date.now()}));
      });
      link.insertAdjacentElement("afterend", control);
    }
  }

  function modalShell(title, className = "") {
    const overlay = document.createElement("div");
    overlay.className = `jya-overlay ${className}`;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", title);

    const panel = document.createElement("section");
    panel.className = "jya-modal";
    const header = document.createElement("header");
    const heading = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.className = "jya-eyebrow";
    eyebrow.textContent = "JPDB → YOMITAN → ANKI";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    heading.append(eyebrow, h2);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "jya-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    header.append(heading, close);
    const body = document.createElement("div");
    body.className = "jya-modal-body";
    panel.append(header, body);
    overlay.append(panel);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add("visible"));
    return {overlay, panel, body, close, remove: () => overlay.remove()};
  }

  function showLoading(title, text) {
    const modal = modalShell(title, "jya-loading-overlay");
    const loader = document.createElement("div");
    loader.className = "jya-loader";
    const message = document.createElement("p");
    message.textContent = text;
    modal.body.append(loader, message);
    modal.close.addEventListener("click", modal.remove);
    return modal;
  }

  function meaningText(value) {
    const found = [];
    function visit(item) {
      if (found.length >= 5) return;
      if (typeof item === "string" && item.trim()) found.push(item.trim());
      else if (Array.isArray(item)) item.forEach(visit);
      else if (item && typeof item === "object") Object.values(item).forEach(visit);
    }
    visit(value);
    return found.join("; ");
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const succeeded = document.execCommand("copy");
    area.remove();
    if (!succeeded) throw new Error("Chrome could not copy the vocabulary list.");
    return Promise.resolve();
  }

  function downloadText(text, filename) {
    const blob = new Blob([text], {type: "text/tab-separated-values;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function fieldLabel(text, control) {
    const label = document.createElement("label");
    label.className = "jya-field";
    const span = document.createElement("span");
    span.textContent = text;
    label.append(span, control);
    return label;
  }

  function sectionHeading(title, subtitle) {
    const header = document.createElement("div");
    header.className = "jya-section-header";
    const titleEl = document.createElement("h4");
    titleEl.className = "jya-section-title";
    titleEl.textContent = title;
    const subtitleEl = document.createElement("p");
    subtitleEl.className = "jya-section-subtitle";
    subtitleEl.textContent = subtitle;
    header.append(titleEl, subtitleEl);
    return header;
  }

  function checkboxLabel(text, checked, hint = "") {
    const label = document.createElement("label");
    label.className = "jya-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    const copy = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = text;
    copy.append(strong);
    if (hint) {
      const small = document.createElement("small");
      small.textContent = hint;
      copy.append(small);
    }
    label.append(input, copy);
    return {label, input};
  }

  async function reviewVocabulary(words, metadata) {
    const config = await getSettings();
    const sourceParts = [...new Set([metadata.showTitle, metadata.episodeLabel].filter(Boolean))];
    const displayTitle = metadata.episodeLabel || metadata.showTitle || "jpdb deck";
    const modal = modalShell(`${displayTitle} vocabulary`, "jya-review-overlay");
    const state = {
      config,
      words: Core.applyFilters(words, config.filters, config.customExcludedIds).map((word) => ({...word, key: Core.wordKey(word)})),
      overrides: new Map(),
      busy: false,
      activePort: null,
      connections: null,
      frequencyRanksLoaded: false,
      frequencyRanksLoading: false,
      exportDownloadId: null
    };

    const intro = document.createElement("div");
    intro.className = "jya-review-intro";
    const source = document.createElement("p");
    source.textContent = `${sourceParts.join(" · ") || pageTitle()} · ${words.length} jpdb entries`;
    const count = document.createElement("strong");
    count.className = "jya-count";
    intro.append(source, count);

    const filterSection = document.createElement("section");
    filterSection.className = "jya-section";
    const filterSectionHeader = sectionHeading(
      "Skip word sets",
      "Checked options are removed from export. This is stored with your extension settings."
    );
    const filters = document.createElement("div");
    filters.className = "jya-filter-grid";
    const particle = checkboxLabel("Particles", config.filters.skipParticles, "は・が・に・を…");
    const vocal = checkboxLabel("Vocalizations", config.filters.skipVocalizations, "ふふ・はぁ…");
    const grammar = checkboxLabel("Semantic grammar", config.filters.skipSemanticGrammar, "だけ・しか・のに…");
    const titleHonorifics = checkboxLabel("Title honorifics", config.filters.skipTitleHonorifics, "さん・様・先生・先輩…");
    const titlePositions = checkboxLabel("Title positions", config.filters.skipTitlePositions, "部長・社長・教授・王…");
    const jlptN5 = checkboxLabel("Ignore JLPT N5", config.filters.skipJlptN5, "beginner vocabulary");
    const jlptN4 = checkboxLabel("Ignore JLPT N4", config.filters.skipJlptN4, "elementary vocabulary");
    const usedOnce = checkboxLabel("Only used once", config.filters.skipUsedOnce, "in this episode");
    const freq10 = checkboxLabel("Ignore above 10k", config.filters.skipFrequencyAbove10k, "frequency rank");
    const freq20 = checkboxLabel("Ignore above 20k", config.filters.skipFrequencyAbove20k, "frequency rank");
    const freq30 = checkboxLabel("Ignore above 30k", config.filters.skipFrequencyAbove30k, "frequency rank");
    const freq45 = checkboxLabel("Ignore above 45k", config.filters.skipFrequencyAbove45k, "frequency rank");
    filters.append(particle.label, vocal.label, grammar.label, titleHonorifics.label, titlePositions.label, jlptN5.label, jlptN4.label, usedOnce.label);
    const frequencyNote = document.createElement("p");
    frequencyNote.className = "jya-section-subtitle jya-frequency-note";
    frequencyNote.textContent = "Frequency data may take a little bit to load fully";
    const frequencyFilters = document.createElement("div");
    frequencyFilters.className = "jya-filter-grid";
    frequencyFilters.append(freq10.label, freq20.label, freq30.label, freq45.label);
    filterSection.append(filterSectionHeader, filters, frequencyNote, frequencyFilters);

    const duplicatesSection = document.createElement("section");
    duplicatesSection.className = "jya-section";
    const exactCard = checkboxLabel("Same JPDB flashcard in another deck", config.matchSameWord ? false : config.matchExactFlashcard !== false, "same note type and first field");
    const sameWord = checkboxLabel("Same word in any deck", Boolean(config.matchSameWord), "same spelling and reading");
    const duplicateGrid = document.createElement("div");
    duplicateGrid.className = "jya-filter-grid jya-duplicate-grid";
    duplicateGrid.append(exactCard.label, sameWord.label);
    duplicatesSection.append(sectionHeading("Skip duplicates", "Checked options prevent importing duplicates across your whole Anki collection."), duplicateGrid);

    const skippedHeading = sectionHeading("All Skipped Words: Toggle to Keep", "Checked means skipped. Uncheck a word to restore it.");

    const list = document.createElement("div");
    list.className = "jya-word-list";
    list.setAttribute("role", "list");

    const setup = document.createElement("div");
    setup.className = "jya-output-setup";
    const setupTitle = document.createElement("h3");
    setupTitle.textContent = "Card output";
    const connectionStatus = document.createElement("p");
    connectionStatus.className = "jya-connection-status";
    connectionStatus.textContent = "Checking Yomitan and Anki…";
    const deckInput = document.createElement("select");
    deckInput.disabled = true;
    const loadingDeckOption = document.createElement("option");
    loadingDeckOption.textContent = "Loading Anki decks…";
    deckInput.append(loadingDeckOption);
    const media = checkboxLabel("Include Yomitan media", config.includeMedia, "Audio and dictionary images");
    const setupGrid = document.createElement("div");
    setupGrid.className = "jya-setup-grid";
    setupGrid.append(fieldLabel("Destination deck", deckInput), media.label);
    setup.append(setupTitle, connectionStatus, setupGrid);

    const progress = document.createElement("div");
    progress.className = "jya-progress";
    progress.hidden = true;
    const progressText = document.createElement("div");
    const progressTrack = document.createElement("div");
    const progressBar = document.createElement("span");
    progressTrack.append(progressBar);
    const resultText = document.createElement("p");
    progress.append(progressText, progressTrack, resultText);

    const actions = document.createElement("div");
    actions.className = "jya-actions";
    const ankiOfflineMessage = document.createElement("p");
    ankiOfflineMessage.className = "jya-anki-offline-message";
    ankiOfflineMessage.textContent = "Your Anki is offline. Please open Anki and refresh this page.";
    ankiOfflineMessage.hidden = true;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "jya-secondary";
    copy.textContent = "Copy for Yomitan";
    copy.title = "Fallback: copy selected terms and open Yomitan's experimental note generator";
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "jya-secondary";
    exportButton.textContent = "Anki .txt";
    exportButton.disabled = true;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "jya-primary";
    add.textContent = "Export as APKG";
    add.title = "Build the isolated jpdb → Yomitan → Anki note type and add the deck to Anki";
    add.disabled = true;
    const cancelJob = document.createElement("button");
    cancelJob.type = "button";
    cancelJob.className = "jya-danger";
    cancelJob.textContent = "Cancel import";
    cancelJob.hidden = true;
    const otherExports = document.createElement("details");
    otherExports.className = "jya-other-exports";
    const otherExportsSummary = document.createElement("summary");
    otherExportsSummary.textContent = "Other exports";
    otherExports.append(otherExportsSummary, exportButton, copy);
    actions.append(ankiOfflineMessage, otherExports, add, cancelJob);

    modal.body.append(intro, filterSection, duplicatesSection, skippedHeading, list, setup, progress, actions);

    const rowViews = state.words.map((word) => {
      const row = document.createElement("label");
      row.className = "jya-word-row";
      row.setAttribute("role", "listitem");
      const input = document.createElement("input");
      input.type = "checkbox";
      const main = document.createElement("span");
      main.className = "jya-word-main";
      const spelling = document.createElement("strong");
      spelling.lang = "ja";
      spelling.textContent = word.spelling;
      const reading = document.createElement("span");
      reading.lang = "ja";
      reading.textContent = word.reading && word.reading !== word.spelling ? word.reading : "";
      main.append(spelling, reading);
      const details = document.createElement("span");
      details.className = "jya-word-details";
      const meaning = document.createElement("span");
      meaning.textContent = meaningText(word.meanings) || "Yomitan definition will be used";
      const uses = document.createElement("small");
      uses.textContent = word.occurrences !== null && word.occurrences !== undefined ? `${word.occurrences}×` : "uses unavailable";
      details.append(meaning, uses);
      const reason = document.createElement("em");
      row.append(input, main, details, reason);
      list.append(row);
      const view = {word, row, input, reason, visible: true};
      input.addEventListener("change", () => {
        state.overrides.set(word.key, !input.checked);
        updateRow(view);
        updateCounts();
      });
      return view;
    });

    function selected(view) {
      return state.overrides.has(view.word.key) ? state.overrides.get(view.word.key) : !view.word.filterReason;
    }

    function updateRow(view) {
      const isSelected = Boolean(selected(view));
      view.input.checked = !isSelected;
      view.row.classList.toggle("skipped", !isSelected);
      const overridden = state.overrides.has(view.word.key);
      view.reason.textContent = overridden
        ? (isSelected && view.word.filterReason ? "Manually restored" : !isSelected && !view.word.filterReason ? "Manually skipped" : view.word.filterReason)
        : view.word.filterReason;
      view.reason.hidden = !view.reason.textContent;
    }

    function updateVisibility() {
      let shown = 0;
      for (const view of rowViews) {
        view.visible = !selected(view) || state.overrides.has(view.word.key);
        view.row.hidden = !view.visible;
        if (view.visible) shown += 1;
      }
      list.setAttribute("aria-label", `${shown} skipped words`);
    }

    function updateCounts() {
      const selectedCount = rowViews.filter(selected).length;
      count.textContent = `${selectedCount} included · ${rowViews.length - selectedCount} skipped`;
      updateVisibility();
    }

    async function saveFilterSettings() {
      state.config.filters = {
        skipParticles: particle.input.checked,
        skipVocalizations: vocal.input.checked,
        skipSemanticGrammar: grammar.input.checked,
        skipTitleHonorifics: titleHonorifics.input.checked,
        skipTitlePositions: titlePositions.input.checked,
        skipJlptN5: jlptN5.input.checked,
        skipJlptN4: jlptN4.input.checked,
        skipFrequencyAbove10k: freq10.input.checked,
        skipFrequencyAbove20k: freq20.input.checked,
        skipFrequencyAbove30k: freq30.input.checked,
        skipFrequencyAbove45k: freq45.input.checked,
        skipUsedOnce: usedOnce.input.checked
      };
      await send({type: "saveContentPreferences", preferences: {filters: state.config.filters}});
    }

    function reapplyFilters() {
      const updated = Core.applyFilters(state.words, {
        skipParticles: particle.input.checked,
        skipVocalizations: vocal.input.checked,
        skipSemanticGrammar: grammar.input.checked,
        skipTitleHonorifics: titleHonorifics.input.checked,
        skipTitlePositions: titlePositions.input.checked,
        skipJlptN5: jlptN5.input.checked,
        skipJlptN4: jlptN4.input.checked,
        skipFrequencyAbove10k: freq10.input.checked,
        skipFrequencyAbove20k: freq20.input.checked,
        skipFrequencyAbove30k: freq30.input.checked,
        skipFrequencyAbove45k: freq45.input.checked,
        skipUsedOnce: usedOnce.input.checked
      }, state.config.customExcludedIds);
      updated.forEach((word, index) => {
        state.words[index].filterReason = word.filterReason;
        updateRow(rowViews[index]);
      });
      updateCounts();
      void saveFilterSettings();
    }

    function frequencyFilterEnabled() {
      return freq20.input.checked || freq30.input.checked || freq45.input.checked;
    }

    async function ensureFrequencyRanks() {
      if (!frequencyFilterEnabled() || state.frequencyRanksLoaded || state.frequencyRanksLoading) return;
      state.frequencyRanksLoading = true;
      resultText.textContent = "Loading Yomitan frequency ranks…";
      try {
        const result = await send({type: "getYomitanFrequencyRanks", words: state.words});
        const ranks = new Map((result.ranks || []).map((entry) => [String(entry.key), entry.rank]));
        state.words.forEach((word) => {
          if (ranks.has(word.key)) word.yomitanFrequencyRank = ranks.get(word.key);
        });
        state.frequencyRanksLoaded = true;
        reapplyFilters();
      } catch (error) {
        resultText.textContent = `Could not load Yomitan frequency data: ${error?.message || String(error)}`;
      } finally {
        state.frequencyRanksLoading = false;
      }
    }

    function refreshFilters() {
      reapplyFilters();
      if (frequencyFilterEnabled() && !state.frequencyRanksLoaded) void ensureFrequencyRanks();
    }

    for (const control of [particle.input, vocal.input, grammar.input, titleHonorifics.input, titlePositions.input, jlptN5.input, jlptN4.input, freq10.input, freq20.input, freq30.input, freq45.input, usedOnce.input]) control.addEventListener("change", () => void refreshFilters());
    exactCard.input.addEventListener("change", () => {
      if (exactCard.input.checked) sameWord.input.checked = false;
    });
    sameWord.input.addEventListener("change", () => {
      if (sameWord.input.checked) exactCard.input.checked = false;
    });

    function selectedWords() {
      return rowViews.filter(selected).map((view) => view.word);
    }

    function setBusy(value) {
      state.busy = value;
      for (const control of [copy, exportButton, add, deckInput, media.input, exactCard.input, sameWord.input, particle.input, vocal.input, grammar.input, titleHonorifics.input, titlePositions.input, jlptN5.input, jlptN4.input, freq10.input, freq20.input, freq30.input, freq45.input, usedOnce.input]) {
        control.disabled = value || (control === add && !state.connections?.anki?.ok) || (control === exportButton && !state.connections?.yomitan?.ok);
      }
      cancelJob.hidden = !value;
      progress.hidden = !value && !resultText.textContent;
      modal.close.disabled = value;
    }

    async function runJob(target, event) {
      if (!event?.isTrusted) return;
      const chosen = selectedWords();
      if (!chosen.length) {
        resultText.textContent = "Select at least one entry.";
        progress.hidden = false;
        return;
      }
      if (!deckInput.value) {
        resultText.textContent = "Choose a destination deck.";
        progress.hidden = false;
        return;
      }
      resultText.textContent = "";
      progressBar.style.width = "0%";
      progressText.textContent = `Starting ${target === "export" ? "text export" : target === "apkg" ? "APKG export" : "Anki import"}…`;
      setBusy(true);
      const started = Date.now();
      state.config.includeMedia = media.input.checked;
      await send({
        type: "saveContentPreferences",
        preferences: {includeMedia: state.config.includeMedia, matchExactFlashcard: exactCard.input.checked, matchSameWord: sameWord.input.checked}
      });

      const port = chrome.runtime.connect({name: "jpdb-yomitan-import"});
      state.activePort = port;
      let finished = false;
      port.onMessage.addListener(async (message) => {
        if (message.type === "progress") {
          const ratio = message.total ? message.current / message.total : 0;
          progressBar.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
          progressText.textContent = message.phase === "finish"
            ? "Finishing…"
            : `Rendering ${message.current + 1} of ${message.total}: ${message.spelling || ""}`;
          resultText.textContent = target !== "export" ? `${message.added || 0} added · ${message.duplicates || 0} duplicates · ${message.failures || 0} failed` : `${message.current} of ${message.total} rendered`;
        } else if (message.type === "complete") {
          finished = true;
          state.activePort = null;
          const result = message.result;
          progressBar.style.width = "100%";
          const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
          if (target === "export") {
            const filename = `${Core.sanitizeFilename(sourceParts.join(" ") || "jpdb deck")}-yomitan.txt`;
            downloadText(result.tsv, filename);
            progressText.textContent = "Export ready";
            const mapping = result.exportFieldOrderVerified ? "" : " · Anki could not verify the model field order, so check the named columns in the import preview";
            resultText.textContent = `${result.generated} notes exported in ${seconds}s${result.failures.length ? ` · ${result.failures.length} entries failed` : ""}${mapping}.`;
          } else if (target === "apkg") {
            const filename = `${Core.sanitizeFilename(sourceParts.join(" ") || "jpdb deck")}-yomitan.apkg`;
            try {
              state.exportDownloadId = await send({type: "downloadApkg", data: result.apkg, filename});
            } catch (error) {
              progressText.textContent = "APKG download failed";
              resultText.textContent = error?.message || String(error);
              setBusy(false);
              port.disconnect();
              return;
            }
            add.textContent = "View Export";
            progressText.textContent = "APKG export ready";
            resultText.textContent = `${result.added} added to Anki · ${result.duplicates} duplicates · ${result.failures.length} failed · ${seconds}s`;
          } else {
            progressText.textContent = "Anki import complete";
            resultText.textContent = `${result.added} added · ${result.duplicates} duplicates · ${result.failures.length} failed · ${seconds}s`;
          }
          setBusy(false);
          port.disconnect();
        } else if (message.type === "error") {
          finished = true;
          state.activePort = null;
          progressText.textContent = "Import stopped";
          resultText.textContent = message.error;
          setBusy(false);
          port.disconnect();
        }
      });
      port.onDisconnect.addListener(() => {
        if (!finished && state.busy) {
          state.activePort = null;
          progressText.textContent = "Import stopped";
          resultText.textContent = chrome.runtime.lastError?.message || "The import was cancelled.";
          setBusy(false);
        }
      });
      port.postMessage({
        type: "start",
        payload: {
          target,
          words: chosen,
          deckName: deckInput.value,
          includeMedia: media.input.checked,
          matchExactFlashcard: exactCard.input.checked,
          matchSameWord: sameWord.input.checked,
          tags: sourceParts.length ? sourceParts : ["jpdb"]
        }
      });
    }

    copy.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      const chosen = selectedWords();
      if (!chosen.length) return;
      void copyText(chosen.map((word) => word.spelling).join("\n"))
        .then(() => send({type: "openYomitanSettings"}))
        .then(() => showToast(`${chosen.length} terms copied. Paste them into Yomitan's Generate notes tool.`, "success", 7000))
        .catch((error) => showToast(error?.message || String(error), "error", 7000));
    });
    exportButton.addEventListener("click", (event) => void runJob("export", event));
    add.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      if (state.exportDownloadId !== null) {
        void send({type: "showDownload", downloadId: state.exportDownloadId})
          .catch((error) => showToast(error?.message || String(error), "error", 7000));
        return;
      }
      void runJob("apkg", event);
    });
    cancelJob.addEventListener("click", () => {
      state.activePort?.disconnect();
      state.activePort = null;
      progressText.textContent = "Cancelling…";
    });
    modal.close.addEventListener("click", () => {
      if (state.busy) return;
      modal.remove();
      deckImportOpen = false;
    });

    rowViews.forEach(updateRow);
    updateCounts();
    if (frequencyFilterEnabled()) void ensureFrequencyRanks();

    try {
      const connections = await send({type: "getConnections"});
      state.connections = connections;
      const hasTermFormat = connections.formats.some((format) => format.type === "term");
      const deckNames = Array.isArray(connections.decks) ? connections.decks : [];
      deckInput.replaceChildren();
      const suggestedDeck = ["JPDB", ...(sourceParts.length ? sourceParts : [pageTitle()])].join("::");
      const options = deckNames.includes(suggestedDeck) ? deckNames : [suggestedDeck, ...deckNames];
      for (const deckName of options) {
        const option = document.createElement("option");
        option.value = deckName;
        option.textContent = deckName === suggestedDeck && !deckNames.includes(suggestedDeck) ? `${deckName} (new)` : deckName;
        deckInput.append(option);
      }
      deckInput.disabled = !connections.anki.ok || options.length === 0;
      const statusParts = [
        connections.yomitan.ok ? `Yomitan connected (${connections.formats.length} formats)` : "Yomitan API unavailable",
        connections.anki.ok ? "Anki connected" : "Anki unavailable"
      ];
      connectionStatus.textContent = statusParts.join(" · ");
      connectionStatus.classList.toggle("bad", !connections.yomitan.ok);
      ankiOfflineMessage.hidden = Boolean(connections.anki.ok);
      exportButton.disabled = !connections.yomitan.ok || !hasTermFormat;
      add.disabled = !connections.yomitan.ok || !connections.anki.ok || !hasTermFormat;
      if (!connections.yomitan.ok) {
        connectionStatus.title = connections.yomitan.error || "";
      } else if (!connections.anki.ok) {
        connectionStatus.title = connections.anki.error || "";
      }
    } catch (error) {
      state.connections = {yomitan: {ok: false}, anki: {ok: false}};
      connectionStatus.textContent = error?.message || String(error);
      connectionStatus.classList.add("bad");
      ankiOfflineMessage.hidden = false;
    }
  }

  async function openDeckImport(deckId, metadata = {}) {
    if (deckImportOpen) return;
    deckImportOpen = true;
    const config = await getSettings();
    if (!config.hasJpdbApiKey) {
      deckImportOpen = false;
      showToast("Add your jpdb API key in the extension setup first.", "error", 7000);
      await send({type: "openExtensionSettings"});
      return;
    }
    const loading = showLoading(metadata.episodeLabel || "Loading jpdb deck", "Fetching the vocabulary through jpdb’s official API…");
    try {
      const result = await send({type: "getJpdbDeckWords", deckId});
      if (!result.words.length) throw new Error("jpdb returned no vocabulary for this deck.");
      loading.remove();
      await reviewVocabulary(result.words, {
        showTitle: metadata.showTitle || pageTitle(),
        episodeLabel: metadata.episodeLabel || "",
        vocabularyUrl: metadata.vocabularyUrl || location.href
      });
    } catch (error) {
      loading.remove();
      deckImportOpen = false;
      showToast(error?.message || String(error), "error", 10000);
    }
  }

  function injectDeckButton() {
    if (!DECK_PATH.test(location.pathname) || document.querySelector(".jya-deck-button")) return;
    const deckId = new URL(location.href).searchParams.get("id");
    if (!/^\d+$/.test(deckId || "")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jya-add-button jya-deck-button";
    const pending = pendingImport();
    button.textContent = pending ? `Continue: review ${pending.episodeLabel || "episode"} for Anki` : "Add deck to Anki with Yomitan";
    button.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      const metadata = pendingImport() || {showTitle: pageTitle()};
      sessionStorage.removeItem("jpdbYomitanPendingImport");
      void openDeckImport(deckId, metadata);
    });
    const heading = document.querySelector("main h5, main h4, .container h5, h5, h1");
    if (heading) heading.insertAdjacentElement("afterend", button);
    else document.body.prepend(button);
  }

  async function consumePendingImport() {
    if (!DECK_PATH.test(location.pathname)) return;
    const deckId = new URL(location.href).searchParams.get("id");
    if (!/^\d+$/.test(deckId || "")) return;
    const pending = pendingImport();
    if (!pending) return;
    sessionStorage.removeItem("jpdbYomitanPendingImport");
    void openDeckImport(deckId, pending);
  }

  async function initialize() {
    if (ANIME_DETAILS_PATH.test(location.pathname)) {
      try {
        hasJpdbApiKey = Boolean((await getSettings()).hasJpdbApiKey);
      } catch (_) {
        showToast("Could not read the extension setup. Reload this page and try again.", "error", 7000);
      }
      injectEpisodeButtons();
      const observer = new MutationObserver(injectEpisodeButtons);
      observer.observe(document.documentElement, {childList: true, subtree: true});
    } else if (DECK_PATH.test(location.pathname)) {
      injectDeckButton();
    }
    await consumePendingImport();
  }

  void initialize();
})();
