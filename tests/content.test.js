"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FakeElement,
  createBaseContext,
  createChromeMock,
  createDom,
  flushAsync,
  loadScript,
  plain
} = require("./test-utils");

async function loadContent() {
  const { chrome, calls } = createChromeMock({
    runtimeMessageHandler: message => {
      if (message.type === "STJ_GET_SETTINGS") {
        return {
          sourceLang: "auto",
          targetLang: "zh-TW",
          showSelectionButton: true,
          translateImmediately: false,
          buttonOffsetX: 8,
          buttonOffsetY: 8,
          maxTextLength: 5000,
          openPageTranslationInCurrentTab: false,
          themeMode: "auto",
          fontSize: 16
        };
      }
      return { ok: true };
    }
  });
  const { document } = createDom();
  const context = createBaseContext({ chrome, document });
  loadScript("content.js", context);
  await flushAsync();
  return { api: context.__QST_CONTENT_TESTS__, context, calls, document };
}

test("parseCandidateText converts plain candidate text to groups", async () => {
  const { api } = await loadContent();

  assert.deepEqual(plain(api.parseCandidateText("noun: world, earth\nverb: greet")), [
    { pos: "noun", terms: ["world", "earth"] },
    { pos: "verb", terms: ["greet"] }
  ]);
});

test("renderCandidateGroups renders separated part-of-speech groups", async () => {
  const { api } = await loadContent();

  const node = api.renderCandidateGroups({
    candidateGroups: [
      { pos: "noun", terms: ["世界", "地球"] },
      { pos: "verb", terms: ["問候"] }
    ]
  });

  assert.equal(node.className, "stj-candidates");
  assert.equal(node.children.length, 2);
  assert.equal(node.children[0].children[0].className, "stj-candidate-pos");
  assert.equal(node.children[0].children[0].textContent, "noun");
  assert.equal(node.children[0].children[1].textContent, "世界, 地球");
});

test("positionElement keeps bubble inside the viewport", async () => {
  const { api, context } = await loadContent();
  context.window.innerWidth = 320;
  context.window.innerHeight = 240;
  api.STJ_STATE.settings = { buttonOffsetX: 8, buttonOffsetY: 8 };

  const element = new FakeElement("div");
  api.positionElement(element, { left: 310, top: 230, bottom: 232, width: 0, height: 0 }, 120, 80);

  assert.equal(element.style.left, "192px");
  assert.equal(element.style.top, "142px");
});

test("panel auto-hide is suspended while hovered and scheduled after leaving", async () => {
  const { api, context } = await loadContent();

  api.STJ_STATE.isPanelHovered = true;
  api.schedulePanelAutoHide();
  assert.equal(context.__timers.set.length, 0);

  api.STJ_STATE.isPanelHovered = false;
  api.schedulePanelAutoHide();
  assert.equal(context.__timers.set.length, 1);
  assert.equal(context.__timers.set[0].delay, api.TRANSLATION_PANEL_TTL_MS);
});

test("appearance settings are applied and updated from storage changes", async () => {
  const { api, document, calls } = await loadContent();
  const root = document.createElement("div");
  root.id = "stj-root";
  document.documentElement.appendChild(root);
  api.STJ_STATE.root = root;

  api.STJ_STATE.settings = { themeMode: "dark", fontSize: 20 };
  api.applyAppearanceSettings();

  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.style.getPropertyValue("--stj-font-size"), "20px");
  assert.equal(api.sanitizeThemeMode("unknown"), "auto");
  assert.equal(api.sanitizeFontSize(99), 22);
  assert.equal(calls.listeners.storageChanged.length, 1);

  api.handleStorageChange({
    themeMode: { newValue: "light" },
    fontSize: { newValue: 14 }
  }, "local");

  assert.equal(api.STJ_STATE.settings.themeMode, "light");
  assert.equal(api.STJ_STATE.settings.fontSize, 14);
  assert.equal(root.dataset.theme, "light");
  assert.equal(root.style.getPropertyValue("--stj-font-size"), "14px");
});

test("copyText writes to clipboard and temporarily shows a check icon", async () => {
  const { api, context } = await loadContent();
  const button = new FakeElement("button");
  button.innerHTML = api.iconCopy();
  button.title = "Copy translation";
  button.setAttribute("aria-label", "Copy translation");

  await api.copyText("translated", button);

  assert.deepEqual(context.navigator.clipboard.writes, ["translated"]);
  assert.equal(button.title, "Copied");
  assert.equal(button.classList.contains("stj-copy-ok"), true);
  assert.match(button.innerHTML, /m5 12 4 4L19 6/);
});

test("speech helpers select matching voices and speak trimmed text", async () => {
  const { api, context } = await loadContent();

  api.speakText("hello", "en-US");

  assert.equal(context.window.speechSynthesis.cancelled, 1);
  assert.equal(context.window.speechSynthesis.spoken.length, 1);
  assert.equal(context.window.speechSynthesis.spoken[0].lang, "en-US");
  assert.equal(context.window.speechSynthesis.spoken[0].voice.name, "English");
  assert.equal(api.normalizeSpeechLang("auto"), "en-US");
  assert.equal(api.normalizeSpeechLang("browser"), "en-US");
  assert.equal(api.normalizeSpeechLang("tl"), "fil-PH");
  assert.equal(api.normalizeSpeechLang("he"), "he-IL");
  assert.equal(api.normalizeSpeechLang("uk"), "uk-UA");
  assert.equal(api.normalizeSpeechLang("fa"), "fa-IR");
});

test("runtime message returns selected text and triggers selection translation", async () => {
  const { api, context } = await loadContent();
  api.STJ_STATE.lastSelectedText = "last selection";

  let response;
  assert.equal(api.handleRuntimeMessage({ type: "STJ_GET_SELECTED_TEXT" }, {}, value => { response = value; }), false);
  assert.equal(response, "last selection");

  const originalShowPanel = context.showPanel;
  let called = false;
  context.showPanel = () => {
    called = true;
  };
  assert.equal(api.handleRuntimeMessage({ type: "STJ_TRANSLATE_SELECTION" }, {}, value => { response = value; }), false);
  assert.deepEqual(plain(response), { ok: true });
  assert.equal(called, true);
  context.showPanel = originalShowPanel;
});
