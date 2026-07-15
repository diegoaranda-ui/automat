/**
 * Kavak Finanzas Tools — Apps Script Web App
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
    .setTitle('Kavak Finanzas Tools')
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

// Planilla de Control de Provisiones (facturas de proveedores vs provisiones)
var PROVISIONES_SHEET_ID = '1oOWGLYN7X28lennVGvp58n1LXmjU8-MoltVj7GeSIaU';

/**
 * Escribe (sobreescribe) la hoja "Provisiones" de la planilla de Control de
 * Provisiones con el resultado del análisis del módulo Provisiones.
 * Llamado desde finanzas.html.
 *
 * payload: {
 *   analista, fecha, hora, cuenta, periodo, mes_cierre,
 *   proveedores: [{nombre, recurrente, meses:{"1":"F"|"P"|"F+P"|"FALTA"|""},
 *                  factura_promedio, meses_falta:[n], provision_sugerida_mensual, comentario}],
 *   total_provision_sugerida, resumen
 * }
 */
function writeProvisionesSheet(payload) {
  const p = (typeof payload === 'string') ? JSON.parse(payload) : (payload || {});

  const ssId = PropertiesService.getScriptProperties().getProperty('PROVISIONES_SHEET_ID') || PROVISIONES_SHEET_ID;
  const ss   = SpreadsheetApp.openById(ssId);

  let sh = ss.getSheetByName('Provisiones');
  if (!sh) sh = ss.insertSheet('Provisiones');
  else {
    sh.clearContents();
    sh.clearFormats();
    sh.getBandings().forEach(function(b){ b.remove(); });
    if (sh.getFilter()) sh.getFilter().remove();
  }

  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const provs = p.proveedores || [];
  const mesCierre = parseInt(p.mes_cierre, 10) || 6;

  const header = ['Proveedor', 'Recurrente'];
  for (var m = 1; m <= mesCierre; m++) header.push(MESES[m-1]);
  header.push('Fact. promedio', 'Prov. sugerida/mes', 'Comentario');
  const REAL_COLS = header.length;

  function fmtMoney(v) {
    const n = parseFloat(v) || 0;
    return n.toLocaleString('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 });
  }
  function pad(arr, len) { while (arr.length < len) arr.push(''); return arr; }

  const rows = [];

  // Fila 1 — Título
  rows.push(pad(['CONTROL DE PROVISIONES — Facturas de Proveedores  ·  Kavak Finanzas Chile'], REAL_COLS));
  // Fila 2 — Metadata
  rows.push(pad([
    'Analista: ' + (p.analista || 'Anónimo'),
    'Fecha análisis: ' + (p.fecha || '') + ' ' + (p.hora || ''),
    'Cuenta: ' + (p.cuenta || '—'),
    'Período: ' + (p.periodo || '—'),
    'Provisión total sugerida: ' + fmtMoney(p.total_provision_sugerida)
  ], REAL_COLS));
  rows.push(pad([''], REAL_COLS));

  // ── Matriz mensual ──
  rows.push(pad(['MATRIZ MENSUAL  ·  F = factura · P = provisión · F+P = ambas · FALTA = provisionar'], REAL_COLS));
  rows.push(header.slice());

  provs.forEach(function(pr) {
    const r = [pr.nombre || '', pr.recurrente ? 'Sí' : 'No'];
    for (var m = 1; m <= mesCierre; m++) {
      r.push((pr.meses && pr.meses[String(m)]) || '');
    }
    r.push(parseFloat(pr.factura_promedio) || 0);
    r.push((pr.meses_falta && pr.meses_falta.length) ? (parseFloat(pr.provision_sugerida_mensual) || 0) : '');
    r.push(pr.comentario || '');
    rows.push(pad(r, REAL_COLS));
  });
  rows.push(pad([''], REAL_COLS));

  // ── Provisiones pendientes ──
  const pend = [];
  provs.forEach(function(pr) {
    (pr.meses_falta || []).forEach(function(m) {
      pend.push({ prov: pr.nombre, mes: MESES[m-1], monto: parseFloat(pr.provision_sugerida_mensual) || 0 });
    });
  });
  rows.push(pad(['PROVISIONES PENDIENTES DE REGISTRAR (' + pend.length + ')'], REAL_COLS));
  rows.push(pad(['Proveedor', 'Mes', 'Monto estimado', 'Registrada (Sí/No)', 'Nº asiento', 'Notas'], REAL_COLS));
  pend.forEach(function(x) {
    rows.push(pad([x.prov, x.mes, x.monto, '', '', ''], REAL_COLS));
  });
  rows.push(pad([''], REAL_COLS));

  // ── Resumen ──
  rows.push(pad(['RESUMEN'], REAL_COLS));
  rows.push(pad([p.resumen || ''], REAL_COLS));

  sh.getRange(1, 1, rows.length, REAL_COLS).setValues(rows);

  // ══ Formato ══
  sh.getRange(1, 1, 1, REAL_COLS).merge().setBackground('#1c1c1e').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(13).setVerticalAlignment('middle');
  sh.setRowHeight(1, 38);
  sh.getRange(2, 1, 1, REAL_COLS).setBackground('#f1f5f9').setFontColor('#475569').setFontSize(10);

  // Matriz
  const matHead = 4;
  sh.getRange(matHead, 1, 1, REAL_COLS).merge().setBackground('#dc1a23').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(11);
  sh.getRange(matHead + 1, 1, 1, REAL_COLS).setBackground('#0f172a').setFontColor('#e2e8f0')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');

  if (provs.length > 0) {
    const dataR = sh.getRange(matHead + 2, 1, provs.length, REAL_COLS);
    dataR.setFontSize(10);
    // Formato moneda en columnas de montos
    sh.getRange(matHead + 2, 2 + mesCierre + 1, provs.length, 2)
      .setNumberFormat('$ #,##0').setHorizontalAlignment('right');
    // Semáforo en celdas de meses
    const mesRange = sh.getRange(matHead + 2, 3, provs.length, mesCierre);
    mesRange.setHorizontalAlignment('center').setFontWeight('bold');
    const rules = sh.getConditionalFormatRules();
    rules.push(
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('FALTA')
        .setBackground('#fde2e1').setFontColor('#b3261e').setRanges([mesRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('F')
        .setBackground('#d6f5e3').setFontColor('#0b6b3a').setRanges([mesRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('F+P')
        .setBackground('#d6f5e3').setFontColor('#0b6b3a').setRanges([mesRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('P')
        .setBackground('#fff1d6').setFontColor('#9a6700').setRanges([mesRange]).build()
    );
    sh.setConditionalFormatRules(rules);
  }

  // Pendientes
  const pendHead = matHead + 2 + provs.length + 1;
  sh.getRange(pendHead, 1, 1, REAL_COLS).merge().setBackground('#d97706').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(11);
  sh.getRange(pendHead + 1, 1, 1, REAL_COLS).setBackground('#0f172a').setFontColor('#e2e8f0')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  if (pend.length > 0) {
    sh.getRange(pendHead + 2, 1, pend.length, 6).setBackground('#fffbeb').setFontColor('#92400e');
    sh.getRange(pendHead + 2, 3, pend.length, 1).setNumberFormat('$ #,##0').setHorizontalAlignment('right');
  }

  // Resumen
  const resHead = pendHead + 2 + pend.length + 1;
  sh.getRange(resHead, 1, 1, REAL_COLS).merge().setBackground('#f1f5f9').setFontColor('#334155')
    .setFontWeight('bold').setFontSize(11);
  sh.getRange(resHead + 1, 1, 1, REAL_COLS).merge().setWrap(true).setFontColor('#475569').setFontSize(10);
  sh.setRowHeight(resHead + 1, 80);

  // Anchos
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 84);
  for (var c = 3; c < 3 + mesCierre; c++) sh.setColumnWidth(c, 62);
  sh.setColumnWidth(3 + mesCierre, 115);
  sh.setColumnWidth(4 + mesCierre, 125);
  sh.setColumnWidth(5 + mesCierre, 260);
  sh.setFrozenRows(1);

  return ss.getUrl() + '#gid=' + sh.getSheetId();
}

/**
 * Ejecutar UNA vez desde el editor de Apps Script (▶ Run → setupDesgloseTemplate).
 * Deja la hoja "Desglose" con estructura, headers y formato listos.
 * No borra datos existentes si ya hay análisis — limpia y reconstruye la plantilla vacía.
 */
function setupDesgloseTemplate() {
  const ssId = PropertiesService.getScriptProperties().getProperty('CONCIL_SHEET_ID') || CONCIL_SHEET_ID;
  const ss   = SpreadsheetApp.openById(ssId);

  let sh = ss.getSheetByName('Desglose');
  if (!sh) sh = ss.insertSheet('Desglose');
  else {
    sh.clearContents();
    sh.clearFormats();
    sh.getBandings().forEach(function(b){ b.remove(); });
    if (sh.getFilter()) sh.getFilter().remove();
  }

  // Anchos de columna: Fecha | Descripción/Glosa | Monto | Fecha libro | Glosa | Referencia | Confianza/Tipo
  var cols = [100, 270, 120, 100, 220, 140, 90];
  cols.forEach(function(w, i){ sh.setColumnWidth(i + 1, w); });

  var rows = [];

  // Fila 1 — Título principal
  rows.push(['CONCILIACIÓN BANCARIA — Papel de Trabajo  ·  Kavak Finanzas Chile', '', '', '', '', '', '']);

  // Fila 2 — Metadata (se llenará con cada análisis)
  rows.push(['Analista: —', 'Fecha: —', 'Hora: —', '', 'Saldo Cartola: —', 'Saldo Libro: —', 'Diferencia Total: —']);

  // Fila 3 — Separador
  rows.push(['', '', '', '', '', '', '']);

  // ── Sección ✓ Conciliados ──
  rows.push(['✓  ÍTEMS CONCILIADOS', '', '', '', '', '', '']);           // fila 4
  rows.push(['Fecha Cartola', 'Descripción', 'Monto', 'Fecha Libro', 'Glosa', 'Referencia', 'Confianza']); // fila 5
  rows.push(['← Los ítems conciliados aparecerán aquí al ejecutar el análisis', '', '', '', '', '', '']);   // fila 6

  // Fila 7 — Separador
  rows.push(['', '', '', '', '', '', '']);

  // ── Sección ⚠ Solo en Cartola ──
  rows.push(['⚠  SOLO EN CARTOLA — sin registro contable', '', '', '', '', '', '']); // fila 8
  rows.push(['Fecha', 'Descripción', 'Monto', 'Tipo', '', '', '']);                   // fila 9
  rows.push(['← Movimientos del banco sin asiento contable', '', '', '', '', '', '']); // fila 10

  // Fila 11 — Separador
  rows.push(['', '', '', '', '', '', '']);

  // ── Sección ⚠ Solo en Libro ──
  rows.push(['⚠  SOLO EN LIBRO — sin movimiento bancario', '', '', '', '', '', '']); // fila 12
  rows.push(['Fecha', 'Glosa', 'Monto', 'Referencia', '', '', '']);                   // fila 13
  rows.push(['← Asientos contables sin movimiento en cartola', '', '', '', '', '', '']); // fila 14

  // Fila 15 — Separador
  rows.push(['', '', '', '', '', '', '']);

  // ── Resumen ──
  rows.push(['RESUMEN', '', '', '', '', '', '']);                        // fila 16
  rows.push(['← El resumen del análisis aparecerá aquí', '', '', '', '', '', '']); // fila 17

  sh.getRange(1, 1, rows.length, 7).setValues(rows);

  // ── Formato fila 1: Título ──
  var r1 = sh.getRange(1, 1, 1, 7);
  r1.merge().setBackground('#1c1c1e').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(14).setHorizontalAlignment('left')
    .setVerticalAlignment('middle').setPaddingLeft && r1.setPaddingLeft(12);
  sh.setRowHeight(1, 40);

  // ── Formato fila 2: Metadata ──
  sh.getRange(2, 1, 1, 7).setBackground('#f1f5f9').setFontColor('#475569')
    .setFontSize(10).setFontStyle('italic');
  sh.setRowHeight(2, 26);

  // ── Formato fila 4: Header sección Conciliados ──
  sh.getRange(4, 1, 1, 7).merge().setBackground('#00a060').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(12);
  sh.setRowHeight(4, 32);

  // ── Formato fila 5: Columnas Conciliados ──
  sh.getRange(5, 1, 1, 7).setBackground('#0f172a').setFontColor('#e2e8f0')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  sh.setRowHeight(5, 26);

  // ── Formato fila 6: Placeholder Conciliados ──
  sh.getRange(6, 1, 1, 7).merge().setBackground('#f0fdf7').setFontColor('#94a3b8')
    .setFontStyle('italic').setFontSize(10).setHorizontalAlignment('center');
  sh.setRowHeight(6, 32);

  // ── Formato fila 8: Header sección Solo Cartola ──
  sh.getRange(8, 1, 1, 7).merge().setBackground('#d97706').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(12);
  sh.setRowHeight(8, 32);

  // ── Formato fila 9: Columnas Solo Cartola ──
  sh.getRange(9, 1, 1, 7).setBackground('#0f172a').setFontColor('#e2e8f0')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  sh.setRowHeight(9, 26);

  // ── Formato fila 10: Placeholder Solo Cartola ──
  sh.getRange(10, 1, 1, 7).merge().setBackground('#fffdf0').setFontColor('#94a3b8')
    .setFontStyle('italic').setFontSize(10).setHorizontalAlignment('center');
  sh.setRowHeight(10, 32);

  // ── Formato fila 12: Header sección Solo Libro ──
  sh.getRange(12, 1, 1, 7).merge().setBackground('#2563eb').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(12);
  sh.setRowHeight(12, 32);

  // ── Formato fila 13: Columnas Solo Libro ──
  sh.getRange(13, 1, 1, 7).setBackground('#0f172a').setFontColor('#e2e8f0')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  sh.setRowHeight(13, 26);

  // ── Formato fila 14: Placeholder Solo Libro ──
  sh.getRange(14, 1, 1, 7).merge().setBackground('#f0f5ff').setFontColor('#94a3b8')
    .setFontStyle('italic').setFontSize(10).setHorizontalAlignment('center');
  sh.setRowHeight(14, 32);

  // ── Formato fila 16: Header Resumen ──
  sh.getRange(16, 1, 1, 7).merge().setBackground('#f1f5f9').setFontColor('#334155')
    .setFontWeight('bold').setFontSize(11);
  sh.setRowHeight(16, 28);

  // ── Formato fila 17: Texto Resumen ──
  sh.getRange(17, 1, 1, 7).merge().setBackground('#ffffff').setFontColor('#94a3b8')
    .setFontStyle('italic').setFontSize(10).setWrap(true);
  sh.setRowHeight(17, 60);

  sh.setFrozenRows(1);
  ss.setActiveSheet(sh);

  return 'Plantilla Desglose lista: ' + ss.getUrl();
}

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
  rows.push(['CONCILIACIÓN BANCARIA — Papel de Trabajo Kavak Finanzas Chile', '', '', '', '', '', '']);
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

  db.getRange('B2').setValue('KAVAK FINANZAS · Panel de Inspecciones')
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
