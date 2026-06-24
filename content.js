"use strict";

const STJ_STATE = {
  settings: null,
  lastSelectedText: "",
  lastSelectionRect: null,
  lastPointerRect: null,
  root: null,
  abortController: null,
  hideButtonTimer: 0,
  hidePanelTimer: 0,
  isPanelHovered: false
};

const FLOATING_BUTTON_TTL_MS = 4500;
const TRANSLATION_PANEL_TTL_MS = 15000;
const THEME_MODES = new Set(["auto", "light", "dark"]);
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 22;
const DEFAULT_FONT_SIZE = 16;
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
const SETTING_KEYS = new Set([
  "sourceLang",
  "targetLang",
  "showSelectionButton",
  "translateImmediately",
  "buttonOffsetX",
  "buttonOffsetY",
  "maxTextLength",
  "openPageTranslationInCurrentTab",
  "themeMode",
  "fontSize"
]);

function t(key, fallback, substitutions) {
  const message = chrome.i18n?.getMessage?.(key, substitutions);
  return message || formatFallback(fallback, substitutions);
}

function formatFallback(fallback, substitutions) {
  const values = Array.isArray(substitutions) ? substitutions : substitutions === undefined ? [] : [substitutions];
  return String(fallback || "").replace(/\$(\d+)/g, (match, index) => values[Number(index) - 1] ?? match);
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

init();

async function init() {
  STJ_STATE.settings = await sendMessage({ type: "STJ_GET_SETTINGS" });
  document.addEventListener("mousedown", handleDocumentMouseDown, true);
  document.addEventListener("mouseup", handleMouseUp, true);
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("scroll", hideSelectionUi, true);
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  chrome.storage?.onChanged?.addListener(handleStorageChange);
}

function handleDocumentMouseDown(event) {
  if (!isInsideOwnUi(event.target)) hideSelectionUi();
}

async function handleMouseUp(event) {
  if (event.button !== 0) return;
  if (isInsideOwnUi(event.target)) return;
  if (isPasswordField(event.target)) return;

  await delay(20);

  const selectedText = getSelectedText();
  STJ_STATE.lastSelectedText = selectedText;
  STJ_STATE.lastSelectionRect = getSelectionRect();
  STJ_STATE.lastPointerRect = pointRect(event.clientX, event.clientY);

  hideSelectionUi();
  if (!selectedText || !STJ_STATE.lastSelectionRect) return;

  const anchorRect = STJ_STATE.lastPointerRect || STJ_STATE.lastSelectionRect;
  if (STJ_STATE.settings.translateImmediately || !STJ_STATE.settings.showSelectionButton) {
    showPanel(selectedText, anchorRect);
  } else {
    showButton(selectedText, anchorRect);
  }
}

function handleKeyDown(event) {
  if (event.key === "Escape") hideSelectionUi();
}

function handleRuntimeMessage(message, sender, sendResponse) {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "STJ_GET_SELECTED_TEXT") {
    sendResponse(getSelectedText() || STJ_STATE.lastSelectedText || "");
    return false;
  }

  if (message.type !== "STJ_TRANSLATE_SELECTION") return false;

  const selectedText = getSelectedText() || STJ_STATE.lastSelectedText;
  const rect = getSelectionRect() || STJ_STATE.lastPointerRect || STJ_STATE.lastSelectionRect || centerRect();
  if (selectedText) showPanel(selectedText, rect);
  sendResponse({ ok: true });
  return false;
}

function handleStorageChange(changes, areaName) {
  if (areaName !== "local" || !changes || !STJ_STATE.settings) return;

  let appearanceChanged = false;
  for (const [key, change] of Object.entries(changes)) {
    if (!SETTING_KEYS.has(key)) continue;
    STJ_STATE.settings[key] = change.newValue;
    if (key === "themeMode" || key === "fontSize") appearanceChanged = true;
  }

  if (appearanceChanged) applyAppearanceSettings();
}

function getSelectedText() {
  const active = document.activeElement;
  if (active && (active.tagName === "TEXTAREA" || isTextInput(active))) {
    return active.value.slice(active.selectionStart, active.selectionEnd).trim();
  }
  return (window.getSelection()?.toString() || "").trim();
}

