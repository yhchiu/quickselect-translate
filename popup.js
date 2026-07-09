"use strict";

const LANGUAGES = [
  ["auto", "languageAuto", "Auto detect"],
  ["ar", "languageAr", "Arabic"],
  ["bn", "languageBn", "Bengali"],
  ["zh-CN", "languageZhCn", "Chinese (Simplified)"],
  ["zh-TW", "languageZhTw", "Chinese (Traditional)"],
  ["cs", "languageCs", "Czech"],
  ["nl", "languageNl", "Dutch"],
  ["en", "languageEn", "English"],
  ["tl", "languageTl", "Filipino"],
  ["fr", "languageFr", "French"],
  ["de", "languageDe", "German"],
  ["el", "languageEl", "Greek"],
  ["he", "languageHe", "Hebrew"],
  ["hi", "languageHi", "Hindi"],
  ["id", "languageId", "Indonesian"],
  ["it", "languageIt", "Italian"],
  ["ja", "languageJa", "Japanese"],
  ["ko", "languageKo", "Korean"],
  ["ms", "languageMs", "Malay"],
  ["fa", "languageFa", "Persian"],
  ["pl", "languagePl", "Polish"],
  ["pt", "languagePt", "Portuguese"],
  ["ro", "languageRo", "Romanian"],
  ["ru", "languageRu", "Russian"],
  ["es", "languageEs", "Spanish"],
  ["sv", "languageSv", "Swedish"],
  ["th", "languageTh", "Thai"],
  ["tr", "languageTr", "Turkish"],
  ["uk", "languageUk", "Ukrainian"],
  ["ur", "languageUr", "Urdu"],
  ["vi", "languageVi", "Vietnamese"]
];

const SPEECH_LANG_ALIASES = Object.freeze({
  ar: "ar-SA",
  bn: "bn-BD",
  cs: "cs-CZ",
  nl: "nl-NL",
  en: "en-US",
  tl: "fil-PH",
  fr: "fr-FR",
  de: "de-DE",
  el: "el-GR",
  he: "he-IL",
  hi: "hi-IN",
  id: "id-ID",
  it: "it-IT",
  ja: "ja-JP",
  ko: "ko-KR",
  ms: "ms-MY",
  fa: "fa-IR",
  pl: "pl-PL",
  pt: "pt-BR",
  ro: "ro-RO",
  ru: "ru-RU",
  es: "es-ES",
  sv: "sv-SE",
  th: "th-TH",
  tr: "tr-TR",
  uk: "uk-UA",
  ur: "ur-PK",
  vi: "vi-VN"
});

const TARGET_LANGUAGES = [
  ["browser", "languageAutoBrowser", "Auto (Browser language)"],
  ...LANGUAGES.filter(([value]) => value !== "auto")
];

const THEME_MODES = new Set(["auto", "light", "dark"]);
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 22;
const DEFAULT_FONT_SIZE = 16;

const $ = selector => document.querySelector(selector);

const sourceText = $("#sourceText");
const sourceLang = $("#sourceLang");
const targetLang = $("#targetLang");
const translateButton = $("#translateButton");
const openGoogleTranslateButton = $("#openGoogleTranslateButton");
const resultBox = $("#resultBox");
const resultText = $("#resultText");
const candidateText = $("#candidateText");
const detectedLang = $("#detectedLang");
const copyButton = $("#copyButton");
const speakSourceButton = $("#speakSourceButton");
const speakResultButton = $("#speakResultButton");
const statusText = $("#statusText");
let lastResult = null;
let currentSettings = {};

init();

