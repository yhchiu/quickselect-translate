# QuickSelect Translate

![QuickSelect Translate brand mark](design/brand/final/quickselect-translate-brand-mark.svg)

This is a Chrome extension for quickly translating selected text.

[Available in the Chrome Web Store](https://chromewebstore.google.com/detail/quickselect-translate/dkgidkcamjobmmhdfmnkmadphjmcbnjk)

It keeps the core workflow small and plain:

- select text on a web page, then click the floating translate button;
- translate selected text from the context menu or keyboard shortcut;
- translate typed text from the popup;
- listen to source text or translated text with browser speech synthesis;
- open full-page translation through Google Translate;
- configure source/target language, selection behavior, popup/bubble font size, and auto/light/dark theme from the options page.
- optionally enable selected-text translation on supported local `file://` pages without requesting file access at installation time;
- localize extension UI through Chrome i18n messages for English, Traditional Chinese, and Simplified Chinese.

## Screenshots

### Translation Bubble

![Translation Bubble](screenshots/01-translation-bubble.png)

![Translation Bubble](screenshots/02-translation-bubble.png)

![Translation Bubble](screenshots/03-translation-bubble.png)

### Extension Popup Interface

![Extension Popup](screenshots/04-popup.png)

### Settings

![Settings](screenshots/05-settings.png)

## Install

### From Chrome Web Store (Recommended)

Install directly from the Chrome Web Store: [QuickSelect Translate](https://chromewebstore.google.com/detail/quickselect-translate/dkgidkcamjobmmhdfmnkmadphjmcbnjk)

1. Visit the Chrome Web Store link above
2. Click "Add to Chrome" button
3. Confirm the installation when prompted

### From Source

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

## Local file translation

Local file access is optional and disabled by default. Open the options page and find **Local File Translation**. If Chrome reports that file URL access is off, open the extension details page from the provided link and turn on **Allow access to file URLs** first. Return to the options page, click **Enable local file translation**, then reload or reopen the local file page.

The extension registers its `file:///*` content script only while the optional permissions are granted and Chrome file URL access is enabled. If the permission is revoked or file URL access is turned off, the local-file content script is unregistered automatically.

## Translation backend

The extension uses Google Translate's public web endpoint:

```text
https://translate.googleapis.com/translate_a/single?client=gtx
```

The endpoint is convenient for a lightweight extension, but it is not an official paid Google Cloud Translation API contract. For production or store distribution, consider adding a proper API-backed provider and clearer quota/error handling.

## Privacy

See [`PRIVACY.md`](PRIVACY.md).

## Pronunciation

Pronunciation uses the browser's Web Speech API (`speechSynthesis` and `SpeechSynthesisUtterance`) instead of Google Translate audio. Voice quality and available languages depend on the user's browser, OS, and installed voices.

## Tests

Tests use Node's built-in test runner and do not require `npm install`.

Run all tests from this folder:

```sh
node --test tests/*.test.js
```

The tests use mocked Chrome extension APIs, mocked DOM objects, and mocked network responses. They cover translation parsing and errors, request caching, context menu routing, Google Translate URL generation, translation bubble helpers, hover auto-hide behavior, appearance setting updates, copy success feedback, speech synthesis helpers, popup rendering, options form handling, optional local-file permission state, dynamic content-script registration, and i18n locale consistency.

## License

This project is licensed under the GNU General Public License v3 (GPL v3).

Copyright (C) Yu-Hsiung Chiu

## Contributing

Contributions are welcome! Please feel free to submit issues, feature requests, or pull requests.
