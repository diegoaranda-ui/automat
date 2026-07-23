# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Google Apps Script Web App for **Kavak Chile — Finanzas**. A single-URL "Operations Center" with two families of tools:

- **Finance Suite** (`finanzas.html`, the product): 6 AI-assisted modules that turn financial documents into structured working papers (papeles de trabajo) — Conciliación Bancaria, Reportería Financiera, Gestión Documental, Automatización Contable, **Control de Provisiones** (NetSuite GL vs monthly provisions), and **Impuesto Transferencia ICAR** (account 2801-01: per-Stock-ID cross of customer-invoiced transfer tax vs ICAR fund deductions; deterministic like Provisiones — classification ok / invoiced-not-deducted (wait for ICAR rendition) / negative-result-to-book (sum > 0 per stock, feeds the analyst's adjustment entry — the module analyzes, never books); writes to the team's own spreadsheet `ICAR_SHEET_ID` tab 'Análisis ICAR'). The legacy Supply inspection tools (DocScan/B2B/validador) were removed in Jul 2026.

Primary user: junior Accountant Analyst producing audit-defensible working papers. Outputs must stay traceable (who/when/which file/params) and reproducible.

## Project structure

| File (repo) | Apps Script file name | Role |
|------|------|------|
| `Codigo.gs` | `Codigo` | Backend — router (`doGet`), `include()`, `callClaude()` proxy, Sheets writers |
| `hub.html` | `hub` | Operations Center: card grid landing + sandboxed lazy iframes per tool |
| `finanzas.html` | `finanzas` | Finance Suite (5 modules), served by `?page=finanzas&tab=<module>` |
| `FINANCE_SUITE.md` | — | Executive summary, per-module manual, reliability roadmap |

**Critical naming rule:** the Apps Script HTML file name must match the route exactly (`finanzas`, not `Finanzas_v2`). `buildPage` does `createTemplateFromFile(name)` where `name` is the `?page=` value in `validPages`.

## Deployment

No build step. Deploy manually:
1. Paste each file into the matching Apps Script file (names per table above).
2. **API key:** Project Settings → Script Properties → `ANTHROPIC_KEY` = `sk-ant-...`. Server-side only; never hardcode in any HTML/JS. Script Properties are read at runtime — key changes do NOT need a redeploy.
3. Deploy → New deployment → Web App → Execute as: Me → Access: Any user in Kavak.
4. **Every code change requires a new deployment version** (Implementar → Administrar implementaciones → ✏️ → Nueva versión). Then hard-refresh (`Ctrl+Shift+R`) — hub iframes cache aggressively.

## Architecture

**Routing:** `doGet(e)` reads `?page=hub|finanzas` (+ `&tab=` injected as `ACTIVE_TAB`) → `buildPage(name)`. Template vars `BASE_URL`, `VERSION`, `ACTIVE_PAGE` exposed to templates.

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

1. **Parser** (`processProvisionesGL` in `finanzas.html`): reads the NetSuite "CL - General Ledger (Con filtro por Cuenta)" export (SpreadsheetML `.xls`, `.xlsx`, `.csv` — SheetJS handles all). Finds the header row (`Account` + `Type`, last occurrence), detects the account code, and classifies each movement per the team's accounting rule: `Type` contains "Diario" → `REVERSO` if memo contains "reverso" **or amount is negative**, else `PROVISION`; non-Diario rows count as `FACTURA` **only when Document Number starts with "IR"** (received invoice); everything else (payments, credit notes) is EXCLUDED and reported. Multi-account files supported: account subtitles (`5401-14 - …`) set the current account per movement ("Total - …" rows ignored); excluded movements are kept in `otros` for a visibility breakdown. **Memo/Nota drives Diario rows** (two-pass parse): if the memo names a month ("junio 2026", "04-2026", "prov. jun" — written name wins over numeric), the provision/reverso is assigned to THAT month, not the booking month; if the Diario has no provider, a unique-token match of the memo against the account's known provider names assigns it ("PROVISION CREDEX 04-2026" → Credex). Memo excerpts (tagged [devengo]/[provisión]/[reclasificación]) are kept per aggregate, shown in the drill-down, and sent to the AI as the accounting justification. Aggregates by account+provider+month+class into compact `movs` (kept in client STATE — never send raw GL to the API).
2. **Deterministic compute** (`computeProvisionesLocal`): the matrix (`F`/`P`/`F+P`/`FALTA`), recurrence (**fixed rule: factura in 2+ months** — the configurable umbral was removed), factura típica, and totals are all computed in code, keyed by **cuenta|proveedor** (amounts are never mixed across providers or accounts).
3. **Factura típica** (`facturaTipica`): the provider's own most-repeated amount — **mode with ±5% tolerance** (largest cluster of similar amounts → its median); if no amount repeats, the **median** — never the arithmetic mean, so a one-month extra charge cannot inflate the suggestion. `provision_sugerida_mensual = factura típica` ONLY for the actionable provider/month; `total_provision_sugerida` sums actionable providers only — prior-month gaps carry no suggested amount (regularized at year-end, shown as context with the factura típica). **REVERSO amounts must never reach a suggested amount.** Same file → same numbers, always. **AI is writer-only** (`analyzeProvisiones` sends the computed result + movements to Opus for `resumen`/`comentarios`/`notas_auditoria`; if the AI call fails, the deterministic result renders anyway).
4. **Actionable focus:** a provider is actionable for mes_cierre ONLY if it has no factura/provision in the closing month AND invoiced in the immediately previous month (`accionable` flag + `ultimo_mes_factura`). Recurrent providers missing the closing month but inactive for months go to a "confirmar vigencia" bucket (no automatic provision suggested). Earlier-month gaps are reference. UI and Sheet split pendings into "ACCIONABLE <mes>" / "Revisar vigencia" / "Referencia"; a deterministic monthly comparison dashboard (per-provider invoice evolution + MoM deltas, ⚠ at ±50% or missing invoice) renders in the UI and is written to the sheet via the `comparativa` payload.
5. **Output:** KPI cards, F/P/FALTA matrix (click a provider row = drill-down to its GL movements), actionable/reference pending tables, comparativa dashboard, audit notes card (copyable), resumen; auto-written to the Provisiones sheet; comparativa + otros breakdown + native column chart go to a separate `Dashboard` tab (`writeProvisionesDashboard_`).

## Conventions

- Spanish UI text (Chile); CLP money formatting via `toLocaleString('es-CL')`.
- Brand: "KAVAK Finanzas" — black (#000/#0a0a0a) chrome with red (#dc1a23) accents per Kavak identity; data semantics keep green/amber/red. Do not reintroduce Supply naming.
- Plain browser JS inside Apps Script HtmlService iframes: no modules, no bundler, CDN-pinned pdf.js 3.11.174 and SheetJS 0.18.5.
- AI outputs are decision support: keep human-review framing ("propuesta", confidence levels) in UI copy; never present AI output as official accounting records.

## Scaling to other Kavak markets

Currently hardcoded for Chile (RUT format, municipality list, SOAP/RT/Permiso types, IVA 19%, Plan de Cuentas chileno). To expand: add a country parameter to `doGet`, parameterize prompts per country, add country-specific registry link tables.
