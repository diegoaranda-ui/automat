/**
 * Kavak Supply Tools — Apps Script Web App
 */

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'hub';
  const validPages = ['hub', 'docscan', 'b2bscan', 'validador', 'finanzas'];
  const target = validPages.includes(page) ? page : 'hub';
  return buildPage(target);
}

function buildPage(name) {
  const template = HtmlService.createTemplateFromFile(name);
  template.VERSION     = '1.1.0';
  template.ACTIVE_PAGE = name;
  template.BASE_URL    = ScriptApp.getService().getUrl();
  return template.evaluate()
    .setTitle('Kavak Supply Tools')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Proxy server-side a la Messages API de Claude.
 * La API key vive en Configuración del proyecto → Propiedades del script → ANTHROPIC_KEY,
 * nunca en el cliente. El frontend la invoca con google.script.run.callClaude(payload).
 *
 * Devuelve un JSON string: {"status": <httpCode>, "body": "<respuesta cruda de Anthropic>"}
 * para que el cliente conserve su lógica de reintentos/overload.
 */
function callClaude(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
  if (!key) {
    return JSON.stringify({ status: 500, body: JSON.stringify({ error: { message: 'Falta ANTHROPIC_KEY en Propiedades del script.' } }) });
  }
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return JSON.stringify({ status: res.getResponseCode(), body: res.getContentText() });
}

/* ============================================================
 *  GOOGLE SHEETS — Panel de inspecciones
 * ============================================================ */

// Sheet creada para el equipo. setupKavakSheet() la formatea y guarda el ID.
// Si prefieres otra, cambia SHEET_ID en Propiedades del script.
var DEFAULT_SHEET_ID = '1aUPadOFLivxi7u-IeSSACJsCJDPkRAi-04KxrCkm7tk';

// Planilla de papel de trabajo de conciliaciones
var CONCIL_SHEET_ID = '1p3TYuzbwMw1Iijd07lTpsJMM_e73VUmnIlBkeM57Txc';

/**
 * Escribe (sobreescribe) la hoja "Desglose" de la planilla de conciliaciones
 * con el resultado completo del análisis. Llamado desde finanzas.html tras
 * analizar Conciliación Bancaria.
 *
 * payload: {
 *   analista, fecha, hora,
 *   cartola: [{fecha, descripcion, monto, tipo}],
 *   libro:   [{fecha, glosa, monto, referencia}],
 *   conciliados: [{cartola_idx, libro_idx, confianza, diferencia}],
 *   solo_cartola: [idx,...],
 *   solo_libro:   [idx,...],
 *   saldo_cartola, saldo_libro, diferencia_total, resumen
 * }
 */
function writeConciliacionDesglose(payload) {
  const p = (typeof payload === 'string') ? JSON.parse(payload) : (payload || {});

  const ssId = PropertiesService.getScriptProperties().getProperty('CONCIL_SHEET_ID') || CONCIL_SHEET_ID;
  const ss    = SpreadsheetApp.openById(ssId);

  // Obtener o crear la hoja "Desglose"
  let sh = ss.getSheetByName('Desglose');
  if (!sh) {
    sh = ss.insertSheet('Desglose');
  } else {
    sh.clearContents();
    sh.clearFormats();
    sh.getBandings().forEach(function(b){ b.remove(); });
    if (sh.getFilter()) sh.getFilter().remove();
  }

  const cartola      = p.cartola      || [];
  const libro        = p.libro        || [];
  const conciliados  = p.conciliados  || [];
  const soloCartola  = (p.solo_cartola || []).map(Number);
  const soloLibro    = (p.solo_libro   || []).map(Number);

  function fmtMoney(v) {
    const n = parseFloat(v) || 0;
    return n.toLocaleString('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 });
  }

  const rows = [];

  // ── Título ──
  rows.push(['CONCILIACIÓN BANCARIA — Papel de Trabajo Kavak Supply Chile', '', '', '', '', '', '']);
  rows.push([
    'Analista: ' + (p.analista || 'Anónimo'),
    'Fecha: ' + (p.fecha || ''),
    'Hora: ' + (p.hora || ''),
    '',
    'Saldo Cartola: ' + fmtMoney(p.saldo_cartola),
    'Saldo Libro: ' + fmtMoney(p.saldo_libro),
    'Diferencia Total: ' + fmtMoney(p.diferencia_total)
  ]);
  rows.push(['', '', '', '', '', '', '']);

  // ── Sección: Conciliados ──
  rows.push(['✓ ÍTEMS CONCILIADOS (' + conciliados.length + ')', '', '', '', '', '', '']);
  rows.push(['Fecha Cartola', 'Descripción', 'Monto', 'Fecha Libro', 'Glosa', 'Referencia', 'Confianza']);
  conciliados.forEach(function(c) {
    const ct = cartola[c.cartola_idx] || {};
    const lb = libro[c.libro_idx]     || {};
    rows.push([
      ct.fecha || '', ct.descripcion || '', parseFloat(ct.monto) || 0,
      lb.fecha || '', lb.glosa || '', lb.referencia || '',
      c.confianza || ''
    ]);
  });
  rows.push(['', '', '', '', '', '', '']);

  // ── Sección: Solo en cartola ──
  rows.push(['⚠ SOLO EN CARTOLA — sin registro contable (' + soloCartola.length + ')', '', '', '', '', '', '']);
  rows.push(['Fecha', 'Descripción', 'Monto', 'Tipo', '', '', '']);
  soloCartola.forEach(function(idx) {
    const ct = cartola[idx] || {};
    rows.push([ct.fecha || '', ct.descripcion || '', parseFloat(ct.monto) || 0, ct.tipo || '', '', '', '']);
  });
  rows.push(['', '', '', '', '', '', '']);

  // ── Sección: Solo en libro ──
  rows.push(['⚠ SOLO EN LIBRO — sin movimiento bancario (' + soloLibro.length + ')', '', '', '', '', '', '']);
  rows.push(['Fecha', 'Glosa', 'Monto', 'Referencia', '', '', '']);
  soloLibro.forEach(function(idx) {
    const lb = libro[idx] || {};
    rows.push([lb.fecha || '', lb.glosa || '', parseFloat(lb.monto) || 0, lb.referencia || '', '', '', '']);
  });
  rows.push(['', '', '', '', '', '', '']);

  // ── Resumen ──
  rows.push(['RESUMEN', '', '', '', '', '', '']);
  rows.push([p.resumen || '', '', '', '', '', '', '']);

  // Escribir todo de una vez
  sh.getRange(1, 1, rows.length, 7).setValues(rows);

  // ── Formato: Título ──
  const titleR = sh.getRange(1, 1, 1, 7);
  titleR.merge().setBackground('#1c1c1e').setFontColor('#ffffff')
        .setFontWeight('bold').setFontSize(13).setVerticalAlignment('middle');
  sh.setRowHeight(1, 36);

  // ── Formato: Metadata ──
  sh.getRange(2, 1, 1, 7).setBackground('#f1f5f9').setFontColor('#334155').setFontSize(10);
  sh.setRowHeight(2, 28);

  // Localizar filas de sección y formatearlas
  var currentRow = 4;

  // Conciliados
  var concilHeader = currentRow;
  sh.getRange(concilHeader, 1, 1, 7).merge().setBackground('#00a060').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  sh.getRange(concilHeader + 1, 1, 1, 7).setBackground('#0f172a').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
  if (conciliados.length > 0) {
    sh.getRange(concilHeader + 2, 1, conciliados.length, 7)
      .setBackground('#e6f7f0').setFontColor('#0b6b3a');
    // Columna monto alineada a la derecha y formato moneda
    sh.getRange(concilHeader + 2, 3, conciliados.length, 1)
      .setNumberFormat('$ #,##0').setHorizontalAlignment('right');
  }
  currentRow += 2 + conciliados.length + 1; // headers + data + blank

  // Solo cartola
  var soloCartHeader = currentRow;
  sh.getRange(soloCartHeader, 1, 1, 7).merge().setBackground('#d97706').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  sh.getRange(soloCartHeader + 1, 1, 1, 7).setBackground('#0f172a').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
  if (soloCartola.length > 0) {
    sh.getRange(soloCartHeader + 2, 1, soloCartola.length, 7)
      .setBackground('#fffbeb').setFontColor('#92400e');
    sh.getRange(soloCartHeader + 2, 3, soloCartola.length, 1)
      .setNumberFormat('$ #,##0').setHorizontalAlignment('right');
  }
  currentRow += 2 + soloCartola.length + 1;

  // Solo libro
  var soloLibHeader = currentRow;
  sh.getRange(soloLibHeader, 1, 1, 7).merge().setBackground('#2563eb').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
  sh.getRange(soloLibHeader + 1, 1, 1, 7).setBackground('#0f172a').setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
  if (soloLibro.length > 0) {
    sh.getRange(soloLibHeader + 2, 1, soloLibro.length, 7)
      .setBackground('#eff6ff').setFontColor('#1e3a8a');
    sh.getRange(soloLibHeader + 2, 3, soloLibro.length, 1)
      .setNumberFormat('$ #,##0').setHorizontalAlignment('right');
  }
  currentRow += 2 + soloLibro.length + 1;

  // Resumen
  sh.getRange(currentRow, 1, 1, 7).merge().setBackground('#f1f5f9').setFontColor('#334155').setFontWeight('bold').setFontSize(11);
  sh.getRange(currentRow + 1, 1, 1, 7).merge().setWrap(true).setFontColor('#475569').setFontSize(10);
  sh.setRowHeight(currentRow + 1, 72);

  // Anchos de columna
  [100, 260, 110, 100, 220, 130, 80].forEach(function(w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(1);

  return ss.getUrl() + '#gid=' + sh.getSheetId();
}

var SHEET_HEADERS = ['Fecha','Hora','Analista','Herramienta','Tipo documento','Patente',
  'RUT','Nombre / Razón social','Comuna','Vigencia','Confianza','Duración','Observaciones'];

function getSheetId_() {
  return PropertiesService.getScriptProperties().getProperty('SHEET_ID') || DEFAULT_SHEET_ID;
}

function getRegistros_() {
  const ss = SpreadsheetApp.openById(getSheetId_());
  return ss.getSheetByName('Registros') || ss.getSheets()[0];
}

/**
 * Recibe un registro desde el cliente (google.script.run.appendToSheet) y lo
 * agrega como fila en la pestaña "Registros". Devuelve la URL de la planilla.
 */
function appendToSheet(payload) {
  const p = (typeof payload === 'string') ? JSON.parse(payload) : (payload || {});
  const sh = getRegistros_();
  sh.appendRow([
    p.fecha || '', p.hora || '', p.analista || 'Anónimo', p.herramienta || 'DocScan',
    p.tipo_doc || '', p.patente || '', p.rut || '', p.nombre || '', p.municipio || '',
    p.vigencia || '', p.confianza || '', p.tiempo_fmt || '', p.observaciones || ''
  ]);
  return SpreadsheetApp.openById(getSheetId_()).getUrl();
}

/**
 * Ejecutar UNA vez desde el editor de Apps Script.
 * Da formato a la planilla (diseño Kavak: header oscuro, semáforos de vigencia,
 * banding) y construye la pestaña "Dashboard" con KPIs por fórmula.
 * Si no hay SHEET_ID en Propiedades, usa DEFAULT_SHEET_ID y lo guarda.
 */
function setupKavakSheet() {
  const id = getSheetId_();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', id);
  const ss = SpreadsheetApp.openById(id);

  // ── Pestaña Registros ──────────────────────────────
  let sh = ss.getSheetByName('Registros');
  if (!sh) { sh = ss.getSheets()[0]; sh.setName('Registros'); }

  // Encabezados
  sh.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]);
  const head = sh.getRange(1, 1, 1, SHEET_HEADERS.length);
  head.setBackground('#1c1c1e').setFontColor('#ffffff').setFontWeight('bold')
      .setFontSize(11).setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setRowHeight(1, 34);
  sh.setFrozenRows(1);

  // Anchos de columna
  const widths = [92, 64, 96, 96, 150, 92, 110, 200, 120, 96, 90, 80, 280];
  widths.forEach(function(w, i){ sh.setColumnWidth(i + 1, w); });

  // Banding (alternar filas) — limpiar previos para evitar duplicados
  sh.getBandings().forEach(function(b){ b.remove(); });
  const lastRow = Math.max(sh.getMaxRows(), 200);
  sh.getRange(2, 1, lastRow - 1, SHEET_HEADERS.length)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

  // Filtro
  if (sh.getFilter()) sh.getFilter().remove();
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), SHEET_HEADERS.length).createFilter();

  // Semáforos de vigencia (columna J = 10) y confianza (K = 11)
  const vigRange = sh.getRange(2, 10, lastRow - 1, 1);
  const confRange = sh.getRange(2, 11, lastRow - 1, 1);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Vigente')
      .setBackground('#d6f5e3').setFontColor('#0b6b3a').setRanges([vigRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Vencido')
      .setBackground('#fde2e1').setFontColor('#b3261e').setRanges([vigRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Revisar')
      .setBackground('#fff1d6').setFontColor('#9a6700').setRanges([vigRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('baja')
      .setBackground('#fde2e1').setFontColor('#b3261e').setRanges([confRange]).build()
  ];
  sh.setConditionalFormatRules(rules);

  // ── Pestaña Dashboard ──────────────────────────────
  let db = ss.getSheetByName('Dashboard');
  if (!db) db = ss.insertSheet('Dashboard', 0);
  db.clear();
  db.setHiddenGridlines(true);
  db.setColumnWidth(1, 30);
  [2,3,4,5].forEach(function(c){ db.setColumnWidth(c, 150); });

  db.getRange('B2').setValue('KAVAK SUPPLY · Panel de Inspecciones')
    .setFontSize(18).setFontWeight('bold').setFontColor('#1c1c1e');
  db.getRange('B3').setValue('Resumen en vivo de DocScan y B2B Scan')
    .setFontSize(11).setFontColor('#8e8e93');

  // Tarjetas KPI (fila 5-7), valores por fórmula
  const cards = [
    { col: 'B', label: 'Total inspecciones', formula: '=COUNTA(Registros!A2:A)', bg: '#1c1c1e', fg: '#ffffff' },
    { col: 'C', label: 'Hoy',                formula: '=COUNTIF(Registros!A2:A, TEXT(TODAY(),"dd-mm-yyyy"))', bg: '#00a060', fg: '#ffffff' },
    { col: 'D', label: 'Vigentes',           formula: '=COUNTIF(Registros!J2:J,"Vigente")', bg: '#e6f7ef', fg: '#0b6b3a' },
    { col: 'E', label: 'Vencidos',           formula: '=COUNTIF(Registros!J2:J,"Vencido")', bg: '#fde2e1', fg: '#b3261e' }
  ];
  cards.forEach(function(c){
    db.getRange(c.col + '5').setValue(c.label).setFontSize(10).setFontWeight('bold')
      .setBackground(c.bg).setFontColor(c.fg).setHorizontalAlignment('center');
    db.getRange(c.col + '6').setFormula(c.formula).setFontSize(26).setFontWeight('bold')
      .setBackground(c.bg).setFontColor(c.fg).setHorizontalAlignment('center');
    db.setRowHeight(6, 46);
  });

  // Tabla: inspecciones por analista
  db.getRange('B9').setValue('Por analista').setFontWeight('bold').setFontColor('#1c1c1e');
  db.getRange('B10').setFormula(
    '=IFERROR(QUERY(Registros!A2:M, "select C, count(C) where C is not null group by C order by count(C) desc label C \'Analista\', count(C) \'Inspecciones\'"), "Sin datos")'
  );

  // Tabla: por herramienta
  db.getRange('D9').setValue('Por herramienta').setFontWeight('bold').setFontColor('#1c1c1e');
  db.getRange('D10').setFormula(
    '=IFERROR(QUERY(Registros!A2:M, "select D, count(D) where D is not null group by D order by count(D) desc label D \'Herramienta\', count(D) \'Inspecciones\'"), "Sin datos")'
  );

  // ── Tabla auxiliar para el gráfico de inspecciones por día ──
  // Colocada a partir de B14 (debajo de las tablas QUERY)
  db.getRange('B14').setValue('Inspecciones por día').setFontWeight('bold').setFontColor('#1c1c1e');
  // Fórmula: genera la serie de fechas únicas con su conteo
  db.getRange('B15').setFormula(
    '=IFERROR(QUERY(Registros!A2:A,"select A, count(A) where A is not null group by A order by A label A \'Fecha\', count(A) \'Cantidad\'"),"Sin datos")'
  );

  // Gráfico de barras con la tabla anterior
  var existingCharts = db.getCharts();
  existingCharts.forEach(function(c){ db.removeChart(c); });

  var chartBuilder = db.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(db.getRange('B15:C65'))
    .setPosition(14, 5, 0, 0)
    .setOption('title', 'Inspecciones por día')
    .setOption('titleTextStyle', {color: '#1c1c1e', fontSize: 13, bold: true})
    .setOption('colors', ['#00a060'])
    .setOption('backgroundColor', {fill: '#ffffff'})
    .setOption('legend', {position: 'none'})
    .setOption('hAxis', {textStyle: {color: '#64748b', fontSize: 10}})
    .setOption('vAxis', {textStyle: {color: '#64748b', fontSize: 10}, minValue: 0, format: '0'})
    .setOption('width', 480)
    .setOption('height', 260);
  db.insertChart(chartBuilder.build());

  ss.setActiveSheet(db);
  return ss.getUrl();
}