function getSelectionRect() {
  const active = document.activeElement;
  if (active && (active.tagName === "TEXTAREA" || isTextInput(active))) {
    return active.getBoundingClientRect();
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width || rect.height) return rect;

  const firstRect = Array.from(range.getClientRects()).find(item => item.width || item.height);
  return firstRect || null;
}

function showButton(text, rect) {
  ensureRoot();
  clearUiTimers();
  clearRoot();

  const button = document.createElement("button");
  button.className = "stj-button";
  button.type = "button";
  button.title = t("translateButton", "Translate");
  button.setAttribute("aria-label", t("translateSelectedText", "Translate selected text"));
  button.innerHTML = iconTranslate();
  positionElement(button, rect, 34, 34);
  button.addEventListener("mousedown", event => event.preventDefault());
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    showPanel(text, rect);
  });

  STJ_STATE.root.appendChild(button);
  STJ_STATE.hideButtonTimer = window.setTimeout(() => {
    if (button.isConnected) hideSelectionUi();
  }, FLOATING_BUTTON_TTL_MS);
}

async function showPanel(text, rect) {
  ensureRoot();
  clearUiTimers();
  clearRoot();

  if (STJ_STATE.abortController) STJ_STATE.abortController.abort();
  STJ_STATE.abortController = new AbortController();

  const panel = document.createElement("section");
  panel.className = "stj-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("translationResult", "Translation result"));
  const optionsLabel = escapeAttribute(t("optionsLabel", "Options"));
  const openLabel = escapeAttribute(t("openInGoogleTranslate", "Open in Google Translate"));
  const closeLabel = escapeAttribute(t("close", "Close"));
  const speakSourceLabel = escapeAttribute(t("speakSourceText", "Speak source text"));
  panel.innerHTML = `
    <div class="stj-panel-header">
      <div class="stj-panel-title">${escapeAttribute(t("extensionName", "QuickSelect Translate"))}</div>
      <div class="stj-panel-actions">
        <button class="stj-icon-button" type="button" data-action="options" title="${optionsLabel}" aria-label="${optionsLabel}">${iconSettings()}</button>
        <button class="stj-icon-button" type="button" data-action="open" title="${openLabel}" aria-label="${openLabel}">${iconExternal()}</button>
        <button class="stj-icon-button" type="button" data-action="close" title="${closeLabel}" aria-label="${closeLabel}">${iconClose()}</button>
      </div>
    </div>
    <div class="stj-panel-body">
      <div class="stj-text-row">
        <p class="stj-source"></p>
        <button class="stj-icon-button stj-inline-action" type="button" data-action="speak-source" title="${speakSourceLabel}" aria-label="${speakSourceLabel}">${iconSpeaker()}</button>
      </div>
      <p class="stj-status">${escapeAttribute(t("statusTranslating", "Translating..."))}</p>
    </div>
  `;

  positionElement(panel, rect, 360, 260);
  STJ_STATE.root.appendChild(panel);
  STJ_STATE.isPanelHovered = panel.matches(":hover");

  const source = panel.querySelector(".stj-source");
  const body = panel.querySelector(".stj-panel-body");
  const speakSourceButton = panel.querySelector('[data-action="speak-source"]');
  source.textContent = text;

  panel.addEventListener("mousedown", event => event.stopPropagation());
  panel.addEventListener("mouseenter", () => {
    STJ_STATE.isPanelHovered = true;
    clearPanelAutoHideTimer();
  });
  panel.addEventListener("mouseleave", () => {
    STJ_STATE.isPanelHovered = false;
    schedulePanelAutoHide();
  });
  panel.addEventListener("click", event => {
    schedulePanelAutoHide();
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;

    if (action === "close") hideSelectionUi();
    if (action === "options") {
      sendMessage({ type: "STJ_OPEN_OPTIONS" });
    }
    if (action === "speak-source") {
      speakText(text, button.dataset.lang || STJ_STATE.settings.sourceLang);
    }
    if (action === "speak-result" && button.dataset.resultText) {
      speakText(button.dataset.resultText, button.dataset.lang || STJ_STATE.settings.targetLang);
    }
    if (action === "open") {
      sendMessage({
        type: "STJ_OPEN_GOOGLE_TRANSLATE",
        text,
        sourceLang: STJ_STATE.settings.sourceLang,
        targetLang: STJ_STATE.settings.targetLang
      });
    }
    if (action === "copy" && button.dataset.resultText) {
      copyText(button.dataset.resultText, button);
    }
  });

  let result;
  try {
    result = await sendMessage({
      type: "STJ_TRANSLATE",
      text,
      sourceLang: STJ_STATE.settings.sourceLang,
      targetLang: STJ_STATE.settings.targetLang
    });
  } catch (error) {
    result = {
      ok: false,
      errorMessage: chrome.runtime.lastError?.message || error?.message || t("statusTranslationFailed", "Translation failed.")
    };
  }

  if (!panel.isConnected) return;

  if (!result || !result.ok) {
    body.innerHTML = "";
    body.append(source, makeStatus(result?.errorMessage || t("statusTranslationFailed", "Translation failed."), true));
    schedulePanelAutoHide();
    return;
  }

  const resultNode = document.createElement("p");
  resultNode.className = "stj-result";
  resultNode.textContent = result.resultText || "";
  const resultRow = document.createElement("div");
  resultRow.className = "stj-text-row stj-result-row";
  const resultActions = document.createElement("div");
  resultActions.className = "stj-inline-actions";
  const speakResultButton = document.createElement("button");
  speakResultButton.className = "stj-icon-button stj-inline-action";
  speakResultButton.type = "button";
  speakResultButton.dataset.action = "speak-result";
  speakResultButton.dataset.lang = STJ_STATE.settings.targetLang;
  speakResultButton.dataset.resultText = result.resultText || "";
  speakResultButton.title = t("speakTranslation", "Speak translation");
  speakResultButton.setAttribute("aria-label", t("speakTranslation", "Speak translation"));
  speakResultButton.innerHTML = iconSpeaker();
  const copyButton = document.createElement("button");
  copyButton.className = "stj-icon-button stj-inline-action";
  copyButton.type = "button";
  copyButton.dataset.action = "copy";
  copyButton.dataset.resultText = result.resultText || "";
  copyButton.title = t("copyTranslation", "Copy translation");
  copyButton.setAttribute("aria-label", t("copyTranslation", "Copy translation"));
  copyButton.innerHTML = iconCopy();
  resultActions.append(speakResultButton, copyButton);
  resultRow.append(resultNode, resultActions);

  body.innerHTML = "";
  body.append(source.parentElement, resultRow);

  if (result.candidateText) {
    body.appendChild(renderCandidateGroups(result));
  }

  speakSourceButton.dataset.lang = result.sourceLanguage || STJ_STATE.settings.sourceLang;
  schedulePanelAutoHide();
}

