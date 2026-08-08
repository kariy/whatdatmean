"use strict";

const apiKeyInput = document.getElementById("apiKey");
const modelSelect = document.getElementById("model");
const languageInput = document.getElementById("language");
const statusEl = document.getElementById("status");

function setStatus(message, ok) {
  statusEl.textContent = message;
  statusEl.className = ok ? "ok" : "err";
}

async function load() {
  const { apiKey = "", model = "gemini-flash-lite-latest", language = "" } =
    await browser.storage.local.get(["apiKey", "model", "language"]);
  apiKeyInput.value = apiKey;
  modelSelect.value = model;
  languageInput.value = language;
}

document.getElementById("save").addEventListener("click", async () => {
  await browser.storage.local.set({
    apiKey: apiKeyInput.value.trim(),
    model: modelSelect.value,
    language: languageInput.value.trim(),
  });
  setStatus("Saved.", true);
});

document.getElementById("test").addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus("Enter a key first.", false);
    return;
  }
  setStatus("Testing…", true);
  const result = await browser.runtime.sendMessage({ type: "testKey", apiKey: key });
  if (result.ok) {
    setStatus("✓ Key works.", true);
  } else {
    setStatus("✗ " + result.error, false);
  }
});

document.getElementById("toggleKey").addEventListener("click", (event) => {
  const hidden = apiKeyInput.type === "password";
  apiKeyInput.type = hidden ? "text" : "password";
  event.target.textContent = hidden ? "Hide" : "Show";
});

load();
