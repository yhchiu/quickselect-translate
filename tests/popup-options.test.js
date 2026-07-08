"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createBaseContext,
  createChromeMock,
  createDom,
  flushAsync,
  loadScript,
  plain
} = require("./test-utils");

const POPUP_IDS = [
  "sourceText",
  "sourceLang",
  "targetLang",
  "translateButton",
  "openGoogleTranslateButton",
  "resultBox",
  "resultText",
  "candidateText",
  "detectedLang",
  "copyButton",
  "speakSourceButton",
  "speakResultButton",
  "statusText",
  "optionsButton"
];

const EXPECTED_LANGUAGE_VALUES = [
  "ar",
  "bn",
  "zh-CN",
  "zh-TW",
  "cs",
  "nl",
  "en",
  "tl",
  "fr",
  "de",
  "el",
  "he",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "ms",
  "fa",
  "pl",
  "pt",
  "ro",
  "ru",
  "es",
  "sv",
  "th",
  "tr",
  "uk",
  "ur",
  "vi"
];

async function loadPopup(runtimeMessageHandler) {
  const { chrome, calls } = createChromeMock({
    runtimeMessageHandler: runtimeMessageHandler || (message => {
      if (message.type === "STJ_GET_SETTINGS") return { sourceLang: "auto", targetLang: "browser", themeMode: "auto", fontSize: 16 };
      if (message.type === "STJ_TRANSLATE") return { ok: true, resultText: "你好", sourceLanguage: "en", candidateGroups: [] };
      return {};
    })
  });
  const { document, elements } = createDom(POPUP_IDS);
  const context = createBaseContext({ chrome, document });
  loadScript("popup.js", context);
  await flushAsync();
  return { api: context.__QST_POPUP_TESTS__, context, document, elements, calls };
}

test("popup language selectors expose the expanded language list", async () => {
  const { elements } = await loadPopup();

  const sourceValues = elements.get("#sourceLang").children.map(child => child.value);
  const targetOptions = elements.get("#targetLang").children.map(child => ({
    label: child.textContent,
    value: child.value
  }));

  assert.deepEqual(sourceValues, ["auto", ...EXPECTED_LANGUAGE_VALUES]);
  assert.deepEqual(targetOptions.map(option => option.value), ["browser", ...EXPECTED_LANGUAGE_VALUES]);
  assert.deepEqual(targetOptions[0], { label: "Auto (Browser language)", value: "browser" });
});

test("popup translate renders result and candidate groups", async () => {
  const { api, elements } = await loadPopup(message => {
    if (message.type === "STJ_GET_SETTINGS") return { sourceLang: "auto", targetLang: "zh-TW", themeMode: "auto", fontSize: 16 };
    if (message.type === "STJ_TRANSLATE") {
      return {
        ok: true,
        resultText: "你好",
        sourceLanguage: "en",
        candidateText: "noun: hello",
        candidateGroups: [{ pos: "noun", terms: ["hello", "hi"] }]
      };
    }
    return {};
  });

  elements.get("#sourceText").value = "hello";
  await api.translate();

  assert.equal(elements.get("#resultText").textContent, "你好");
  assert.equal(elements.get("#detectedLang").textContent, "Detected: en");
  assert.equal(elements.get("#candidateText").hidden, false);
  assert.equal(elements.get("#candidateText").children[0].children[0].textContent, "noun");
  assert.equal(elements.get("#statusText").textContent, "");
});

test("popup opens source text in Google Translate", async () => {
  const messages = [];
  const { api, elements } = await loadPopup(message => {
    messages.push(message);
    if (message.type === "STJ_GET_SETTINGS") return { sourceLang: "en", targetLang: "zh-TW", themeMode: "auto", fontSize: 16 };
    return { ok: true };
  });

  elements.get("#sourceText").value = "hello";
  await api.openInGoogleTranslate();

  assert.deepEqual(plain(messages.find(message => message.type === "STJ_OPEN_GOOGLE_TRANSLATE")), {
    type: "STJ_OPEN_GOOGLE_TRANSLATE",
    text: "hello",
    sourceLang: "en",
    targetLang: "zh-TW"
  });
});