function ensureRoot() {
  if (STJ_STATE.root?.isConnected) {
    removeDuplicateRoots(STJ_STATE.root);
    applyAppearanceSettings();
    return;
  }

  const existingRoot = document.getElementById("stj-root");
  if (existingRoot) {
    STJ_STATE.root = existingRoot;
    removeDuplicateRoots(existingRoot);
    applyAppearanceSettings();
    return;
  }

  STJ_STATE.root = document.createElement("div");
  STJ_STATE.root.id = "stj-root";
  document.documentElement.appendChild(STJ_STATE.root);
  applyAppearanceSettings();
}

function applyAppearanceSettings() {
  if (!STJ_STATE.root) return;

  const settings = STJ_STATE.settings || {};
  STJ_STATE.root.dataset.theme = sanitizeThemeMode(settings.themeMode);
  STJ_STATE.root.style.setProperty("--stj-font-size", `${sanitizeFontSize(settings.fontSize)}px`);
}

function sanitizeThemeMode(value) {
  return THEME_MODES.has(value) ? value : "auto";
}

function sanitizeFontSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_FONT_SIZE;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, number));
}

function hideSelectionUi() {
  clearUiTimers();
  stopSpeaking();
  clearRoot();
}

function clearRoot() {
  STJ_STATE.isPanelHovered = false;
  const roots = document.querySelectorAll("#stj-root");
  roots.forEach((root, index) => {
    root.textContent = "";
    if (index > 0) root.remove();
  });
  STJ_STATE.root = roots[0] || STJ_STATE.root;
}

