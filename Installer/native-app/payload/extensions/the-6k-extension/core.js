(function (root) {
  "use strict";

  const PARTICLE_IDS = new Set([
    "1002980", "1008490", "1013190", "1469800", "1525680", "2028920",
    "2028930", "2028940", "2028960", "2028970", "2028980", "2028990",
    "2029000", "2029010", "2029080", "2029090", "2029100", "2029110",
    "2029120", "2029130", "2086640", "2086960", "1002940", "2667510",
    "2527710", "2215430", "2097680", "2130430", "2131200"
  ]);

  const VOCALIZATION_KEYS = new Set([
    "2139720:ん", "1111010:ふふ", "2840542:んん", "2036150:うふふ",
    "2220340:あはは", "2835840:はっ", "2558020:フッ", "1514990:ハハ",
    "2069620:はぁ", "1517700:ぬう", "2394370:あっ", "2834502:ほほ",
    "2787320:ほい", "2148535374:イヒ", "2837010:くう", "2828104:ふう",
    "2698210:ぶっ"
  ]);

  const SEMANTIC_GRAMMAR_IDS = new Set([
    "1007340", "1005460", "1009980", "1008530", "1632740", "2089060",
    "1007380", "2253310", "1009500", "2643970", "1009470", "1004200"
  ]);

  // Name suffixes and forms of address. Kept as whole spelling forms so kana and
  // kanji forms are covered without filtering unrelated words with the same reading.
  const TITLE_HONORIFIC_KEYS = new Set([
    "さん", "さま", "様", "ちゃん", "くん", "君", "氏", "し", "殿", "どの",
    "先生", "せんせい", "先輩", "せんぱい", "後輩", "こうはい", "博士", "はかせ",
    "陛下", "へいか", "閣下", "かっか", "旦那", "だんな", "お嬢さん", "おじょうさん"
  ]);

  // Occupational, institutional, political, and royal positions used as titles.
  const TITLE_POSITION_KEYS = new Set([
    "教授", "きょうじゅ", "部長", "ぶちょう", "課長", "かちょう", "社長", "しゃちょう",
    "校長", "こうちょう", "会長", "かいちょう", "委員長", "いいんちょう", "店長", "てんちょう",
    "監督", "かんとく", "大臣", "だいじん", "首相", "しゅしょう", "王", "おう",
    "王子", "おうじ", "王女", "おうじょ", "姫", "ひめ"
  ]);

  const DEFAULT_FILTERS = Object.freeze({
    skipParticles: true,
    skipVocalizations: true,
    skipSemanticGrammar: false,
    skipTitleHonorifics: false,
    skipTitlePositions: false,
    skipJlptN5: false,
    skipJlptN4: false,
    skipFrequencyAbove10k: false,
    skipFrequencyAbove20k: false,
    skipFrequencyAbove30k: false,
    skipFrequencyAbove45k: false,
    skipUsedOnce: false
  });

  const DEFAULT_SETTINGS = Object.freeze({
    jpdbApiKey: "",
    yomitanUrl: "http://127.0.0.1:19633",
    ankiUrl: "http://127.0.0.1:8765",
    includeMedia: true,
    matchExactFlashcard: true,
    matchSameWord: false,
    maxYomitanEntries: 8,
    filters: DEFAULT_FILTERS,
    customExcludedIds: []
  });

  function mergeSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    const sourceFilters = source.filters && typeof source.filters === "object" ? source.filters : {};
    // Versions before 0.2.11 had one combined title filter. Preserve its choice
    // when a user upgrades, until either new control is explicitly changed.
    const legacyTitleFilter = Boolean(sourceFilters.skipHonorifics);
    return {
      ...DEFAULT_SETTINGS,
      ...source,
      filters: {
        ...DEFAULT_FILTERS,
        ...sourceFilters,
        skipTitleHonorifics: sourceFilters.skipTitleHonorifics ?? legacyTitleFilter,
        skipTitlePositions: sourceFilters.skipTitlePositions ?? legacyTitleFilter
      },
      customExcludedIds: Array.isArray(source.customExcludedIds) ? source.customExcludedIds.map(String) : []
    };
  }

  function wordKey(word) {
    return `${String(word.jpdbId || "")}:${String(word.sid || "")}:${String(word.spelling || "")}:${String(word.reading || "")}`;
  }

  function filterReason(word, filters, customExcludedIds) {
    const id = String(word.jpdbId || "");
    const spelling = String(word.spelling || "");
    const options = {...DEFAULT_FILTERS, ...(filters || {})};
    const custom = customExcludedIds instanceof Set ? customExcludedIds : new Set((customExcludedIds || []).map(String));
    if (custom.has(id)) return "Custom exclusion";
    if (options.skipParticles && PARTICLE_IDS.has(id)) return "Particle";
    if (options.skipVocalizations && VOCALIZATION_KEYS.has(`${id}:${spelling}`)) return "Vocalization";
    if (options.skipSemanticGrammar && SEMANTIC_GRAMMAR_IDS.has(id)) return "Grammar expression";
    const spellingKey = spelling.normalize("NFKC").trim();
    const readingKey = String(word.reading || "").normalize("NFKC").trim();
    if (options.skipTitleHonorifics && TITLE_HONORIFIC_KEYS.has(spellingKey)) return "Title honorific";
    if (options.skipTitlePositions && TITLE_POSITION_KEYS.has(spellingKey)) return "Title position";
    const pairKey = `${spellingKey}\u0000${readingKey}`;
    const jlpt = globalThis.JYA_JLPT || {};
    const inJlpt = (level) => level && (level.pairs?.has(pairKey) || level.expressions?.has(spellingKey) || level.readings?.has(readingKey));
    if (options.skipJlptN5 && inJlpt(jlpt.n5)) return "JLPT N5";
    if (options.skipJlptN4 && inJlpt(jlpt.n4)) return "JLPT N4";
    const ranks = [];
    const rawRank = word.yomitanFrequencyRank ?? word.frequencyRank;
    const collectRank = (value) => {
      if (Array.isArray(value)) return value.forEach(collectRank);
      if (value && typeof value === "object") return Object.values(value).forEach(collectRank);
      const rank = Number(value);
      if (Number.isFinite(rank) && rank > 0) ranks.push(rank);
    };
    collectRank(rawRank);
    const effectiveRank = ranks.length ? Math.min(...ranks) : null;
    if (options.skipFrequencyAbove10k && effectiveRank !== null && effectiveRank > 10000) return "Frequency >10k";
    if (options.skipFrequencyAbove20k && effectiveRank !== null && effectiveRank > 20000) return "Frequency >20k";
    if (options.skipFrequencyAbove30k && effectiveRank !== null && effectiveRank > 30000) return "Frequency >30k";
    if (options.skipFrequencyAbove45k && effectiveRank !== null && effectiveRank > 45000) return "Frequency >45k";
    if (options.skipUsedOnce && Number(word.occurrences) === 1) return "Used once in episode";
    return "";
  }

  function applyFilters(words, filters, customExcludedIds) {
    const custom = new Set((customExcludedIds || []).map(String));
    return (words || []).map((word) => {
      const reason = filterReason(word, filters, custom);
      return {...word, included: !reason, filterReason: reason};
    });
  }

  function normalizeReading(value) {
    return stripHtml(value)
      .normalize("NFKC")
      .replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
      .replace(/[\s・･]/g, "")
      .trim();
  }

  function stripHtml(value) {
    return String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"');
  }

  function extractMarkers(format) {
    const markers = new Set(["expression", "reading"]);
    for (const detail of Object.values(format?.fields || {})) {
      const value = typeof detail === "string" ? detail : detail?.value;
      for (const match of String(value || "").matchAll(/\{([^{}\r\n]+)\}/g)) {
        markers.add(match[1]);
      }
    }
    return [...markers];
  }

  function chooseYomitanFields(fieldSets, reading, spelling, preferredIndex = -1) {
    if (!Array.isArray(fieldSets) || fieldSets.length === 0) return null;
    if (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < fieldSets.length) {
      return fieldSets[preferredIndex];
    }
    const wanted = normalizeReading(reading);
    const wantedExpression = stripHtml(spelling).normalize("NFKC").replace(/\s/g, "");
    if (!wanted) return fieldSets[0];
    const exact = fieldSets.find((fields) => {
      const expression = stripHtml(fields?.expression).normalize("NFKC").replace(/\s/g, "");
      const candidateReading = normalizeReading(fields?.reading) || normalizeReading(fields?.expression);
      return candidateReading === wanted && (!wantedExpression || expression === wantedExpression);
    });
    if (exact) return exact;
    return fieldSets.find((fields) => (normalizeReading(fields?.reading) || normalizeReading(fields?.expression)) === wanted) || null;
  }

  function renderFormatFields(format, markerValues) {
    const output = {};
    for (const [fieldName, detail] of Object.entries(format?.fields || {})) {
      const template = typeof detail === "string" ? detail : detail?.value;
      output[fieldName] = String(template || "").replace(/\{([^{}\r\n]+)\}/g, (_whole, marker) => String(markerValues?.[marker] || ""));
    }
    return output;
  }

  function sanitizeTag(value) {
    return String(value || "")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[\x00-\x1f<>]/g, "")
      .slice(0, 80);
  }

  function sanitizeFilename(value, fallback = "jpdb-yomitan-anki") {
    const cleaned = String(value || "")
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return cleaned || fallback;
  }

  function tsvCell(value) {
    return String(value ?? "")
      .replace(/\t/g, "&nbsp;&nbsp;&nbsp;")
      .replace(/[\r\n]+/g, " ");
  }

  function notesToTsv(notes, fieldOrder) {
    if (!Array.isArray(notes) || notes.length === 0) return "#separator:tab\n#html:true\n";
    const first = notes[0];
    const order = Array.isArray(fieldOrder) && fieldOrder.length ? fieldOrder : Object.keys(first.fields || {});
    let output = "#separator:tab\n#html:true\n";
    output += `#notetype:${tsvCell(first.modelName)}\n`;
    output += `#deck:${tsvCell(first.deckName)}\n`;
    output += `#tags:${(first.tags || []).map(tsvCell).join(" ")}\n`;
    output += `#columns:${order.map(tsvCell).join("\t")}\n`;
    for (const note of notes) {
      output += order.map((fieldName) => tsvCell(note.fields?.[fieldName] || "")).join("\t") + "\n";
    }
    return output;
  }

  const api = {
    PARTICLE_IDS,
    VOCALIZATION_KEYS,
    SEMANTIC_GRAMMAR_IDS,
    TITLE_HONORIFIC_KEYS,
    TITLE_POSITION_KEYS,
    DEFAULT_FILTERS,
    DEFAULT_SETTINGS,
    mergeSettings,
    wordKey,
    filterReason,
    applyFilters,
    normalizeReading,
    stripHtml,
    extractMarkers,
    chooseYomitanFields,
    renderFormatFields,
    sanitizeTag,
    sanitizeFilename,
    tsvCell,
    notesToTsv
  };

  root.JYACore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
