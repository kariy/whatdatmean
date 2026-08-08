"use strict";

(() => {
  const MAX_SELECTION_LENGTH = 200;
  const CONTEXT_WINDOW = 250; // chars kept on each side of the selection
  const SHOW_DELAY_MS = 150;

  const BLOCK_SELECTOR =
    "p, li, td, th, dd, blockquote, h1, h2, h3, h4, h5, h6, pre, article, section, div";

  // --- UI host (one per page, closed shadow root) -------------------------

  const host = document.createElement("div");
  host.style.cssText =
    "all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647;";
  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      #trigger {
        position: absolute;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 50%;
        background: #5b4cdb;
        color: #ffffff;
        font: 700 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        padding: 0;
      }
      #trigger:hover { background: #4a3dc4; }
      #popup {
        position: absolute;
        width: 360px;
        height: 200px;
        background: #ffffff;
        color: #1c1b22;
        border: 1px solid #d0d0d8;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        font: 400 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 10px 12px;
        display: none;
        flex-direction: column;
      }
      #popup .head {
        margin-bottom: 6px;
        flex-shrink: 0;
      }
      #popup .word {
        font-weight: 700;
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #popup .meta {
        display: flex;
        align-items: baseline;
        gap: 6px;
        margin-top: 1px;
      }
      #popup .pos {
        font-style: italic;
        font-size: 12px;
        color: #5b5b66;
        white-space: nowrap;
      }
      #popup .note {
        font-size: 11px;
        color: #5b4cdb;
        background: #efecff;
        border-radius: 9px;
        padding: 1px 7px;
        white-space: nowrap;
      }
      #popup .body {
        white-space: pre-wrap;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
      #popup .definition { margin-bottom: 7px; white-space: normal; }
      #popup .examples {
        margin: 0;
        padding-left: 16px;
        color: #52525b;
        white-space: normal;
      }
      #popup .examples li { margin-bottom: 3px; }
      .skeleton-line {
        height: 11px;
        border-radius: 4px;
        margin-bottom: 9px;
        background: linear-gradient(90deg, #ececf1 25%, #f7f7fa 47%, #ececf1 63%);
        background-size: 300% 100%;
        animation: wdm-shimmer 1.3s ease-in-out infinite;
      }
      .skeleton-gap { height: 10px; }
      @keyframes wdm-shimmer {
        0% { background-position: 100% 0; }
        100% { background-position: -100% 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .skeleton-line { animation: none; }
      }
      #popup .body.error { color: #c50042; }
      #popup .settings-link {
        display: inline-block;
        margin-top: 6px;
        color: #5b4cdb;
        cursor: pointer;
        text-decoration: underline;
        font-size: 12px;
      }
    </style>
    <button id="trigger" title="Define">?</button>
    <div id="popup"></div>
  `;

  const trigger = shadow.getElementById("trigger");
  const popup = shadow.getElementById("popup");

  function ensureHostAttached() {
    if (!host.isConnected) {
      document.documentElement.appendChild(host);
    }
  }

  // --- state --------------------------------------------------------------

  // Captured when the trigger is shown, because the page's next mousedown
  // may clear the selection before the click on the trigger lands.
  let captured = null; // { text, context, rect }
  let showTimer = null;
  let requestId = 0;

  function hideTrigger() {
    trigger.style.display = "none";
  }

  function hidePopup() {
    popup.style.display = "none";
    requestId++; // invalidate any in-flight lookup
  }

  function hideAll() {
    hideTrigger();
    hidePopup();
    captured = null;
  }

  // --- context extraction -------------------------------------------------

  function collapseWhitespace(s) {
    return s.replace(/\s+/g, " ").trim();
  }

  function extractContext(selection, text) {
    let node = selection.anchorNode;
    let element = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    let block = null;
    while (element) {
      if (element.matches && element.matches(BLOCK_SELECTOR)) {
        const t = collapseWhitespace(element.textContent || "");
        if (t.length > text.length + 20 || !block) {
          block = t;
          if (t.length > text.length + 20) break;
        }
      }
      element = element.parentElement;
    }

    let context = block || "";
    if (!context) {
      context = collapseWhitespace(document.title);
    }

    if (context.length > CONTEXT_WINDOW * 2 + text.length) {
      const idx = context.indexOf(text);
      let start, end;
      if (idx >= 0) {
        start = Math.max(0, idx - CONTEXT_WINDOW);
        end = Math.min(context.length, idx + text.length + CONTEXT_WINDOW);
      } else {
        start = 0;
        end = CONTEXT_WINDOW * 2;
      }
      // widen to word boundaries
      while (start > 0 && !/\s/.test(context[start - 1])) start--;
      while (end < context.length && !/\s/.test(context[end])) end++;
      context =
        (start > 0 ? "…" : "") + context.slice(start, end).trim() + (end < context.length ? "…" : "");
    }
    return context;
  }

  // --- positioning --------------------------------------------------------

  function placeTrigger(rect) {
    ensureHostAttached();
    trigger.style.display = "flex";
    let left = rect.right + window.scrollX + 4;
    let top = rect.bottom + window.scrollY + 4;
    left = Math.min(left, window.scrollX + document.documentElement.clientWidth - 32);
    trigger.style.left = left + "px";
    trigger.style.top = top + "px";
  }

  function placePopup(rect) {
    ensureHostAttached();
    popup.style.display = "flex";
    popup.style.visibility = "hidden";
    popup.style.left = "0px";
    popup.style.top = "0px";

    const popupRect = popup.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    let left = rect.left + window.scrollX;
    left = Math.max(
      window.scrollX + 8,
      Math.min(left, window.scrollX + viewportWidth - popupRect.width - 8)
    );

    let top = rect.bottom + window.scrollY + 8;
    if (rect.bottom + popupRect.height + 16 > viewportHeight && rect.top - popupRect.height - 16 > 0) {
      top = rect.top + window.scrollY - popupRect.height - 8;
    }

    popup.style.left = left + "px";
    popup.style.top = top + "px";
    popup.style.visibility = "visible";
  }

  // --- popup rendering ----------------------------------------------------

  function renderHead(word, partOfSpeech, note) {
    const head = document.createElement("div");
    head.className = "head";

    const wordEl = document.createElement("div");
    wordEl.className = "word";
    wordEl.textContent = word;
    head.appendChild(wordEl);

    if (partOfSpeech || note) {
      const meta = document.createElement("div");
      meta.className = "meta";
      if (partOfSpeech) {
        const posEl = document.createElement("span");
        posEl.className = "pos";
        posEl.textContent = partOfSpeech;
        meta.appendChild(posEl);
      }
      if (note) {
        const noteEl = document.createElement("span");
        noteEl.className = "note";
        noteEl.textContent = note;
        meta.appendChild(noteEl);
      }
      head.appendChild(meta);
    }
    popup.appendChild(head);
  }

  function renderSkeleton(word) {
    popup.textContent = "";
    renderHead(word, "", "");

    const bodyEl = document.createElement("div");
    bodyEl.className = "body";
    // Definition lines, a gap, then two shorter "example bullet" lines.
    for (const width of ["100%", "94%", "68%", null, "84%", "76%"]) {
      const line = document.createElement("div");
      if (width === null) {
        line.className = "skeleton-gap";
      } else {
        line.className = "skeleton-line";
        line.style.width = width;
      }
      bodyEl.appendChild(line);
    }
    popup.appendChild(bodyEl);
  }

  // Appends `sentence` to `parent`, wrapping occurrences of `word` in <em>.
  // Matches case-insensitively and extends over trailing word characters so
  // inflections ("extricated" for "extricate") are italicized whole.
  function appendWithWordItalicized(parent, sentence, word) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped + "\\w*", "gi");
    let last = 0;
    let match;
    while ((match = re.exec(sentence)) !== null) {
      if (match.index > last) {
        parent.appendChild(document.createTextNode(sentence.slice(last, match.index)));
      }
      const em = document.createElement("em");
      em.textContent = match[0];
      parent.appendChild(em);
      last = match.index + match[0].length;
    }
    if (last < sentence.length) {
      parent.appendChild(document.createTextNode(sentence.slice(last)));
    }
  }

  function renderEntry(word, entry) {
    popup.textContent = "";
    renderHead(word, entry.partOfSpeech, entry.note);

    const bodyEl = document.createElement("div");
    bodyEl.className = "body";

    const defEl = document.createElement("div");
    defEl.className = "definition";
    defEl.textContent = entry.definition;
    bodyEl.appendChild(defEl);

    if (entry.examples.length) {
      const list = document.createElement("ul");
      list.className = "examples";
      for (const example of entry.examples) {
        const item = document.createElement("li");
        appendWithWordItalicized(item, example, word);
        list.appendChild(item);
      }
      bodyEl.appendChild(list);
    }
    popup.appendChild(bodyEl);
  }

  function renderError(word, message, needsKey) {
    popup.textContent = "";
    renderHead(word, "", "");

    const bodyEl = document.createElement("div");
    bodyEl.className = "body error";
    bodyEl.textContent = message;
    popup.appendChild(bodyEl);

    if (needsKey) {
      const link = document.createElement("span");
      link.className = "settings-link";
      link.textContent = "Open settings";
      link.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        browser.runtime.sendMessage({ type: "openOptions" });
      });
      popup.appendChild(link);
    }
  }

  // --- lookup -------------------------------------------------------------

  async function lookup() {
    if (!captured) return;
    const { text, context, rect } = captured;
    hideTrigger();

    const myRequest = ++requestId;
    renderSkeleton(text);
    placePopup(rect);

    let result;
    try {
      result = await browser.runtime.sendMessage({
        type: "define",
        text,
        context,
        pageUrl: location.href,
      });
    } catch (e) {
      result = { ok: false, error: "Extension error — try reloading the page." };
    }

    if (myRequest !== requestId) return; // dismissed or superseded

    if (result && result.ok) {
      renderEntry(text, result.entry);
    } else {
      renderError(text, (result && result.error) || "Unknown error.", !!(result && result.needsKey));
    }
    placePopup(rect);
  }

  // --- selection handling -------------------------------------------------

  function onSelectionSettled() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const text = collapseWhitespace(selection.toString());
    if (!text || text.length > MAX_SELECTION_LENGTH) return;

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    hidePopup();
    captured = {
      text,
      context: extractContext(selection, text),
      rect: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      },
    };
    placeTrigger(rect);
  }

  function scheduleSelectionCheck(event) {
    // Ignore interactions with our own UI.
    if (event.composedPath && event.composedPath().includes(host)) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(onSelectionSettled, SHOW_DELAY_MS);
  }

  document.addEventListener("mouseup", scheduleSelectionCheck, true);
  document.addEventListener("keyup", (event) => {
    if (event.key && event.key.startsWith("Arrow") && event.shiftKey) {
      scheduleSelectionCheck(event);
    }
  }, true);

  // mousedown (not click): fire before the page clears the selection.
  trigger.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    lookup();
  });

  document.addEventListener(
    "mousedown",
    (event) => {
      if (event.composedPath && event.composedPath().includes(host)) return;
      hideAll();
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") hideAll();
    },
    true
  );

  // The popup is absolutely positioned so it scrolls with the document;
  // only the trigger (whose selection anchor gets stale) is dismissed.
  window.addEventListener(
    "scroll",
    () => {
      hideTrigger();
    },
    { passive: true }
  );
})();
