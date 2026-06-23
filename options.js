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

const THEME_MODES = new Set(["auto", "light", "dark"]);

const LANGUAGES = [
  ["auto", "languageAuto", "Auto detect"],
  ["zh-TW", "languageZhTw", "Chinese (Traditional)"],
  ["zh-CN", "languageZhCn", "Chinese (Simplified)"],
  ["en", "languageEn", "English"],
  ["ja", "languageJa", "Japanese"],
  ["ko", "languageKo", "Korean"],
  ["fr", "languageFr", "French"],
  ["de", "languageDe", "German"],
  ["es", "languageEs", "Spanish"],
  ["it", "languageIt", "Italian"],
  ["pt", "languagePt", "Portuguese"],
  ["ru", "languageRu", "Russian"],
  ["vi", "languageVi", "Vietnamese"],
  ["th", "languageTh", "Thai"],
  ["id", "languageId", "Indonesian"]
];

const TARGET_LANGUAGES = [
  ["browser", "languageAutoBrowser", "Auto (Browser language)"],
  ...LANGUAGES.filter(([value]) => value !== "auto")
];

const $ = selector => document.querySelector(selector);

init();

async function init() {
  localizeDocument();
  fillLanguageOptions();
  await loadSettings();
  $("#saveButton").addEventListener("click", saveSettings);
  $("#resetButton").addEventListener("click", resetSettings);
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
  document.title = t("optionsPageTitle", "QuickSelect Translate Options");

  document.querySelectorAll("[data-i18n]").forEach(element => {
    element.textContent = t(element.dataset.i18n, element.textContent);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(element => {
    element.title = t(element.dataset.i18nTitle, element.title);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach(element => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel, element.getAttribute("aria-label") || ""));
  });
}

function fillLanguageOptions() {
  const sourceLang = $("#sourceLang");
  const targetLang = $("#targetLang");

  for (const [value, messageKey, fallback] of LANGUAGES) {
    sourceLang.append(new Option(t(messageKey, fallback), value));
  }

  for (const [value, messageKey, fallback] of TARGET_LANGUAGES) {
    targetLang.append(new Option(t(messageKey, fallback), value));
  }
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  $("#sourceLang").value = settings.sourceLang;
  $("#targetLang").value = settings.targetLang;
  $("#showSelectionButton").checked = Boolean(settings.showSelectionButton);
  $("#translateImmediately").checked = Boolean(settings.translateImmediately);
  $("#buttonOffsetX").value = Number(settings.buttonOffsetX);
  $("#buttonOffsetY").value = Number(settings.buttonOffsetY);
  $("#maxTextLength").value = Number(settings.maxTextLength);
  $("#openPageTranslationInCurrentTab").checked = Boolean(settings.openPageTranslationInCurrentTab);
  $("#themeMode").value = THEME_MODES.has(settings.themeMode) ? settings.themeMode : DEFAULT_SETTINGS.themeMode;
  $("#fontSize").value = clampNumber(settings.fontSize, 12, 22, DEFAULT_SETTINGS.fontSize);
}

async function saveSettings() {
  await chrome.storage.local.set(readForm());
  showStatus(t("statusSaved", "Saved."));
}

async function resetSettings() {
  await chrome.storage.local.set(DEFAULT_SETTINGS);
  await loadSettings();
  showStatus(t("statusDefaultsRestored", "Defaults restored."));
}

function readForm() {
  return {
    sourceLang: $("#sourceLang").value,
    targetLang: $("#targetLang").value,
    showSelectionButton: $("#showSelectionButton").checked,
    translateImmediately: $("#translateImmediately").checked,
    buttonOffsetX: clampNumber($("#buttonOffsetX").value, 0, 40, 8),
    buttonOffsetY: clampNumber($("#buttonOffsetY").value, 0, 40, 8),
    maxTextLength: clampNumber($("#maxTextLength").value, 100, 15000, 5000),
    openPageTranslationInCurrentTab: $("#openPageTranslationInCurrentTab").checked,
    themeMode: THEME_MODES.has($("#themeMode").value) ? $("#themeMode").value : DEFAULT_SETTINGS.themeMode,
    fontSize: clampNumber($("#fontSize").value, 12, 22, DEFAULT_SETTINGS.fontSize)
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function showStatus(message) {
  const status = $("#statusText");
  status.textContent = message;
  setTimeout(() => {
    status.textContent = "";
  }, 1800);
}

if (globalThis.__QST_TEST__) {
  globalThis.__QST_OPTIONS_TESTS__ = {
    DEFAULT_SETTINGS,
    LANGUAGES,
    TARGET_LANGUAGES,
    THEME_MODES,
    t,
    formatFallback,
    localizeDocument,
    fillLanguageOptions,
    loadSettings,
    saveSettings,
    resetSettings,
    readForm,
    clampNumber,
    showStatus
  };
}
