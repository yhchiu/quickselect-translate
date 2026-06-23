"use strict";

const DEFAULT_SETTINGS = Object.freeze({
  sourceLang: "auto",
  targetLang: "browser",
  showSelectionButton: true,
  translateImmediately: false,
  buttonOffsetX: 8,
  buttonOffsetY: 8,
  maxTextLength: 5000,
  openPageTranslationInCurrentTab: false,
  themeMode: "auto",
  fontSize: 16
});

const MENU_IDS = Object.freeze({
  selection: "stj-translate-selection",
  page: "stj-translate-page",
  link: "stj-translate-link"
});

const TARGET_LANG_FALLBACK = "zh-TW";
const SUPPORTED_BROWSER_TARGET_LANGS = new Set(["en", "ja", "ko", "fr", "de", "es", "it", "pt", "ru", "vi", "th", "id"]);

const memoryCache = new Map();

function t(key, fallback, substitutions) {
  const message = chrome.i18n?.getMessage?.(key, substitutions);
  return message || formatFallback(fallback, substitutions);
}

function formatFallback(fallback, substitutions) {
  const values = Array.isArray(substitutions) ? substitutions : substitutions === undefined ? [] : [substitutions];
  return String(fallback || "").replace(/\$(\d+)/g, (match, index) => values[Number(index) - 1] ?? match);
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaultSettings();
  createContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaultSettings();
  createContextMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === MENU_IDS.selection) {
    chrome.tabs.sendMessage(tab.id, { type: "STJ_TRANSLATE_SELECTION" }).catch(() => {});
    return;
  }

  if (info.menuItemId === MENU_IDS.page) {
    openPageTranslation(info.pageUrl || tab.url, tab);
    return;
  }

  if (info.menuItemId === MENU_IDS.link) {
    openPageTranslation(info.linkUrl, tab, false);
  }
});

chrome.commands.onCommand.addListener(async command => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (command === "translate-selected-text") {
    chrome.tabs.sendMessage(tab.id, { type: "STJ_TRANSLATE_SELECTION" }).catch(() => {});
  }

  if (command === "translate-page") {
    openPageTranslation(tab.url, tab);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "STJ_GET_SETTINGS") {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === "STJ_TRANSLATE") {
    handleTranslate(message).then(sendResponse);
    return true;
  }

  if (message.type === "STJ_OPEN_GOOGLE_TRANSLATE") {
    openTextTranslation(message.text, message.sourceLang, message.targetLang);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "STJ_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function ensureDefaultSettings() {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) missing[key] = value;
  }

  if (Object.keys(missing).length) {
    await chrome.storage.local.set(missing);
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.selection,
      title: t("contextTranslateSelectedText", "Translate selected text"),
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU_IDS.page,
      title: t("contextTranslateThisPage", "Translate this page"),
      contexts: ["page"]
    });
    chrome.contextMenus.create({
      id: MENU_IDS.link,
      title: t("contextTranslateLinkTarget", "Translate link target"),
      contexts: ["link"]
    });
  });
}

async function handleTranslate(message) {
  const settings = await getSettings();
  const text = normalizeText(message.text || "", settings.maxTextLength);
  const sourceLang = normalizeLang(message.sourceLang || settings.sourceLang || "auto");
  const targetLang = resolveTargetLang(message.targetLang || settings.targetLang || DEFAULT_SETTINGS.targetLang);

  if (!text) {
    return {
      ok: true,
      resultText: "",
      candidateText: "",
      sourceLanguage: sourceLang,
      confidence: 0
    };
  }

  const cacheKey = `${sourceLang}\n${targetLang}\n${text}`;
  const cached = memoryCache.get(cacheKey);
  if (cached) return cached;

  const result = await translateWithGoogle(text, sourceLang, targetLang);
  if (result.ok) memoryCache.set(cacheKey, result);
  trimCache();
  return result;
}

function normalizeText(text, maxLength) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, Math.max(1, maxLength));
}

function normalizeLang(lang) {
  return String(lang || "auto").trim();
}

function resolveTargetLang(lang) {
  const value = String(lang || "").trim();
  if (!value || value === "auto") return TARGET_LANG_FALLBACK;
  if (value !== "browser") return value;
  return resolveBrowserTargetLang(getBrowserLanguage());
}

function getBrowserLanguage() {
  return (
    chrome.i18n?.getUILanguage?.() ||
    (Array.isArray(navigator.languages) && navigator.languages[0]) ||
    navigator.language ||
    ""
  );
}

