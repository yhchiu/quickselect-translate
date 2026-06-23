"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
    this.sync();
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
    this.sync();
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    if (force === true || (force === undefined && !this.values.has(name))) {
      this.values.add(name);
      this.sync();
      return true;
    }
    if (force === false || force === undefined) {
      this.values.delete(name);
      this.sync();
      return false;
    }
    return this.values.has(name);
  }

  sync() {
    this.element.className = Array.from(this.values).join(" ");
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    const styleValues = {};
    this.style = {
      setProperty(name, value) {
        styleValues[name] = String(value);
      },
      getPropertyValue(name) {
        return styleValues[name] || "";
      },
      removeProperty(name) {
        delete styleValues[name];
      }
    };
    this.attributes = {};
    this.eventListeners = {};
    this.className = "";
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.title = "";
    this.type = "";
    this.isConnected = true;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this._textContent = "";
    this._innerHTML = "";
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild(node) {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  remove() {
    this.isConnected = false;
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }

  addEventListener(type, listener) {
    this.eventListeners[type] ||= [];
    this.eventListeners[type].push(listener);
  }

  dispatchEvent(event) {
    for (const listener of this.eventListeners[event.type] || []) listener(event);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  closest(selector) {
    if (selector === "#stj-root") {
      let node = this;
      while (node) {
        if (node.id === "stj-root") return node;
        node = node.parentElement;
      }
    }
    if (selector === "[data-action]") {
      let node = this;
      while (node) {
        if (node.dataset && node.dataset.action) return node;
        node = node.parentElement;
      }
    }
    return null;
  }

  querySelector() {
    return null;
  }

  matches() {
    return false;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(child => child.textContent).join("");
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

function createChromeMock({ storage = {}, runtimeMessageHandler } = {}) {
  const calls = {
    contextMenusCreate: [],
    contextMenusRemoveAll: 0,
    tabsCreate: [],
    tabsUpdate: [],
    tabsSendMessage: [],
    optionsOpened: 0,
    storageSet: [],
    listeners: {
      onInstalled: [],
      onStartup: [],
      contextMenusClicked: [],
      commands: [],
      runtimeMessages: [],
      storageChanged: []
    }
  };

  const storageData = { ...storage };
  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: { addListener: fn => calls.listeners.onInstalled.push(fn) },
      onStartup: { addListener: fn => calls.listeners.onStartup.push(fn) },
      onMessage: { addListener: fn => calls.listeners.runtimeMessages.push(fn) },
      openOptionsPage: () => {
        calls.optionsOpened += 1;
      },
      sendMessage: message => {
        if (runtimeMessageHandler) return Promise.resolve(runtimeMessageHandler(message));
        return Promise.resolve({});
      }
    },
    storage: {
      onChanged: { addListener: fn => calls.listeners.storageChanged.push(fn) },
      local: {
        get: async defaultsOrKeys => {
          if (Array.isArray(defaultsOrKeys)) {
            const result = {};
            for (const key of defaultsOrKeys) {
              if (Object.prototype.hasOwnProperty.call(storageData, key)) result[key] = storageData[key];
            }
            return result;
          }
          return { ...defaultsOrKeys, ...storageData };
        },
        set: async values => {
          Object.assign(storageData, values);
          calls.storageSet.push(values);
        }
      }
    },
    contextMenus: {
      onClicked: { addListener: fn => calls.listeners.contextMenusClicked.push(fn) },
      removeAll: callback => {
        calls.contextMenusRemoveAll += 1;
        if (callback) callback();
      },
      create: item => calls.contextMenusCreate.push(item)
    },
    commands: {
      onCommand: { addListener: fn => calls.listeners.commands.push(fn) }
    },
    tabs: {
      query: async () => [{ id: 11, index: 3, url: "https://example.com/page" }],
      sendMessage: async (tabId, message) => calls.tabsSendMessage.push({ tabId, message }),
      create: item => calls.tabsCreate.push(item),
      update: (tabId, item) => calls.tabsUpdate.push({ tabId, item })
    }
  };

  return { chrome, calls, storageData };
}

function createDom(ids = []) {
  const elements = new Map();
  const documentElement = new FakeElement("html");
  documentElement.lang = "en-US";
  const body = new FakeElement("body");
  documentElement.appendChild(body);

  for (const id of ids) {
    const element = new FakeElement("div");
    element.id = id;
    elements.set(`#${id}`, element);
  }

  const listeners = {};
  const document = {
    documentElement,
    body,
    activeElement: new FakeElement("div"),
    addEventListener(type, listener) {
      listeners[type] ||= [];
      listeners[type].push(listener);
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      return elements.get(selector) || null;
    },
    querySelectorAll(selector) {
      if (selector === "#stj-root") {
        const roots = [];
        const walk = node => {
          if (node.id === "stj-root") roots.push(node);
          for (const child of node.children) walk(child);
        };
        walk(documentElement);
        return roots;
      }
      return [];
    },
    getElementById(id) {
      return elements.get(`#${id}`) || null;
    },
    __listeners: listeners,
    __elements: elements
  };

  return { document, elements, documentElement, body };
}

function createBaseContext(extra = {}) {
  const timers = {
    set: [],
    cleared: []
  };
  const context = {
    console,
    URL,
    Headers,
    URLSearchParams,
    Promise,
    __QST_TEST__: true,
    navigator: {
      language: "en-US",
      clipboard: {
        writes: [],
        writeText(text) {
          this.writes.push(text);
          return Promise.resolve();
        }
      }
    },
    setTimeout(fn, delay) {
      const id = timers.set.length + 1;
      timers.set.push({ id, fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.cleared.push(id);
    },
    Option: function Option(label, value) {
      this.textContent = label;
      this.value = value;
    },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) {
      this.text = text;
      this.lang = "";
      this.rate = 1;
      this.voice = null;
    },
    __timers: timers
  };
  context.window = {
    innerWidth: 800,
    innerHeight: 600,
    setTimeout: context.setTimeout,
    clearTimeout: context.clearTimeout,
    getSelection: () => ({ toString: () => "", rangeCount: 0, isCollapsed: true }),
    speechSynthesis: {
      cancelled: 0,
      spoken: [],
      voices: [
        { lang: "en-US", name: "English" },
        { lang: "zh-TW", name: "Chinese Taiwan" }
      ],
      getVoices() {
        return this.voices;
      },
      cancel() {
        this.cancelled += 1;
      },
      speak(utterance) {
        this.spoken.push(utterance);
      }
    },
    SpeechSynthesisUtterance: context.SpeechSynthesisUtterance
  };
  return Object.assign(context, extra);
}

function loadScript(relativePath, context) {
  const filename = path.join(ROOT, relativePath);
  const code = fs.readFileSync(filename, "utf8");
  vm.runInNewContext(code, context, { filename });
  return context;
}

async function flushAsync() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  ROOT,
  FakeElement,
  createChromeMock,
  createDom,
  createBaseContext,
  loadScript,
  flushAsync,
  plain
};
