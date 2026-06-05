# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Google Apps Script Web App for Kavak Supply Chile. Automates legal due-diligence on vehicle purchase documents (C2B) and company documents (B2B) using Claude Vision, plus a no-AI RUT/patente validator. Deployed as a single URL shared with the Supply team — no installation required.

## Project structure

| File (repo) | Apps Script file name | Role |
|------|------|------|
| `Codigo.gs` | `Codigo` | Backend — router (`doGet`), `include()`, and `callClaude()` server proxy |
| `hub.html` | `hub` | Shell: sidebar nav; loads tools via lazy `<iframe src="…?page=…">` |
| `docscan.html` | `docscan` | DocScan (C2B), served by `?page=docscan` |
| `b2bscan.html` | `b2bscan` | B2B Scan, served by `?page=b2bscan` |
| `validador.html` | `validador` | RUT/patente validator (client-only), served by `?page=validador` |
| `_styles_hub.html`, `_header.html`, `_sidebar.html` | same | Shared partials via `<?= include('name') ?>` |

**Critical naming rule:** the Apps Script HTML file name must match the route exactly (`docscan`, not `DOCScan_v3_standalone`). `buildPage` does `createTemplateFromFile(name)` where `name` is the `?page=` value.

## Deployment

No build step. Deploy manually:
1. Paste each file into the matching Apps Script file (names per table above).
2. **Set the API key:** Project Settings → Script Properties → `ANTHROPIC_KEY` = `sk-ant-...`. The key lives only server-side.
3. Deploy → New deployment → Web App → Execute as: Me → Access: Any user in Kavak.
4. Each code change requires a new deployment version.

## Architecture

**Routing:** `doGet(e)` reads `?page=hub|docscan|b2bscan|validador` → `buildPage(name)` (`HtmlService.createTemplateFromFile`). Template vars `BASE_URL`, `VERSION`, `ACTIVE_PAGE` are exposed; the hub uses `<?= BASE_URL ?>` to build iframe URLs.

**No more duplication:** the hub does NOT embed the tools. It renders each tool in a lazy iframe pointing at `BASE_URL?page=<tool>` (src is set on first open). Each tool has a single source of truth in its own file. Do NOT reintroduce embedded `srcdoc` copies.

**Claude calls (server-side):** the client calls `google.script.run.callClaude(payload)` (wrapped in a Promise as `callClaudeServer` in both `docscan.html` and `b2bscan.html`). `callClaude` in `Codigo.gs` reads `ANTHROPIC_KEY` and calls `UrlFetchApp.fetch`, returning `{status, body}` as a JSON string so the client keeps its retry/overload logic. The API key never reaches the browser.

**State:** History in `localStorage` (`ds3_hist` for DocScan, `b2b_hist` for B2B). User name in `ds_user`. No server-side persistence.

**Multi-image flow:** images compressed client-side (max 1600px, JPEG 0.88); PDFs via pdf.js (CDN). Multiple files sent as an array; Claude returns a JSON array.

**Municipality links:** `MUNIS` array in DocScan maps municipality names to official portal URLs.

**Cross-document dictamen:** `buildConsolidado(docs)` in `docscan.html` runs when 2+ docs are analyzed together — cross-checks RUT/patente consistency, validates check digits and expirations, and renders a copyable verdict.

## Validation helpers (DocScan)

- `rutDV(body)` — módulo 11 check digit. `validateRut(v)` returns `{ok,label,cls,expected?}`; on mismatch it suggests the correct DV.
- `validatePlate(v)` — accepts `LLLL-NN`, `LLL-NNN`, `LL-NNNN`.
- `parseVencimiento(doc)` — only returns a date when an explicit expiration label/keyword is present (never infers from permit year).

## Model in use

`claude-sonnet-4-6` via the Messages API. Prompt engineering is inline in `analyze()`. To change the model, update the `model:` field in the `callClaudeServer({...})` call inside `docscan.html` and `b2bscan.html`.

## Scaling to other Kavak markets

Currently hardcoded for Chile (RUT format, municipality list, SOAP/RT/Permiso types). To expand:
- Add a country parameter to `doGet`.
- Parameterize the PROMPT in `analyze()` with country-specific document types.
- Add country-specific municipality/registry link tables.
