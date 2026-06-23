# QuickSelect Translate

![QuickSelect Translate brand mark](design/brand/final/quickselect-translate-brand-mark.svg)

This is a Chrome extension for quickly translating selected text.

It keeps the core workflow small and plain:

- select text on a web page, then click the floating translate button;
- translate selected text from the context menu or keyboard shortcut;
- translate typed text from the popup;
- listen to source text or translated text with browser speech synthesis;
- open full-page translation through Google Translate;
- configure source/target language, selection behavior, popup/bubble font size, and auto/light/dark theme from the options page.
- localize extension UI through Chrome i18n messages for English, Traditional Chinese, and Simplified Chinese.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select this extension folder.

No `npm install` or build step is required.

## Translation backend

The extension uses Google Translate's public web endpoint:

```text
https://translate.googleapis.com/translate_a/single?client=gtx
```

The endpoint is convenient for a lightweight extension, but it is not an official paid Google Cloud Translation API contract. For production or store distribution, consider adding a proper API-backed provider and clearer quota/error handling.

## Privacy

QuickSelect Translate does not collect analytics, telemetry, or translation history, and it does not send data to any project-owned server.

Text is sent to the configured third-party translation service, currently Google Translate, only when a translation is requested from the popup, floating selection UI, context menu, keyboard shortcut, or the optional immediate-translation setting. Full-page translation opens the configured page translation provider, currently Google Translate, with the current page or link URL. The "Open in Google Translate" action opens Google Translate with the selected text in the URL.

Settings such as source language, target language, selection behavior, theme, font size, and maximum text length are stored locally with `chrome.storage.local`. Translation results may be cached in extension memory during the current browser session to avoid repeated requests, but they are not persisted by this extension.

Pronunciation uses the browser's Web Speech API instead of a separate Google audio endpoint.

## Pronunciation

Pronunciation uses the browser's Web Speech API (`speechSynthesis` and `SpeechSynthesisUtterance`) instead of Google Translate audio. Voice quality and available languages depend on the user's browser, OS, and installed voices.

## Tests

Tests use Node's built-in test runner and do not require `npm install`.

Run all tests from this folder:

```sh
node --test tests/*.test.js
```

The tests use mocked Chrome extension APIs, mocked DOM objects, and mocked network responses. They cover translation parsing and errors, request caching, context menu routing, Google Translate URL generation, translation bubble helpers, hover auto-hide behavior, appearance setting updates, copy success feedback, speech synthesis helpers, popup rendering, options form handling, and i18n locale consistency.

## License

This project is licensed under the GNU General Public License v3 (GPL v3).

Copyright (C) Yu-Hsiung Chiu

## Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.
