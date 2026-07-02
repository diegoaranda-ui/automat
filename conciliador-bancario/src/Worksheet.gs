/**
 * Worksheet.gs
 * -----------------------------------------------------------------------------
 * Todo lo visual: escribe la hoja "Mayor Nuevo" con estados a color y arma la
 * "Hoja de Trabajo" mejorada. Ninguna lógica de negocio vive aquí.
 * -----------------------------------------------------------------------------
 */

/** Formatea un número como pesos chilenos "$ 1.234.567". */
function formatCLP_(n) {
  if (n === null || n === undefined || isNaN(n)) return '';
  var neg = n < 0;
  var s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-$ ' : '$ ') + s;
}

/** Devuelve el color de fondo/texto para un estado. */
function colorsForEstado_(estado) {
  switch (estado) {
    case ESTADO.NUEVO:     return { bg: PALETTE.nuevo,     fg: PALETTE.nuevoText };
    case ESTADO.DUPLICADO: return { bg: PALETTE.duplicado, fg: PALETTE.duplicadoTx };
    case ESTADO.DUP_LOTE:  return { bg: PALETTE.duplicado, fg: PALETTE.duplicadoTx };
    case ESTADO.REVISAR:   return { bg: PALETTE.revisar,   fg: PALETTE.revisarTx };
    case ESTADO.SIN_ID:    return { bg: PALETTE.sinId,     fg: PALETTE.sinIdText };
    default:               return { bg: '#FFFFFF',         fg: '#000000' };
  }
}

/**
 * Crea/recrea la hoja "<Banco> · Mayor Nuevo" con el resultado del análisis.
 * Devuelve el nombre de la hoja creada.
 */
function writeMayorNuevoSheet_(ss, cfg, rows, analysis) {
  var sheetName = cfg.label + ' · ' + MAYOR_NUEVO_SHEET;
  var sheet = ss.getSheetByName(sheetName);
  if (sheet) sheet.clear(); else sheet = ss.insertSheet(sheetName);
  sheet.setHiddenGridlines(true);

  var COLS = 6; // Estado | Fecha | Glosa | Importe | ID de Cobro | Nota
  var conteo = countByEstado_(rows);

  // ---- Bloque de título / resumen -----------------------------------------
  sheet.getRange(1, 1, 1, COLS).merge()
    .setValue('CONCILIADOR ' + cfg.label.toUpperCase() + '  ·  MAYOR NUEVO')
    .setBackground(PALETTE.header).setFontColor(PALETTE.headerText)
    .setFontSize(14).setFontWeight('bold')
    .setHorizontalAlignment('left').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 34);

  var resumen = 'Tipo: ' + cfg.tipoOperacion +
    '   |   Total: ' + rows.length +
    '   |   Nuevos: ' + (conteo[ESTADO.NUEVO] || 0) +
    '   |   Duplicados: ' + ((conteo[ESTADO.DUPLICADO] || 0) + (conteo[ESTADO.DUP_LOTE] || 0)) +
    '   |   Revisar: ' + (conteo[ESTADO.REVISAR] || 0) +
    '   |   Sin ID: ' + (conteo[ESTADO.SIN_ID] || 0);
  sheet.getRange(2, 1, 1, COLS).merge()
    .setValue(resumen).setBackground('#EAF1F6').setFontColor('#0B3D5C')
    .setFontWeight('bold').setVerticalAlignment('middle');
  sheet.setRowHeight(2, 26);

  // Mensajes del análisis específico del banco.
  var msgs = (analysis && analysis.mensajes) ? analysis.mensajes : [];
  sheet.getRange(3, 1, 1, COLS).merge()
    .setValue(msgs.length ? '• ' + msgs.join('    • ') : '')
    .setFontColor('#5F6368').setWrap(true).setVerticalAlignment('middle');
  sheet.setRowHeight(3, Math.max(24, 16 * Math.ceil(msgs.join('    ').length / 90)));

  // ---- Encabezado de la tabla ----------------------------------------------
  var headerRow = 5;
  var headers = ['Estado', 'Fecha', 'Glosa', 'Importe', 'ID de Cobro', 'Nota / Motivo'];
  sheet.getRange(headerRow, 1, 1, COLS).setValues([headers])
    .setBackground(PALETTE.header).setFontColor(PALETTE.headerText)
    .setFontWeight('bold').setHorizontalAlignment('center');
  sheet.setFrozenRows(headerRow);

  // ---- Filas ----------------------------------------------------------------
  if (rows.length) {
    var data = rows.map(function (r) {
      var glosa = r.glosa + (r.glosa2 ? ' — ' + r.glosa2 : '');
      return [r.estado, r.fecha, glosa, r.importe, r.key || '(sin ID)', r.nota || ''];
    });
    var start = headerRow + 1;
    var body = sheet.getRange(start, 1, data.length, COLS);
    body.setValues(data);

    // Formato de columnas.
    sheet.getRange(start, 4, data.length, 1).setNumberFormat('$ #,##0');
    body.setVerticalAlignment('middle');

    // Colorea por estado + zebra sutil en las columnas neutras.
    var bgEstado = [], fgEstado = [];
    rows.forEach(function (r) {
      var c = colorsForEstado_(r.estado);
      bgEstado.push([c.bg]); fgEstado.push([c.fg]);
    });
    sheet.getRange(start, 1, data.length, 1)
      .setBackgrounds(bgEstado).setFontColors(fgEstado).setFontWeight('bold')
      .setHorizontalAlignment('center');

    // Bordes suaves.
    body.setBorder(true, true, true, true, true, true, PALETTE.border, SpreadsheetApp.BorderStyle.SOLID);
  }

  // ---- Ancho de columnas ----------------------------------------------------
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 95);
  sheet.setColumnWidth(3, 340);
  sheet.setColumnWidth(4, 120);
  sheet.setColumnWidth(5, 130);
  sheet.setColumnWidth(6, 320);

  // Deja la hoja activa para que el usuario la vea.
  ss.setActiveSheet(sheet);
  return sheetName;
}

