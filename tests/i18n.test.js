"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { ROOT } = require("./test-utils");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

test("i18n locale files exist and expose the same message keys", () => {
  const manifest = readJson("manifest.json");
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.description, "__MSG_extensionDescription__");

  const locales = ["en", "zh_TW", "zh_CN"];
  const messages = Object.fromEntries(
    locales.map(locale => [locale, readJson(`_locales/${locale}/messages.json`)])
  );
  const expectedKeys = Object.keys(messages.en).sort();

  for (const locale of locales) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), expectedKeys, `${locale} message keys should match en`);
    for (const [key, value] of Object.entries(messages[locale])) {
      assert.equal(typeof value.message, "string", `${locale}.${key} should define a message`);
      assert.notEqual(value.message.trim(), "", `${locale}.${key} should not be empty`);
    }
  }
});
