# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Google Apps Script Web App for Kavak Supply Chile. Automates legal due-diligence on vehicle purchase documents (C2B) and company documents (B2B) using Claude Vision. Deployed as a single URL shared with the Supply team — no installation required.

## Project structure

| File | Role |
|------|------|
| `Codigo.gs` | Apps Script backend — HTTP router (`doGet`) + `include()` partial helper |
| `hub.html` | Main shell: sidebar nav + renders DocScan/B2BScan in `<iframe srcdoc>` |
| `DOCScan_v3_standalone.html` | DocScan standalone (can run outside hub) |
| `B2BScan_v1_standalone.html` | B2B Scan standalone |
| `_styles_hub.html`, `_header.html`, `_sidebar.html` | Shared partials included via `<?= include('name') ?>` |

## Deployment

There is no build step. Deploy manually:
1. Open [script.google.com](https://script.google.com) → paste each file into the corresponding Apps Script file
2. Deploy → New deployment → Web App → Execute as: Me → Access: Any user in Kavak
3. Each new code change requires a new deployment version

## Architecture

**Routing:** `doGet(e)` reads `?page=hub|docscan|b2bscan` and calls `buildPage(name)` which uses `HtmlService.createTemplateFromFile`. Partials are injected with `<?= include('_styles_hub') ?>`.

**Claude Vision calls:** Currently made **directly from the browser** via `fetch('https://api.anthropic.com/v1/messages', ...)`. The API key is embedded in client JS — this is a known security issue that must be fixed (see below).

**State:** History stored in `localStorage` (key `ds3_hist`). User name stored in `ds_user`. No server-side persistence yet.

**Multi-image flow:** Images are compressed client-side (max 1600px, JPEG 0.88) before sending. PDFs rendered via pdf.js (CDN). Multiple files sent as array; Claude returns JSON array.

**Municipality links:** `MUNIS` array in DocScan maps municipality names to official portal URLs for permit verification.

## Critical: API key security fix (must-do)

The Anthropic API key must **never** be in client JS. Fix:
1. Store the key in Apps Script project settings: *Project Settings → Script Properties → `ANTHROPIC_KEY`*
2. Add a server-side function in `Codigo.gs`:

```js
function callClaude(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return ContentService.createTextOutput(res.getContentText()).setMimeType(ContentService.MimeType.JSON);
}
```

3. In HTML, replace `fetch('https://api.anthropic.com/...')` with `google.script.run.withSuccessHandler(...).callClaude(payload)`
4. Remove `anthropic-dangerous-direct-browser-access` header — it will no longer be needed
5. **Rotate the exposed key immediately** at console.anthropic.com

## Planned features (next)

- **Autofact integration** — scrape informe by patente using GetAPI.cl or Boostr.cl
- **Inspections panel** — daily dashboard synced to BOT database without IMPORTRANGE
- **Google Sheets export** — already partially wired (sheetsPopup UI exists, needs the Apps Script receiver endpoint)

## Model in use

`claude-sonnet-4-6` via the Messages API. Prompt engineering is done inline in `analyze()`. When updating the model, change the `model:` field in the fetch body inside both standalone files and `hub.html`'s embedded srcdoc.

## Scaling to other Kavak markets

The app is currently hardcoded for Chile (Chilean RUT format, municipality list, SOAP/RT/Permiso de Circulación document types). To expand:
- Add country parameter to `doGet`
- Parameterize the PROMPT in `analyze()` with country-specific document types
- Add country-specific municipality/registry link tables