async function init() {
  localizeDocument();
  fillLanguageOptions();
  speakSourceButton.innerHTML = iconSpeaker();
  speakResultButton.innerHTML = iconSpeaker();
  copyButton.innerHTML = iconCopy();
  const settings = await chrome.runtime.sendMessage({ type: "STJ_GET_SETTINGS" });
  currentSettings = settings || {};
  applyAppearanceSettings(currentSettings);
  sourceLang.value = currentSettings.sourceLang || "auto";
  targetLang.value = currentSettings.targetLang || "browser";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    const selected = await chrome.tabs
      .sendMessage(tab.id, { type: "STJ_GET_SELECTED_TEXT" })
      .catch(() => "");
    if (typeof selected === "string" && selected.trim()) sourceText.value = selected.trim();
  }

  translateButton.addEventListener("click", translate);
  openGoogleTranslateButton.addEventListener("click", openInGoogleTranslate);
  sourceText.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") translate();
  });
  copyButton.addEventListener("click", () => copyText(resultText.textContent, copyButton));
  speakSourceButton.addEventListener("click", () => {
    speakText(sourceText.value, lastResult?.sourceLanguage || sourceLang.value);
  });
  speakResultButton.addEventListener("click", () => {
    speakText(resultText.textContent, targetLang.value);
  });
  $("#optionsButton").addEventListener("click", () => chrome.runtime.openOptionsPage());
  chrome.storage?.onChanged?.addListener(handleStorageChange);

  if (sourceText.value.trim()) translate();
}

function t(key, fallback, substitutions) {
  const message = chrome.i18n?.getMessage?.(key, substitutions);
  return message || formatFallback(fallback, substitutions);
}

function formatFallback(fallback, substitutions) {
  const values = Array.isArray(substitutions) ? substitutions : substitutions === undefined ? [] : [substitutions];
  return String(fallback || "").replace(/\$(\d+)/g, (match, index) => values[Number(index) - 1] ?? match);
}

function localizeDocument() {
  document.documentElement.lang = chrome.i18n?.getUILanguage?.()?.replace("_", "-") || "en";
  document.title = t("extensionName", "QuickSelect Translate");

  document.querySelectorAll("[data-i18n]").forEach(element => {
    element.textContent = t(element.dataset.i18n, element.textContent);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(element => {
    element.title = t(element.dataset.i18nTitle, element.title);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach(element => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel, element.getAttribute("aria-label") || ""));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(element => {
    element.placeholder = t(element.dataset.i18nPlaceholder, element.placeholder);
  });
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local" || !changes) return;

  let appearanceChanged = false;
  for (const key of ["themeMode", "fontSize"]) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
    currentSettings[key] = changes[key].newValue;
    appearanceChanged = true;
  }

  if (appearanceChanged) applyAppearanceSettings(currentSettings);
}

function applyAppearanceSettings(settings = {}) {
  document.documentElement.dataset.theme = sanitizeThemeMode(settings.themeMode);
  document.documentElement.style.setProperty("--popup-font-size", `${sanitizeFontSize(settings.fontSize)}px`);
}

function sanitizeThemeMode(value) {
  return THEME_MODES.has(value) ? value : "auto";
}

function sanitizeFontSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_FONT_SIZE;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, number));
}

function fillLanguageOptions() {
  for (const [value, messageKey, fallback] of LANGUAGES) {
    sourceLang.append(new Option(t(messageKey, fallback), value));
  }

  for (const [value, messageKey, fallback] of TARGET_LANGUAGES) {
    targetLang.append(new Option(t(messageKey, fallback), value));
  }
}

async function translate() {
  const text = sourceText.value.trim();
  if (!text) {
    showStatus(t("statusEnterText", "Enter text to translate."), true);
    return;
  }

  resultBox.hidden = true;
  lastResult = null;
  translateButton.disabled = true;
  showStatus(t("statusTranslating", "Translating..."));

  const result = await chrome.runtime.sendMessage({
    type: "STJ_TRANSLATE",
    text,
    sourceLang: sourceLang.value,
    targetLang: targetLang.value
  });

  translateButton.disabled = false;

  if (!result || !result.ok) {
    showStatus(result?.errorMessage || t("statusTranslationFailed", "Translation failed."), true);
    return;
  }

  resultText.textContent = result.resultText || "";
  detectedLang.textContent = result.sourceLanguage ? t("detectedLanguage", "Detected: $1", result.sourceLanguage) : "";
  renderCandidateGroups(result);
  candidateText.hidden = !result.candidateText;
  resultBox.hidden = false;
  lastResult = result;
  showStatus("");
}

async function openInGoogleTranslate() {
  const text = sourceText.value.trim();

  await chrome.runtime.sendMessage({
    type: "STJ_OPEN_GOOGLE_TRANSLATE",
    text,
    sourceLang: sourceLang.value,
    targetLang: targetLang.value
  });
}

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

