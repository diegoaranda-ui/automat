# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Google Apps Script Web App for **Kavak Chile — Finanzas**. A single-URL "Operations Center" with two families of tools:

- **Finance Suite** (`finanzas.html`, primary product): 5 AI-assisted modules that turn financial documents into structured working papers (papeles de trabajo) — Conciliación Bancaria, Reportería Financiera, Gestión Documental, Automatización Contable, and **Control de Provisiones** (NetSuite GL vs monthly provisions).
- **Inspection tools** (legacy Supply era, still active): DocScan C2B, B2B Scan, and a no-AI RUT/patente validator.

Primary user: junior Accountant Analyst producing audit-defensible working papers. Outputs must stay traceable (who/when/which file/params) and reproducible.

## Project structure

| File (repo) | Apps Script file name | Role |
|------|------|------|
| `Codigo.gs` | `Codigo` | Backend — router (`doGet`), `include()`, `callClaude()` proxy, Sheets writers |
| `hub.html` | `hub` | Operations Center: card grid landing + sandboxed lazy iframes per tool |
| `finanzas.html` | `finanzas` | Finance Suite (5 modules), served by `?page=finanzas&tab=<module>` |
| `docscan.html` | `docscan` | DocScan C2B, served by `?page=docscan` |
| `b2bscan.html` | `b2bscan` | B2B Scan, served by `?page=b2bscan` |
| `validador.html` | `validador` | RUT/patente validator (client-only), `?page=validador` |
| `_styles_hub.html`, `_header.html`, `_sidebar.html` | same | Shared partials via `<?= include('name') ?>` |
| `FINANCE_SUITE.md` | — | Executive summary, per-module manual, reliability roadmap |

**Critical naming rule:** the Apps Script HTML file name must match the route exactly (`finanzas`, not `Finanzas_v2`). `buildPage` does `createTemplateFromFile(name)` where `name` is the `?page=` value in `validPages`.

## Deployment

No build step. Deploy manually:
1. Paste each file into the matching Apps Script file (names per table above).
2. **API key:** Project Settings → Script Properties → `ANTHROPIC_KEY` = `sk-ant-...`. Server-side only; never hardcode in any HTML/JS. Script Properties are read at runtime — key changes do NOT need a redeploy.
3. Deploy → New deployment → Web App → Execute as: Me → Access: Any user in Kavak.
4. **Every code change requires a new deployment version** (Implementar → Administrar implementaciones → ✏️ → Nueva versión). Then hard-refresh (`Ctrl+Shift+R`) — hub iframes cache aggressively.

## Architecture

**Routing:** `doGet(e)` reads `?page=hub|docscan|b2bscan|validador|finanzas` → `buildPage(name)`. Template vars `BASE_URL`, `VERSION`, `ACTIVE_PAGE` exposed to templates.

**Hub = iframes, no duplication:** the hub renders each tool in a lazy sandboxed iframe pointing at `BASE_URL?page=<tool>` (src set on first open; finance tabs via `?page=finanzas&tab=<module>` + postMessage for later switches). Iframe sandbox includes `allow-popups allow-popups-to-escape-sandbox` — required for "Abrir Sheets →" links; do not remove. Each tool has a single source of truth in its own file. Do NOT reintroduce embedded `srcdoc` copies.

**Claude calls (server-side proxy):** clients call `google.script.run.callClaude(payload)` (Promise-wrapped as `callClaudeServer`). `callClaude` in `Codigo.gs` reads `ANTHROPIC_KEY` and hits the Messages API via `UrlFetchApp`, returning `{status, body}` as a JSON string so clients keep retry/overload logic. The API key never reaches the browser.

**Models in use** (set in each `callClaudeServer({model: ...})` call in the HTML files):
- Provisiones: `claude-opus-4-8`, `max_tokens: 16000` (analytical depth; do NOT pass `temperature` — deprecated on Opus 4.8, returns HTTP 400)
- All other modules: `claude-sonnet-4-6`, `max_tokens: 4096`

**File processing (client-side):** images compressed via canvas (max 1600px, JPEG 0.82); PDFs rendered by pdf.js CDN (scale 1.2, up to 4 pages stacked, capped at 1800px height — keeps base64 under API limits); Excel/CSV parsed by SheetJS CDN to text, truncated to 25 000 chars with an explicit truncation note. `extractJSON()` detects `stop_reason === 'max_tokens'` and raises a clear "file too big" error.

