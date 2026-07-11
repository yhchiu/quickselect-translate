# Privacy

QuickSelect Translate does not collect analytics, telemetry, or translation history, and it does not send data to any project-owned server.

Text is sent to the configured third-party translation service, currently Google Translate, only when a translation is requested from the popup, floating selection UI, context menu, keyboard shortcut, or the optional immediate-translation setting. Full-page translation opens the configured page translation provider, currently Google Translate, with the current page or link URL. The "Open in Google Translate" action opens Google Translate with the selected text in the URL.

Settings such as source language, target language, selection behavior, theme, font size, and maximum text length are stored locally with chrome.storage.local. Translation results may be cached in extension memory during the current browser session to avoid repeated requests, but they are not persisted by this extension.

Pronunciation uses the browser's Web Speech API instead of a separate Google audio endpoint.

