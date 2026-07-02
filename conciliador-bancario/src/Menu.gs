/**
 * Menu.gs
 * -----------------------------------------------------------------------------
 * Menú del conciliador + apertura de la sidebar de carga. Es la capa que ve el
 * usuario. La lógica está en Engine.gs / Worksheet.gs.
 * -----------------------------------------------------------------------------
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🏦 Conciliador')
    .addItem('Cargar cartola del mayor…', 'abrirSidebar')
    .addItem('Reconstruir Hoja de Trabajo', 'reconstructWorksheet')
    .addSeparator()
    .addItem('Acerca de / Ayuda', 'mostrarAyuda')
    .addToUi();
}

/** Abre la sidebar donde el usuario elige el banco y pega la cartola. */
function abrirSidebar() {
  var html = HtmlService.createTemplateFromFile('src/Sidebar')
    .evaluate()
    .setTitle('Cargar cartola del mayor')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Handler llamado desde la sidebar (google.script.run). Envuelve el motor y
 * normaliza errores para que la UI los muestre sin romperse.
 */
function ui_procesarCartola(bankKey, rawText) {
  try {
    return { ok: true, data: procesarCartola(bankKey, rawText) };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/** Expuesto a la sidebar para poblar el selector de bancos. */
function ui_listBanks() {
  return listBanks();
}

function mostrarAyuda() {
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    'Conciliador Bancario',
    'Flujo:\n' +
    '1) Menú 🏦 Conciliador → "Cargar cartola del mayor…".\n' +
    '2) Elige el banco y pega la cartola (copiada desde Excel/Sheets o CSV).\n' +
    '3) La herramienta genera la hoja "<Banco> · Mayor Nuevo" marcando cada\n' +
    '   movimiento como NUEVO, DUPLICADO, REVISAR o SIN ID según el ID de Cobro.\n' +
    '4) "Reconstruir Hoja de Trabajo" arma una vista priorizada de lo accionable.\n\n' +
    'Cada banco tiene su propia lógica de análisis (ver src/banks/*.gs).',
    ui.ButtonSet.OK
  );
}

/** Permite incluir archivos HTML parciales si se necesitara. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
