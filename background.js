"use strict";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const CACHE_MAX = 100;

const DEFAULT_API_KEY =
  typeof WDM_DEFAULT_API_KEY !== "undefined" ? WDM_DEFAULT_API_KEY : "";

// Best-effort cache; cleared whenever the event page unloads.
const cache = new Map();

function cacheKey(text, context) {
  return text.toLowerCase() + "\u0000" + context;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["word", "phrase", "sentence"] },
    partOfSpeech: { type: "STRING" },
    definition: { type: "STRING" },
    examples: { type: "ARRAY", items: { type: "STRING" } },
    note: { type: "STRING" },
  },
  required: ["kind", "definition"],
  propertyOrdering: ["kind", "partOfSpeech", "definition", "examples", "note"],
};

function buildPrompt(text, context, language) {
  const languageLine = language
    ? `Write the definition and note in ${language}.`
    : "";
  return [
    "Explain the highlighted text as it is used in the given context.",
    "",
    'First classify it (kind field): "word" for a single word, "phrase" for a',
    'short expression, idiom, or fragment that is not a complete sentence, or',
    '"sentence" for one or more complete sentences or a complete clause.',
    "",
    'For kind "word" or "phrase", fill:',
    "- partOfSpeech: its part of speech as used in this context (noun, verb,",
    "  adjective, adverb, pronoun, preposition, conjunction, interjection), or",
    '  "phrase", "idiom", or "abbreviation" when that fits better.',
    "- definition: 1-2 concise sentences, specific to how it is used in this",
    "  context. Do not repeat the context back.",
    "- examples: at least two short example sentences using the highlighted text.",
    "",
    'For kind "sentence", fill:',
    "- definition: a plain-language explanation of what the sentence means in",
    "  this context, 1-3 concise sentences. Do not repeat the sentence back.",
    "- partOfSpeech: empty string. examples: empty array.",
    "",
    'Always fill note: a short label only when one applies — e.g. "slang",',
    '"informal", "jargon", "archaic", "sarcastic", or the language name if the',
    'text is not English (e.g. "French") — otherwise an empty string.',
    languageLine,
    "",
    `Highlighted text: "${text}"`,
    `Context: "${context}"`,
  ].join("\n");
}

function httpError(status) {
  if (status === 400 || status === 401 || status === 403) {
    return "API key appears invalid. Check it in the extension settings.";
  }
  if (status === 429) {
    return "Rate limited by Gemini — wait a moment and retry.";
  }
  if (status >= 500) {
    return "Gemini service error, try again.";
  }
  return `Gemini returned an unexpected error (HTTP ${status}).`;
}

async function define({ text, context }) {
  const { apiKey: storedKey, model = DEFAULT_MODEL, language = "" } =
    await browser.storage.local.get(["apiKey", "model", "language"]);
  const apiKey = storedKey || DEFAULT_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      needsKey: true,
      error: "No API key set. Open the extension settings to add your Gemini key.",
    };
  }

  const key = cacheKey(text, context);
  if (cache.has(key)) {
    return { ok: true, entry: cache.get(key) };
  }

  let response;
  try {
    response = await fetch(`${API_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(text, context, language) }] }],
        generationConfig: {
          maxOutputTokens: 400,
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch (e) {
    return { ok: false, error: "Network error — are you online?" };
  }

  if (!response.ok) {
    return { ok: false, error: httpError(response.status) };
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    return { ok: false, error: "Gemini returned an unreadable response." };
  }

  if (data.promptFeedback && data.promptFeedback.blockReason) {
    return { ok: false, error: "Gemini declined to define this text." };
  }

  const raw = data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts.map((p) => p.text || "").join("").trim();

  if (!raw) {
    return { ok: false, error: "Gemini returned an empty response, try again." };
  }

  let entry;
  try {
    entry = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: "Gemini returned a malformed response, try again." };
  }
  if (!entry.definition) {
    return { ok: false, error: "Gemini returned an empty definition, try again." };
  }
  const isSentence = entry.kind === "sentence";
  entry = {
    kind: isSentence ? "sentence" : entry.kind === "phrase" ? "phrase" : "word",
    partOfSpeech: isSentence ? "" : entry.partOfSpeech || "",
    definition: entry.definition,
    examples: isSentence || !Array.isArray(entry.examples) ? [] : entry.examples,
    note: entry.note || "",
  };

  if (cache.size >= CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, entry);
  return { ok: true, entry };
}

async function testKey({ apiKey }) {
  let response;
  try {
    response = await fetch(`${API_BASE}/models`, {
      headers: { "x-goog-api-key": apiKey },
    });
  } catch (e) {
    return { ok: false, error: "Network error — are you online?" };
  }
  if (!response.ok) {
    return { ok: false, error: httpError(response.status) };
  }
  return { ok: true };
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === "define") {
    return define(message);
  }
  if (message.type === "testKey") {
    return testKey(message);
  }
  if (message.type === "openOptions") {
    return browser.runtime.openOptionsPage();
  }
  return undefined;
});
