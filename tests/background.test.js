"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createBaseContext,
  createChromeMock,
  loadScript,
  plain
} = require("./test-utils");

function loadBackground({ storage, fetchImpl, uiLanguage } = {}) {
  const { chrome, calls, storageData } = createChromeMock({ storage });
  if (uiLanguage !== undefined) chrome.i18n = { getUILanguage: () => uiLanguage };
  const context = createBaseContext({
    chrome,
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({}) }))
  });
  loadScript("background.js", context);
  return { api: context.__QST_BACKGROUND_TESTS__, chrome, calls, storageData, context };
}

test("ensureDefaultSettings writes only missing defaults", async () => {
  const { api, calls, storageData } = loadBackground({ storage: { targetLang: "ja" } });

  await api.ensureDefaultSettings();

  assert.equal(storageData.targetLang, "ja");
  assert.equal(api.DEFAULT_SETTINGS.targetLang, "browser");
  assert.equal(storageData.sourceLang, "auto");
  assert.equal(storageData.themeMode, "auto");
  assert.equal(storageData.fontSize, 16);
  assert.equal(calls.storageSet.length, 1);
  assert.ok(!("targetLang" in calls.storageSet[0]));
});

test("ensureDefaultSettings uses browser target language for new installs", async () => {
  const { api, calls, storageData } = loadBackground();

  await api.ensureDefaultSettings();

  assert.equal(storageData.targetLang, "browser");
  assert.equal(calls.storageSet.length, 1);
});

test("createContextMenus creates selection, page, and link menus", () => {
  const { api, calls } = loadBackground();

  api.createContextMenus();

  assert.equal(calls.contextMenusRemoveAll, 1);
  assert.deepEqual(
    calls.contextMenusCreate.map(item => item.id),
    ["stj-translate-selection", "stj-translate-page", "stj-translate-link"]
  );
});

test("translateWithGoogle parses sentence text and dictionary groups", async () => {
  let requestedUrl = "";
  const { api } = loadBackground({
    fetchImpl: async url => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          src: "en",
          sentences: [{ trans: "你好" }, { trans: "世界" }],
          dict: [
            { pos: "noun", terms: ["世界", "地球"] },
            { pos: "verb", terms: ["問候"] }
          ],
          ld_result: { srclangs_confidences: [0.98] }
        })
      };
    }
  });

  const result = await api.translateWithGoogle("hello world", "auto", "zh-TW");
  const url = new URL(requestedUrl);

  assert.equal(url.origin, "https://translate.googleapis.com");
  assert.equal(url.searchParams.get("client"), "gtx");
  assert.equal(url.searchParams.get("q"), "hello world");
  assert.equal(result.ok, true);
  assert.equal(result.resultText, "你好世界");
  assert.equal(result.candidateText, "noun: 世界, 地球\nverb: 問候");
  assert.deepEqual(plain(result.candidateGroups), [
    { pos: "noun", terms: ["世界", "地球"] },
    { pos: "verb", terms: ["問候"] }
  ]);
  assert.equal(result.sourceLanguage, "en");
  assert.equal(result.confidence, 0.98);
});

test("handleTranslate normalizes text and caches successful results", async () => {
  let fetchCount = 0;
  const { api } = loadBackground({
    storage: { maxTextLength: 8 },
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ src: "en", sentences: [{ trans: "cached" }] })
      };
    }
  });

  const first = await api.handleTranslate({ type: "STJ_TRANSLATE", text: "  hello   world  ", targetLang: "zh-TW" });
  const second = await api.handleTranslate({ type: "STJ_TRANSLATE", text: "hello world", targetLang: "zh-TW" });

  assert.equal(first.resultText, "cached");
  assert.equal(second.resultText, "cached");
  assert.equal(fetchCount, 1);
});

test("browser target language resolves before translate requests and cache keys", async () => {
  let requestedUrl = "";
  const { api } = loadBackground({
    uiLanguage: "en-US",
    fetchImpl: async url => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ src: "ja", sentences: [{ trans: "hello" }] })
      };
    }
  });

  const first = await api.handleTranslate({ type: "STJ_TRANSLATE", text: "こんにちは", targetLang: "browser" });
  const second = await api.handleTranslate({ type: "STJ_TRANSLATE", text: "こんにちは", targetLang: "en" });
  const url = new URL(requestedUrl);

  assert.equal(first.resultText, "hello");
  assert.equal(second.resultText, "hello");
  assert.equal(url.searchParams.get("tl"), "en");
  assert.equal(api.memoryCache.size, 1);
});