function removeDuplicateRoots(rootToKeep) {
  document.querySelectorAll("#stj-root").forEach(root => {
    if (root !== rootToKeep) root.remove();
  });
}

function clearUiTimers() {
  if (STJ_STATE.hideButtonTimer) window.clearTimeout(STJ_STATE.hideButtonTimer);
  clearPanelAutoHideTimer();
  STJ_STATE.hideButtonTimer = 0;
}

function schedulePanelAutoHide() {
  if (STJ_STATE.isPanelHovered) return;
  if (STJ_STATE.hidePanelTimer) window.clearTimeout(STJ_STATE.hidePanelTimer);
  STJ_STATE.hidePanelTimer = window.setTimeout(hideSelectionUi, TRANSLATION_PANEL_TTL_MS);
}

function clearPanelAutoHideTimer() {
  if (!STJ_STATE.hidePanelTimer) return;
  window.clearTimeout(STJ_STATE.hidePanelTimer);
  STJ_STATE.hidePanelTimer = 0;
}

function positionElement(element, rect, expectedWidth, expectedHeight) {
  const offsetX = Number(STJ_STATE.settings.buttonOffsetX) || 8;
  const offsetY = Number(STJ_STATE.settings.buttonOffsetY) || 8;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = rect.left + Math.min(rect.width, 36) + offsetX;
  let top = rect.bottom + offsetY;

  if (left + expectedWidth > viewportWidth - 8) {
    left = Math.max(8, viewportWidth - expectedWidth - 8);
  }
  if (top + expectedHeight > viewportHeight - 8) {
    top = Math.max(8, rect.top - expectedHeight - offsetY);
  }

  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}

function makeStatus(text, isError = false) {
  const node = document.createElement("p");
  node.className = isError ? "stj-status stj-error" : "stj-status";
  node.textContent = text;
  return node;
}

function renderCandidateGroups(result) {
  const candidates = document.createElement("div");
  candidates.className = "stj-candidates";

  const groups = Array.isArray(result.candidateGroups) && result.candidateGroups.length
    ? result.candidateGroups
    : parseCandidateText(result.candidateText);

  if (!groups.length) {
    candidates.textContent = result.candidateText || "";
    return candidates;
  }

  for (const group of groups) {
    const item = document.createElement("section");
    item.className = "stj-candidate-group";

    if (group.pos) {
      const pos = document.createElement("div");
      pos.className = "stj-candidate-pos";
      pos.textContent = group.pos;
      item.appendChild(pos);
    }

    const terms = document.createElement("div");
    terms.className = "stj-candidate-terms";
    terms.textContent = Array.isArray(group.terms) ? group.terms.join(", ") : "";
    item.appendChild(terms);
    candidates.appendChild(item);
  }

  return candidates;
}