function resolveBrowserTargetLang(lang) {
  const normalized = String(lang || "").replace("_", "-").toLowerCase();
  if (!normalized) return TARGET_LANG_FALLBACK;

  if (
    normalized === "zh" ||
    normalized.startsWith("zh-hant") ||
    normalized.startsWith("zh-tw") ||
    normalized.startsWith("zh-hk") ||
    normalized.startsWith("zh-mo")
  ) {
    return "zh-TW";
  }
  if (normalized.startsWith("zh-hans") || normalized.startsWith("zh-cn") || normalized.startsWith("zh-sg")) {
    return "zh-CN";
  }

  const baseLang = normalized.split("-")[0];
  return SUPPORTED_BROWSER_TARGET_LANGS.has(baseLang) ? baseLang : TARGET_LANG_FALLBACK;
}

async function translateWithGoogle(text, sourceLang, targetLang) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", sourceLang);
  url.searchParams.set("tl", targetLang);
  url.searchParams.set("hl", targetLang);
  url.searchParams.set("dt", "t");
  url.searchParams.append("dt", "bd");
  url.searchParams.set("dj", "1");
  url.searchParams.set("q", text);

  let response;
  try {
    response = await fetch(url.toString(), { method: "GET" });
  } catch (error) {
    return makeError(t("errorNetwork", "Network error. Please check your connection."), error);
  }

  if (!response.ok) {
    const message =
      response.status === 429 || response.status === 503
        ? t("errorRateLimited", "Google Translate is temporarily unavailable or rate limited.")
        : t("errorRequestFailed", "Translate request failed. [$1 $2]", [response.status, response.statusText]);
    return makeError(message);
  }

  try {
    const data = await response.json();
    const resultText = Array.isArray(data.sentences)
      ? data.sentences.map(sentence => sentence.trans || "").join("")
      : "";
    const candidateText = Array.isArray(data.dict)
      ? data.dict
          .map(item => {
            const label = item.pos ? `${item.pos}: ` : "";
            const terms = Array.isArray(item.terms) ? item.terms.join(", ") : "";
            return `${label}${terms}`.trim();
          })
          .filter(Boolean)
          .join("\n")
      : "";
    const candidateGroups = Array.isArray(data.dict)
      ? data.dict
          .map(item => ({
            pos: item.pos || "",
            terms: Array.isArray(item.terms) ? item.terms.filter(Boolean) : []
          }))
          .filter(item => item.pos || item.terms.length)
      : [];

    return {
      ok: true,
      resultText,
      candidateText,
      candidateGroups,
      sourceLanguage: data.src || sourceLang,
      confidence: data.ld_result?.srclangs_confidences?.[0] || 0
    };
  } catch (error) {
    return makeError(t("errorParse", "Translate response could not be parsed."), error);
  }
}

function makeError(message, error) {
  return {
    ok: false,
    errorMessage: message,
    debugMessage: error ? String(error.message || error) : ""
  };
}

function trimCache() {
  const maxEntries = 100;
  while (memoryCache.size > maxEntries) {
    const firstKey = memoryCache.keys().next().value;
    memoryCache.delete(firstKey);
  }
}

async function openPageTranslation(pageUrl, tab, allowCurrentTab = true) {
  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) return;

  const settings = await getSettings();
  const targetLang = resolveTargetLang(settings.targetLang || DEFAULT_SETTINGS.targetLang);
  const url = new URL("https://translate.google.com/translate");
  url.searchParams.set("hl", targetLang);
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", targetLang);
  url.searchParams.set("u", pageUrl);

  if (allowCurrentTab && settings.openPageTranslationInCurrentTab && tab?.id) {
    chrome.tabs.update(tab.id, { url: url.toString() });
  } else {
    chrome.tabs.create({ url: url.toString(), active: true, index: (tab?.index || 0) + 1 });
  }
}

function openTextTranslation(text, sourceLang = "auto", targetLang = DEFAULT_SETTINGS.targetLang) {
  const resolvedTargetLang = resolveTargetLang(targetLang);
  const url = new URL("https://translate.google.com/");
  url.searchParams.set("sl", sourceLang);
  url.searchParams.set("tl", resolvedTargetLang);
  url.searchParams.set("text", text || "");
  url.searchParams.set("op", "translate");
  chrome.tabs.create({ url: url.toString(), active: true });
}

if (globalThis.__QST_TEST__) {
  globalThis.__QST_BACKGROUND_TESTS__ = {
    DEFAULT_SETTINGS,
    MENU_IDS,
    memoryCache,
    TARGET_LANG_FALLBACK,
    SUPPORTED_BROWSER_TARGET_LANGS,
    ensureDefaultSettings,
    getSettings,
    createContextMenus,
    handleTranslate,
    normalizeText,
    normalizeLang,
    resolveTargetLang,
    getBrowserLanguage,
    resolveBrowserTargetLang,
    translateWithGoogle,
    makeError,
    t,
    formatFallback,
    trimCache,
    openPageTranslation,
    openTextTranslation
  };
}
