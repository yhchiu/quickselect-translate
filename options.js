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
const LOCAL_FILE_ORIGIN = "file:///*";
const LOCAL_FILE_PERMISSION = "scripting";

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

const TARGET_LANGUAGES = [
  ["browser", "languageAutoBrowser", "Auto (Browser language)"],
  ...LANGUAGES.filter(([value]) => value !== "auto")
];

const $ = selector => document.querySelector(selector);

init();

async function init() {
  localizeDocument();
  fillLanguageOptions();
  await Promise.all([loadSettings(), initializeLocalFileAccess()]);
  $("#saveButton").addEventListener("click", saveSettings);
  $("#resetButton").addEventListener("click", resetSettings);
  $("#localFileToggleButton").addEventListener("click", requestLocalFileAccess);
  $("#refreshLocalFileAccessButton").addEventListener("click", refreshLocalFileAccessStatus);
  $("#openExtensionSettingsButton").addEventListener("click", openExtensionSettings);
  $("#copyExtensionSettingsLinkButton").addEventListener("click", copyExtensionSettingsLink);

  window.addEventListener?.("focus", refreshLocalFileAccessStatus);
  document.addEventListener("visibilitychange", () => {
    if (!document.visibilityState || document.visibilityState === "visible") {
      refreshLocalFileAccessStatus();
    }
  });
  chrome.permissions.onAdded?.addListener(refreshLocalFileAccessStatus);
  chrome.permissions.onRemoved?.addListener(refreshLocalFileAccessStatus);
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

async function initializeLocalFileAccess() {
  const result = await syncLocalFileContentScript();
  if (result?.ok === false) {
    renderLocalFileAccessError(new Error(result.errorMessage || "Local file content script sync failed."));
    return;
  }
  await refreshLocalFileAccessStatus();
}

async function syncLocalFileContentScript() {
  try {
    return await chrome.runtime.sendMessage({ type: "STJ_SYNC_LOCAL_FILE_ACCESS" });
  } catch (error) {
    return {
      ok: false,
      errorMessage: String(error?.message || error)
    };
  }
}

async function getLocalFileAccessState() {
  const permissionGranted = await chrome.permissions.contains({
    permissions: [LOCAL_FILE_PERMISSION],
    origins: [LOCAL_FILE_ORIGIN]
  });
  const fileSchemeAllowed = await chrome.extension.isAllowedFileSchemeAccess();

  return { permissionGranted, fileSchemeAllowed };
}

async function refreshLocalFileAccessStatus() {
  setLocalFileStatusLoading();
  try {
    renderLocalFileAccessState(await getLocalFileAccessState());
  } catch (error) {
    renderLocalFileAccessError(error);
  }
}

function setLocalFileStatusLoading() {
  const toggleButton = $("#localFileToggleButton");
  $("#localFileStatus").className = "permission-status is-loading";
  $("#localFileStatusTitle").textContent = t("localFileStatusCheckingTitle", "Checking status...");
  $("#localFileStatusDescription").textContent = t(
    "localFileStatusCheckingDescription",
    "Checking the local file permission and Chrome file URL access setting."
  );
  toggleButton.disabled = true;
  $("#refreshLocalFileAccessButton").disabled = true;
}

function renderLocalFileAccessState({ permissionGranted, fileSchemeAllowed }) {
  const status = $("#localFileStatus");
  const title = $("#localFileStatusTitle");
  const description = $("#localFileStatusDescription");
  const toggleButton = $("#localFileToggleButton");
  const instructions = $("#localFileInstructions");

  toggleButton.disabled = false;
  $("#refreshLocalFileAccessButton").disabled = false;

  if (!fileSchemeAllowed) {
    status.className = "permission-status is-warning";
    title.textContent = permissionGranted
      ? t("localFileEnabledNeedsAccessTitle", "Enabled, but file URL access is off")
      : t("localFileNeedsAccessTitle", "Allow access to file URLs is off");
    description.textContent = permissionGranted
      ? t(
        "localFileEnabledNeedsAccessDescription",
        "Chrome's “Allow access to file URLs” switch is still off. Turn it on to use this feature."
      )
      : t(
        "localFileNeedsAccessDescription",
        "Turn on Chrome's “Allow access to file URLs” switch before enabling local file translation."
      );
    toggleButton.hidden = true;
    instructions.hidden = false;
    return;
  }

  if (!permissionGranted) {
    status.className = "permission-status is-disabled";
    title.textContent = t("localFileDisabledTitle", "Not enabled");
    description.textContent = t(
      "localFileDisabledDescription",
      "Enable this feature to translate selected text on local file pages."
    );
    toggleButton.textContent = t("enableLocalFileTranslation", "Enable local file translation");
    toggleButton.hidden = false;
    instructions.hidden = true;
    return;
  }

  toggleButton.hidden = true;

  status.className = "permission-status is-enabled";
  title.textContent = t("localFileEnabledTitle", "Enabled and ready");
  description.textContent = t(
    "localFileEnabledDescription",
    "Selected-text translation is available on supported file:// local file pages."
  );
  instructions.hidden = true;
}

function renderLocalFileAccessError(error) {
  const toggleButton = $("#localFileToggleButton");
  $("#localFileStatus").className = "permission-status is-error";
  $("#localFileStatusTitle").textContent = t("localFileStatusErrorTitle", "Could not check local file access");
  $("#localFileStatusDescription").textContent = t(
    "localFileStatusErrorDescription",
    "Reload the options page and try again."
  );
  toggleButton.disabled = false;
  toggleButton.textContent = t("enableLocalFileTranslation", "Enable local file translation");
  toggleButton.hidden = false;
  $("#refreshLocalFileAccessButton").disabled = false;
  $("#localFileInstructions").hidden = true;
  console.warn("Failed to inspect local file access", error);
}

async function requestLocalFileAccess() {
  setLocalFileStatusLoading();
  try {
    const currentState = await getLocalFileAccessState();
    if (!currentState.fileSchemeAllowed) {
      renderLocalFileAccessState(currentState);
      return;
    }

    const granted = await chrome.permissions.request({
      permissions: [LOCAL_FILE_PERMISSION],
      origins: [LOCAL_FILE_ORIGIN]
    });
    if (granted) {
      const result = await syncLocalFileContentScript();
      if (result?.ok === false) throw new Error(result.errorMessage || "Local file content script sync failed.");
    } else {
      showStatus(t("localFilePermissionNotGranted", "Local file permission was not granted."));
    }
    await refreshLocalFileAccessStatus();
  } catch (error) {
    renderLocalFileAccessError(error);
  }
}

function getExtensionSettingsUrl() {
  return `chrome://extensions/?id=${chrome.runtime.id}`;
}

function openExtensionSettings() {
  chrome.tabs.create({ url: getExtensionSettingsUrl(), active: true });
}

async function copyExtensionSettingsLink() {
  const button = $("#copyExtensionSettingsLinkButton");
  const originalText = t("copySettingsLink", "Copy settings link");

  try {
    await navigator.clipboard.writeText(getExtensionSettingsUrl());
    button.textContent = t("copiedSettingsLink", "Copied");
    setTimeout(() => {
      button.textContent = originalText;
    }, 1800);
  } catch (error) {
    showStatus(t("localFileCopyLinkFailed", "Could not copy the settings link."));
  }
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
    LOCAL_FILE_ORIGIN,
    LOCAL_FILE_PERMISSION,
    t,
    formatFallback,
    localizeDocument,
    fillLanguageOptions,
    loadSettings,
    initializeLocalFileAccess,
    syncLocalFileContentScript,
    getLocalFileAccessState,
    refreshLocalFileAccessStatus,
    setLocalFileStatusLoading,
    renderLocalFileAccessState,
    renderLocalFileAccessError,
    requestLocalFileAccess,
    getExtensionSettingsUrl,
    openExtensionSettings,
    copyExtensionSettingsLink,
    saveSettings,
    resetSettings,
    readForm,
    clampNumber,
    showStatus
  };
}