function parseCandidateText(candidateText) {
  return String(candidateText || "")
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

async function copyText(text, button) {
  try {
    await navigator.clipboard?.writeText(String(text || ""));
    showCopySuccess(button);
  } catch (error) {
    button.title = t("statusCopyFailed", "Copy failed.");
  }
}

function showCopySuccess(button) {
  const originalHtml = button.innerHTML;
  const originalTitle = button.title;
  const originalLabel = button.getAttribute("aria-label");
  button.innerHTML = iconCheck();
  button.title = t("copied", "Copied");
  button.setAttribute("aria-label", t("copied", "Copied"));
  button.classList.add("stj-copy-ok");

  window.setTimeout(() => {
    if (!button.isConnected) return;
    button.innerHTML = originalHtml;
    button.title = originalTitle;
    button.setAttribute("aria-label", originalLabel || t("copyTranslation", "Copy translation"));
    button.classList.remove("stj-copy-ok");
  }, 1200);
}

function speakText(text, lang) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
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

function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function normalizeSpeechLang(lang) {
  const value = String(lang || "").trim();
  if (!value || value === "auto" || value === "browser") return getBrowserSpeechLang();
  return SPEECH_LANG_ALIASES[value] || value;
}

function getBrowserSpeechLang() {
  return (
    chrome.i18n?.getUILanguage?.()?.replace("_", "-") ||
    document.documentElement.lang ||
    (Array.isArray(navigator.languages) && navigator.languages[0]) ||
    navigator.language ||
    "en"
  );
}

function findVoiceForLang(lang) {
  if (!("speechSynthesis" in window)) return null;

  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const normalizedLang = lang.toLowerCase();
  const baseLang = normalizedLang.split("-")[0];
  return (
    voices.find(voice => voice.lang.toLowerCase() === normalizedLang) ||
    voices.find(voice => voice.lang.toLowerCase().startsWith(`${baseLang}-`)) ||
    null
  );
}

function isTextInput(element) {
  if (!element || element.tagName !== "INPUT") return false;
  const type = (element.type || "text").toLowerCase();
  return ["text", "search", "url", "email", "tel", "number"].includes(type);
}

function isPasswordField(element) {
  return element?.tagName === "INPUT" && element.type === "password";
}

function isInsideOwnUi(target) {
  return Boolean(target?.closest?.("#stj-root"));
}

function centerRect() {
  return {
    left: window.innerWidth / 2 - 1,
    right: window.innerWidth / 2 + 1,
    top: window.innerHeight / 2 - 1,
    bottom: window.innerHeight / 2 + 1,
    width: 2,
    height: 2
  };
}

function pointRect(x, y) {
  return {
    left: x,
    right: x,
    top: y,
    bottom: y,
    width: 0,
    height: 0
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function iconTranslate() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.3" cy="10.2" r="5.4" fill="#eff6ff"/><circle cx="15.7" cy="12.9" r="5.4" fill="#dbeafe"/><path d="M5.8 13.9 8.2 5.7l2.5 8.2m-4.1-2h3.2" fill="none" stroke="#1d4ed8" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 9.4h5.6M15.8 7.4v2M14.2 11.7c1.1 1.9 2.6 3.3 4.6 4.1M18.5 11.7c-.9 2.2-2.5 3.9-4.9 5" fill="none" stroke="#0f172a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 5.2h5.8l-1.3-1.3M14.1 19h-5.8l1.3 1.3" fill="none" stroke="#facc15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function iconSpeaker() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16 9.5c1.1 1.4 1.1 3.6 0 5M18.7 7c2.4 2.8 2.4 7.2 0 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function iconSettings() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" stroke-width="2"/><path d="M19 14.4a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 20.2 8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function iconCopy() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M8 8h10v12H8zM6 16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function iconCheck() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function iconExternal() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M14 4h6v6m0-6-9 9M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function iconClose() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}

if (globalThis.__QST_TEST__) {
  globalThis.__QST_CONTENT_TESTS__ = {
    STJ_STATE,
    FLOATING_BUTTON_TTL_MS,
    TRANSLATION_PANEL_TTL_MS,
    SPEECH_LANG_ALIASES,
    handleRuntimeMessage,
    t,
    formatFallback,
    escapeAttribute,
    handleStorageChange,
    applyAppearanceSettings,
    sanitizeThemeMode,
    sanitizeFontSize,
    normalizeSpeechLang,
    getBrowserSpeechLang,
    findVoiceForLang,
    parseCandidateText,
    renderCandidateGroups,
    copyText,
    showCopySuccess,
    speakText,
    stopSpeaking,
    pointRect,
    centerRect,
    positionElement,
    makeStatus,
    isTextInput,
    isPasswordField,
    schedulePanelAutoHide,
    clearPanelAutoHideTimer,
    clearUiTimers,
    iconTranslate,
    iconSpeaker,
    iconSettings,
    iconCopy,
    iconCheck,
    iconExternal,
    iconClose
  };
}