/**
 * Reconstruye la "Hoja de Trabajo" mejorada visualmente, tomando como fuente
 * la última hoja "Mayor Nuevo" generada (o la que esté activa). Agrupa por
 * estado y deja arriba lo accionable (NUEVO y REVISAR).
 */
function reconstructWorksheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getActiveSheet();
  var ui = SpreadsheetApp.getUi();
  if (!/Mayor Nuevo/i.test(src.getName())) {
    ui.alert('Hoja de Trabajo',
      'Primero abre (o genera) una hoja "Mayor Nuevo" y vuelve a ejecutar esta acción sobre ella.',
      ui.ButtonSet.OK);
    return;
  }

  var values = src.getDataRange().getValues();
  // Localiza la fila de encabezado de la tabla ("Estado ... Nota").
  var hIdx = -1;
  for (var i = 0; i < values.length; i++) {
    if (normText(values[i][0]) === 'estado') { hIdx = i; break; }
  }
  if (hIdx < 0) { ui.alert('No encontré la tabla de estados en esta hoja.'); return; }

  var body = values.slice(hIdx + 1).filter(function (r) {
    return r[0] !== '' && r[0] !== null;
  });

  // Orden accionable: REVISAR, NUEVO, SIN ID, DUP EN LOTE, DUPLICADO.
  var orden = {};
  orden[ESTADO.REVISAR] = 0; orden[ESTADO.NUEVO] = 1; orden[ESTADO.SIN_ID] = 2;
  orden[ESTADO.DUP_LOTE] = 3; orden[ESTADO.DUPLICADO] = 4;
  body.sort(function (a, b) {
    return (orden[a[0]] == null ? 9 : orden[a[0]]) - (orden[b[0]] == null ? 9 : orden[b[0]]);
  });

  var name = HOJA_TRABAJO_SHEET;
  var out = ss.getSheetByName(name);
  if (out) out.clear(); else out = ss.insertSheet(name);
  out.setHiddenGridlines(true);

  var COLS = 6;
  out.getRange(1, 1, 1, COLS).merge()
    .setValue('HOJA DE TRABAJO — ' + src.getName())
    .setBackground(PALETTE.header).setFontColor(PALETTE.headerText)
    .setFontSize(14).setFontWeight('bold').setVerticalAlignment('middle');
  out.setRowHeight(1, 34);

  var headers = ['Estado', 'Fecha', 'Glosa', 'Importe', 'ID de Cobro', 'Nota / Motivo'];
  out.getRange(3, 1, 1, COLS).setValues([headers])
    .setBackground(PALETTE.header).setFontColor(PALETTE.headerText)
    .setFontWeight('bold').setHorizontalAlignment('center');
  out.setFrozenRows(3);

  if (body.length) {
    out.getRange(4, 1, body.length, COLS).setValues(body).setVerticalAlignment('middle');
    out.getRange(4, 4, body.length, 1).setNumberFormat('$ #,##0');
    var bg = [], fg = [];
    body.forEach(function (r) {
      var c = colorsForEstado_(r[0]);
      bg.push([c.bg]); fg.push([c.fg]);
    });
    out.getRange(4, 1, body.length, 1)
      .setBackgrounds(bg).setFontColors(fg).setFontWeight('bold')
      .setHorizontalAlignment('center');
    out.getRange(4, 1, body.length, COLS)
      .setBorder(true, true, true, true, true, true, PALETTE.border, SpreadsheetApp.BorderStyle.SOLID);
  }

  out.setColumnWidth(1, 110); out.setColumnWidth(2, 95); out.setColumnWidth(3, 340);
  out.setColumnWidth(4, 120); out.setColumnWidth(5, 130); out.setColumnWidth(6, 320);
  ss.setActiveSheet(out);
  ui.alert('Hoja de Trabajo', 'Se generó "' + name + '" con ' + body.length + ' movimientos ordenados por prioridad.', ui.ButtonSet.OK);
}