async function copyText(text, button) {
  try {
    await navigator.clipboard?.writeText(String(text || ""));
    showCopySuccess(button);
  } catch (error) {
    showStatus(t("statusCopyFailed", "Copy failed."), true);
  }
}

function showCopySuccess(button) {
  const originalHtml = button.innerHTML;
  const originalTitle = button.title;
  const originalLabel = button.getAttribute("aria-label");
  button.innerHTML = iconCheck();
  button.title = t("copied", "Copied");
  button.setAttribute("aria-label", t("copied", "Copied"));
  button.classList.add("copy-ok");

  setTimeout(() => {
    button.innerHTML = originalHtml;
    button.title = originalTitle;
    button.setAttribute("aria-label", originalLabel || t("copyTranslation", "Copy translation"));
    button.classList.remove("copy-ok");
  }, 1200);
}

function renderCandidateGroups(result) {
  candidateText.textContent = "";

  const groups = Array.isArray(result.candidateGroups) && result.candidateGroups.length
    ? result.candidateGroups
    : parseCandidateText(result.candidateText);

  if (!groups.length) {
    candidateText.textContent = result.candidateText || "";
    return;
  }

  for (const group of groups) {
    const item = document.createElement("section");
    item.className = "candidate-group";

    if (group.pos) {
      const pos = document.createElement("div");
      pos.className = "candidate-pos";
      pos.textContent = group.pos;
      item.appendChild(pos);
    }

    const terms = document.createElement("div");
    terms.className = "candidate-terms";
    terms.textContent = Array.isArray(group.terms) ? group.terms.join(", ") : "";
    item.appendChild(terms);
    candidateText.appendChild(item);
  }
}

function parseCandidateText(text) {
  return String(text || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [pos, ...rest] = line.split(":");
      return rest.length
        ? { pos: pos.trim(), terms: rest.join(":").split(",").map(term => term.trim()).filter(Boolean) }
        : { pos: "", terms: line.split(",").map(term => term.trim()).filter(Boolean) };
    });
}

function speakText(text, lang) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    showStatus(t("statusSpeechUnavailable", "Speech synthesis is not available in this browser."), true);
    return;
  }

  const trimmedText = String(text || "").trim();
  if (!trimmedText) return;

  const utterance = new SpeechSynthesisUtterance(trimmedText.slice(0, 800));
  utterance.lang = normalizeSpeechLang(lang);
  utterance.rate = 0.95;

  const voice = findVoiceForLang(utterance.lang);
  if (voice) utterance.voice = voice;

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function normalizeSpeechLang(lang) {
  const value = String(lang || "").trim();
  if (!value || value === "auto" || value === "browser") return getBrowserSpeechLang();
  return SPEECH_LANG_ALIASES[value] || value;
}

function getBrowserSpeechLang() {
  return (
    chrome.i18n?.getUILanguage?.()?.replace("_", "-") ||
    (Array.isArray(navigator.languages) && navigator.languages[0]) ||
    navigator.language ||
    "en"
  );
}

function findVoiceForLang(lang) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const normalizedLang = lang.toLowerCase();
  const baseLang = normalizedLang.split("-")[0];
  return (
    voices.find(voice => voice.lang.toLowerCase() === normalizedLang) ||
    voices.find(voice => voice.lang.toLowerCase().startsWith(`${baseLang}-`)) ||
    null
  );
}

function iconSpeaker() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16 9.5c1.1 1.4 1.1 3.6 0 5M18.7 7c2.4 2.8 2.4 7.2 0 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function iconCopy() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M8 8h10v12H8zM6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function iconCheck() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

if (globalThis.__QST_TEST__) {
  globalThis.__QST_POPUP_TESTS__ = {
    LANGUAGES,
    TARGET_LANGUAGES,
    SPEECH_LANG_ALIASES,
    THEME_MODES,
    t,
    formatFallback,
    localizeDocument,
    fillLanguageOptions,
    handleStorageChange,
    applyAppearanceSettings,
    sanitizeThemeMode,
    sanitizeFontSize,
    translate,
    openInGoogleTranslate,
    showStatus,
    copyText,
    showCopySuccess,
    renderCandidateGroups,
    parseCandidateText,
    speakText,
    normalizeSpeechLang,
    getBrowserSpeechLang,
    findVoiceForLang,
    iconSpeaker,
    iconCopy,
    iconCheck
  };
}
