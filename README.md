# whatdatmean

Firefox extension: highlight any text on any webpage, click the little **?** button that appears, and get a context-aware definition from the Gemini API. Because the surrounding sentence is sent along with the highlighted text, "bank" in a finance article and "bank" next to a river get different definitions — and slang, idioms, phrases, and non-English words work too.

## Setup

1. Copy `config.example.js` to `config.js` (required — the manifest loads it). Optionally paste your Gemini API key into it as the default key; get a free key at <https://aistudio.google.com/apikey>. `config.js` is gitignored so the key stays out of version control.
2. Load the extension (see below). A key saved in the settings page (about:addons → whatdatmean → Preferences) overrides the `config.js` default; use **Test key** there to verify.

## Installing / running

### Temporary load (quick)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json` from this folder.

### Dev loop (auto-reload)

```sh
npx web-ext run --source-dir .
```

Launches a clean Firefox profile with the extension installed; reloads on file changes. `npx web-ext lint` checks the manifest and API usage.

## ⚠️ The #1 gotcha: grant site access

Firefox Manifest V3 makes site access **opt-in**. After installing, the content script silently does nothing until you grant it:

- Open `about:addons` → **whatdatmean** → **Permissions** tab → enable **"Access your data for all websites"**.

If highlighting does nothing, this is almost certainly why.

## Other things to know

- Content scripts never run on `about:*` pages, addons.mozilla.org, the built-in PDF viewer, or reader mode — the extension can't work there.
- Definitions are cached in memory (per browser session) so repeat lookups are instant and free.
- Your API key is stored in `browser.storage.local` on this computer only; it is sent only to `generativelanguage.googleapis.com`.
- Dismiss the popup by clicking anywhere else or pressing Escape.
- Model and answer language are configurable in settings (defaults: `gemini-flash-lite-latest` — an alias that tracks Google's newest flash-lite model, so it keeps working when Google retires specific versions — answering in English / the page's language).
- A permanent install of a built zip (`npx web-ext build`) requires AMO unlisted signing, or Firefox Developer Edition with `xpinstall.signatures.required=false`. Temporary load is fine for daily use during development.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest (event-page background, Firefox-style) |
| `content.js` | Selection detection, trigger button, and definition popup (closed Shadow DOM) |
| `background.js` | Gemini API calls, error mapping, in-memory cache |
| `options.html` / `options.js` | Settings page: API key, model, answer language |
| `config.js` (gitignored) | Default API key; copy from `config.example.js` |