test("popup applies appearance settings and responds to storage changes", async () => {
  const { api, calls, document } = await loadPopup(message => {
    if (message.type === "STJ_GET_SETTINGS") return { sourceLang: "auto", targetLang: "zh-TW", themeMode: "dark", fontSize: 19 };
    return {};
  });

  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(document.documentElement.style.getPropertyValue("--popup-font-size"), "19px");
  assert.equal(api.sanitizeThemeMode("unknown"), "auto");
  assert.equal(api.sanitizeFontSize(99), 22);
  assert.equal(calls.listeners.storageChanged.length, 1);

  api.handleStorageChange({
    themeMode: { newValue: "light" },
    fontSize: { newValue: 13 }
  }, "local");

  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(document.documentElement.style.getPropertyValue("--popup-font-size"), "13px");
});

test("popup copy success switches copy button to a check state", async () => {
  const { api, context, elements } = await loadPopup();
  const button = elements.get("#copyButton");

  await api.copyText("copy me", button);

  assert.deepEqual(context.navigator.clipboard.writes, ["copy me"]);
  assert.equal(button.title, "Copied");
  assert.equal(button.classList.contains("copy-ok"), true);
});

test("popup speech reports unsupported browser and otherwise speaks", async () => {
  const { api, context, elements } = await loadPopup();

  api.speakText("hello", "en-US");
  assert.equal(context.window.speechSynthesis.spoken[0].text, "hello");
  assert.equal(api.normalizeSpeechLang("browser"), "en-US");
  assert.equal(api.normalizeSpeechLang("tl"), "fil-PH");
  assert.equal(api.normalizeSpeechLang("he"), "he-IL");

  delete context.window.SpeechSynthesisUtterance;
  delete context.SpeechSynthesisUtterance;
  api.speakText("hello", "en-US");
  assert.equal(elements.get("#statusText").textContent, "Speech synthesis is not available in this browser.");
});

test("options readForm clamps numeric settings and reset restores defaults", async () => {
  const ids = [
    "sourceLang",
    "targetLang",
    "showSelectionButton",
    "translateImmediately",
    "buttonOffsetX",
    "buttonOffsetY",
    "maxTextLength",
    "openPageTranslationInCurrentTab",
    "themeMode",
    "fontSize",
    "saveButton",
    "resetButton",
    "statusText"
  ];
  const { chrome, storageData } = createChromeMock({ storage: { targetLang: "ja" } });
  const { document, elements } = createDom(ids);
  const context = createBaseContext({ chrome, document });
  loadScript("options.js", context);
  await flushAsync();

  const sourceValues = elements.get("#sourceLang").children.map(child => child.value);
  const targetOptions = elements.get("#targetLang").children.map(child => ({
    label: child.textContent,
    value: child.value
  }));
  assert.deepEqual(sourceValues, ["auto", ...EXPECTED_LANGUAGE_VALUES]);
  assert.deepEqual(targetOptions.map(option => option.value), ["browser", ...EXPECTED_LANGUAGE_VALUES]);
  assert.deepEqual(targetOptions[0], { label: "Auto (Browser language)", value: "browser" });

  elements.get("#sourceLang").value = "auto";
  elements.get("#targetLang").value = "zh-TW";
  elements.get("#showSelectionButton").checked = true;
  elements.get("#translateImmediately").checked = false;
  elements.get("#buttonOffsetX").value = "-1";
  elements.get("#buttonOffsetY").value = "99";
  elements.get("#maxTextLength").value = "abc";
  elements.get("#openPageTranslationInCurrentTab").checked = true;
  elements.get("#themeMode").value = "dark";
  elements.get("#fontSize").value = "99";

  const api = context.__QST_OPTIONS_TESTS__;
  assert.deepEqual(plain(api.readForm()), {
    sourceLang: "auto",
    targetLang: "zh-TW",
    showSelectionButton: true,
    translateImmediately: false,
    buttonOffsetX: 0,
    buttonOffsetY: 40,
    maxTextLength: 5000,
    openPageTranslationInCurrentTab: true,
    themeMode: "dark",
    fontSize: 22
  });

  await api.resetSettings();
  assert.equal(storageData.targetLang, "browser");
  assert.equal(storageData.themeMode, "auto");
  assert.equal(storageData.fontSize, 16);
  assert.equal(elements.get("#statusText").textContent, "Defaults restored.");
});