**State:** per-module files in `STATE` object; history in `localStorage` (`fin_hist` for Finance Suite, `ds3_hist` DocScan, `b2b_hist` B2B; user name `fin_user`/`ds_user`). No server-side persistence beyond Sheets.

## Google Sheets integrations (three spreadsheets)

| Constant in `Codigo.gs` | Spreadsheet | Written by |
|---|---|---|
| `DEFAULT_SHEET_ID` (override: Script Property `SHEET_ID`) | Panel de inspecciones — `Registros` + `Dashboard` tabs | `appendToSheet(payload)` from DocScan/B2B/finanzas modules |
| `CONCIL_SHEET_ID` (override: `CONCIL_SHEET_ID` property) | Papel de trabajo de conciliaciones — `Desglose` tab | `writeConciliacionDesglose(payload)` after each conciliación analysis (overwrite) |
| `PROVISIONES_SHEET_ID` (override: `PROVISIONES_SHEET_ID` property) | Control Provisiones — `Provisiones` tab | `writeProvisionesSheet(payload)` after each provisiones analysis (overwrite) |

`setupKavakSheet()` and `setupDesgloseTemplate()` are one-time formatters run from the editor. Keep client payload keys in sync with `appendToSheet` and `SHEET_HEADERS` column order.

Sheet writers rebuild content with `clearContents()+clearFormats()` then `setValues` on a uniform-width rows array (`pad()` to `REAL_COLS`) followed by explicit format ranges — when editing, recompute the row-offset arithmetic (title/metadata/section headers) by hand and keep every pushed row the same width.

## Control de Provisiones — domain logic (do not break)

The module answers: *which recurrent monthly suppliers have months with neither invoice nor provision, and how much should be provisioned?*

1. **Parser** (`processProvisionesGL` in `finanzas.html`): reads the NetSuite "CL - General Ledger (Con filtro por Cuenta)" export (SpreadsheetML `.xls`, `.xlsx`, `.csv` — SheetJS handles all). Finds the header row (`Account` + `Type`, last occurrence), detects the account code, and classifies each movement: `Type` contains "Diario" → `REVERSO` if memo contains "reverso" **or amount is negative**, else `PROVISION`; anything else → `FACTURA`. Aggregates by provider+month+class into compact `movs` (kept in client STATE — never send raw GL to the API).
2. **AI analysis** (`analyzeProvisiones`): Opus receives the aggregated table and classifies months (`F`/`P`/`F+P`/`FALTA`), judges recurrence (≥ umbral months with factura), writes `comentario`s, `resumen`, and `notas_auditoria` (3–8 data-cited observations for auditors: concentration, non-monthly billing patterns, atypical fluctuations, reversal traceability, threshold sensitivity).
3. **Deterministic reconciliation** (`reconcileProvisiones`): code — not the AI — recomputes `factura_promedio` from the file's actual FACTURA movements (positive monthly nets, months 1..mesCierre), derives `meses_falta` from the matrix, forces `provision_sugerida_mensual = factura_promedio`, and recomputes the exact total. **REVERSO amounts must never reach a suggested amount.** Same file → same numbers, always.
4. **Output:** KPI cards, F/P/FALTA matrix, pending-provisions table, audit notes card (copyable), resumen; auto-written to the Provisiones sheet with semáforo conditional formatting.

## Validation helpers (DocScan)

- `rutDV(body)` — módulo 11 check digit. `validateRut(v)` returns `{ok,label,cls,expected?}`.
- `validatePlate(v)` — accepts `LLLL-NN`, `LLL-NNN`, `LL-NNNN`.
- `parseVencimiento(doc)` — only returns a date when an explicit expiration label is present.
- Cross-document dictamen: `buildConsolidado(docs)` when 2+ docs analyzed together.

## Conventions

- Spanish UI text (Chile); CLP money formatting via `toLocaleString('es-CL')`.
- Brand: "Kavak Finanzas" (renamed from "Kavak Supply" — do not reintroduce Supply naming in user-visible text).
- Plain browser JS inside Apps Script HtmlService iframes: no modules, no bundler, CDN-pinned pdf.js 3.11.174 and SheetJS 0.18.5.
- AI outputs are decision support: keep human-review framing ("propuesta", confidence levels) in UI copy; never present AI output as official accounting records.

## Scaling to other Kavak markets

Currently hardcoded for Chile (RUT format, municipality list, SOAP/RT/Permiso types, IVA 19%, Plan de Cuentas chileno). To expand: add a country parameter to `doGet`, parameterize prompts per country, add country-specific registry link tables.