test("browser target language maps Chinese variants and unsupported languages", () => {
  const { api } = loadBackground();

  assert.equal(api.resolveBrowserTargetLang("zh-HK"), "zh-TW");
  assert.equal(api.resolveBrowserTargetLang("zh-Hans-CN"), "zh-CN");
  assert.equal(api.resolveBrowserTargetLang("fil-PH"), "tl");
  assert.equal(api.resolveBrowserTargetLang("he-IL"), "he");
  assert.equal(api.resolveBrowserTargetLang("iw-IL"), "he");
  assert.equal(api.resolveBrowserTargetLang("pl-PL"), "pl");
  assert.equal(api.resolveBrowserTargetLang("uk-UA"), "uk");
  assert.equal(api.resolveBrowserTargetLang("ar-SA"), "ar");
  assert.equal(api.resolveBrowserTargetLang("nl-NL"), "nl");
  assert.equal(api.resolveBrowserTargetLang("fi-FI"), "zh-TW");
  assert.equal(api.resolveTargetLang("auto"), "zh-TW");
});

test("translateWithGoogle returns useful errors for network, HTTP, and JSON failures", async () => {
  const network = loadBackground({ fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal((await network.api.translateWithGoogle("x", "auto", "en")).errorMessage, "Network error. Please check your connection.");

  const rateLimited = loadBackground({ fetchImpl: async () => ({ ok: false, status: 429, statusText: "Too Many Requests" }) });
  assert.equal((await rateLimited.api.translateWithGoogle("x", "auto", "en")).errorMessage, "Google Translate is temporarily unavailable or rate limited.");

  const badJson = loadBackground({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } })
  });
  assert.equal((await badJson.api.translateWithGoogle("x", "auto", "en")).errorMessage, "Translate response could not be parsed.");
});

test("page and text translation open the expected Google URLs", async () => {
  const { api, calls } = loadBackground({ storage: { targetLang: "ja" } });

  await api.openPageTranslation("https://example.com/path?q=1", { id: 5, index: 2 });
  api.openTextTranslation("hello", "en", "zh-TW");

  assert.equal(calls.tabsCreate.length, 2);
  assert.match(calls.tabsCreate[0].url, /^https:\/\/translate\.google\.com\/translate\?/);
  assert.equal(new URL(calls.tabsCreate[0].url).searchParams.get("u"), "https://example.com/path?q=1");
  assert.equal(new URL(calls.tabsCreate[1].url).searchParams.get("text"), "hello");
});

test("page and text translation resolve browser target language in Google URLs", async () => {
  const { api, calls } = loadBackground({ storage: { targetLang: "browser" }, uiLanguage: "zh-HK" });

  await api.openPageTranslation("https://example.com/path", { id: 5, index: 2 });
  api.openTextTranslation("hello", "en", "browser");

  assert.equal(new URL(calls.tabsCreate[0].url).searchParams.get("tl"), "zh-TW");
  assert.equal(new URL(calls.tabsCreate[0].url).searchParams.get("hl"), "zh-TW");
  assert.equal(new URL(calls.tabsCreate[1].url).searchParams.get("tl"), "zh-TW");
});

test("runtime message listener handles options and async translate messages", async () => {
  const { calls, context } = loadBackground({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ src: "en", sentences: [{ trans: "ok" }] })
    })
  });
  const listener = calls.listeners.runtimeMessages[0];

  let response;
  assert.equal(listener({ type: "STJ_OPEN_OPTIONS" }, {}, value => { response = value; }), false);
  assert.deepEqual(plain(response), { ok: true });
  assert.equal(calls.optionsOpened, 1);

  assert.equal(listener({ type: "STJ_TRANSLATE", text: "hello" }, {}, value => { response = value; }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(response.resultText, "ok");
  assert.ok(context.__QST_BACKGROUND_TESTS__);
});
