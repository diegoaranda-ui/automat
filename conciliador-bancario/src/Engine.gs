/**
 * Engine.gs
 * -----------------------------------------------------------------------------
 * Motor de conciliación / deduplicación. Es agnóstico al banco: recibe la
 * config del banco (Config.gs) y funciones de extracción (Parser.gs) y produce:
 *   1) un índice de lo YA cargado en el conciliador (por ID de Cobro / llave),
 *   2) la clasificación de cada fila entrante: NUEVO / DUPLICADO / REVISAR / SIN_ID,
 *   3) la hoja "Mayor Nuevo" con el resultado, visualmente mejorada.
 * -----------------------------------------------------------------------------
 */

// Estados posibles de una fila entrante.
var ESTADO = {
  NUEVO:      'NUEVO',        // no existe -> se puede cargar
  DUPLICADO:  'DUPLICADO',    // ya está cargado (misma llave, mismo monto)
  REVISAR:    'REVISAR',      // misma llave pero monto/fecha distinta -> incongruencia
  SIN_ID:     'SIN ID',       // no se pudo obtener ID de Cobro -> revisar manual
  DUP_LOTE:   'DUP EN LOTE'   // duplicado dentro de la misma cartola pegada
};

/**
 * Punto de entrada llamado desde la sidebar.
 * @param {string} bankKey  key del banco (BCI, Santander, ...).
 * @param {string} rawText  cartola del mayor pegada por el usuario.
 * @return {Object} resumen para mostrar en la UI.
 */
function procesarCartola(bankKey, rawText) {
  var cfg = getBankConfig(bankKey);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var matrix = parseRawToMatrix(rawText);
  if (!matrix.length) {
    throw new Error('No se detectaron filas en la cartola pegada.');
  }
  // Descarta fila de encabezado si el usuario la incluyó.
  if (looksLikeHeader_(matrix[0])) matrix = matrix.slice(1);
  if (!matrix.length) {
    throw new Error('La cartola sólo contenía encabezados, sin movimientos.');
  }

  var rows = buildRows_(matrix, cfg);
  var existing = collectExistingKeys_(ss, cfg);
  classifyRows_(rows, existing);

  // Análisis específico del banco (mensajes de cara al usuario).
  var analysis = dispatchAnalyze_(cfg, rows, existing);

  // Escribe la hoja "Mayor Nuevo" (prefijada por banco).
  var sheetName = writeMayorNuevoSheet_(ss, cfg, rows, analysis);

  return {
    banco: cfg.label,
    tipoOperacion: cfg.tipoOperacion,
    totalFilas: rows.length,
    conteo: countByEstado_(rows),
    analisis: analysis,
    hoja: sheetName
  };
}

/** Mapea la matriz cruda a filas normalizadas con su llave calculada. */
function buildRows_(matrix, cfg) {
  var c = cfg.columns;
  return matrix.map(function (cells, i) {
    var rowText = cells.join(' ');
    var idText = (c.idCobro != null ? cells[c.idCobro] : '') || '';
    var glosa = (c.glosa != null ? cells[c.glosa] : '') || '';
    var glosa2 = (c.glosa2 != null ? cells[c.glosa2] : '') || '';
    var row = {
      idx: i,
      fecha: normalizeDate(c.fecha != null ? cells[c.fecha] : ''),
      glosa: glosa,
      glosa2: glosa2,
      importe: parseAmount(c.importe != null ? cells[c.importe] : ''),
      idText: idText,
      dc: (c.debitoCredito != null ? cells[c.debitoCredito] : '') || '',
      raw: cells
    };
    var kk = keyForRow_(row, cfg, rowText);
    row.key = kk.key;
    row.keyType = kk.keyType;
    return row;
  });
}

/**
 * Calcula la llave de conciliación/deduplicación de una fila según la
 * estrategia del banco. Devuelve {key, keyType}. key === '' significa
 * "no se pudo obtener ID".
 */
function keyForRow_(row, cfg, rowText) {
  var text = rowText || [row.idText, row.glosa, row.glosa2].join(' ');
  switch (cfg.keyStrategy) {
    case 'payId': {
      var pay = extractPayId(row.idText) || extractPayId(text);
      return { key: pay, keyType: 'payId' };
    }
    case 'dlocal': {
      var ref = extractDlocalRef(row.idText) || extractDlocalRef(text);
      return { key: ref, keyType: 'dlocal' };
    }
    case 'remuneracion': {
      var rut = extractRut(row.glosa2) || extractRut(row.glosa) || extractRut(text);
      var period = (row.fecha || '').slice(0, 7); // yyyy-mm
      if (rut) return { key: rut + '|' + period, keyType: 'rut+periodo' };
      // Sin RUT: hash de beneficiario + período + monto.
      return {
        key: hashKey_(normText(row.glosa) + '|' + period + '|' + row.importe),
        keyType: 'hash'
      };
    }
    case 'auto':
    default: {
      var p = extractPayId(row.idText) || extractPayId(text);
      if (p) return { key: p, keyType: 'payId' };
      var d = extractDlocalRef(row.idText);
      if (d) return { key: d, keyType: 'dlocal' };
      // Fallback: hash fecha+monto+glosa.
      return {
        key: hashKey_(row.fecha + '|' + row.importe + '|' + normText(row.glosa)),
        keyType: 'hash'
      };
    }
  }
}

/**
 * Escanea TODAS las hojas del conciliador para saber qué llaves ya están
 * cargadas. Detecta bloques por su fila de encabezado (Fecha + Importe + un
 * encabezado de ID del banco) y usa el mismo extractor de llave del banco.
 * Devuelve { key -> [{amount, date, sheet, row}] }.
 */
function collectExistingKeys_(ss, cfg) {
  var index = {};
  var skip = {};
  skip[MAYOR_NUEVO_SHEET] = true;

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    // No indexar hojas de resultado generadas por la herramienta.
    if (skip[name] || /Mayor Nuevo/i.test(name)) return;
    var rng = sheet.getDataRange();
    if (rng.getNumRows() < 2) return;
    var values = rng.getValues();

    var blocks = findBlocks_(values, cfg);
    blocks.forEach(function (b) {
      for (var r = b.start; r < b.end; r++) {
        var cells = values[r];
        var isEmpty = cells.every(function (x) { return x === '' || x === null; });
        if (isEmpty) continue;
        var idText = b.idCol != null ? cells[b.idCol] : '';
        var rowText = cells.join(' ');
        var kk = keyForRow_({
          idText: idText,
          glosa: b.glosaCol != null ? cells[b.glosaCol] : '',
          glosa2: '',
          fecha: normalizeDate(b.dateCol != null ? cells[b.dateCol] : ''),
          importe: parseAmount(b.amtCol != null ? cells[b.amtCol] : '')
        }, cfg, rowText);
        if (!kk.key) continue;
        (index[kk.key] = index[kk.key] || []).push({
          amount: parseAmount(b.amtCol != null ? cells[b.amtCol] : ''),
          date: normalizeDate(b.dateCol != null ? cells[b.dateCol] : ''),
          sheet: name,
          row: r + 1
        });
      }
    });
  });
  return index;
}

/**
 * Detecta bloques de datos dentro de una hoja a partir de sus encabezados.
 * Un encabezado es una fila que contiene "Fecha" e "Importe/Monto".
 * Devuelve [{start,end,dateCol,amtCol,idCol,glosaCol}] (start/end 0-based, end
 * exclusivo = hasta el siguiente encabezado o fin de hoja).
 */
function findBlocks_(values, cfg) {
  var idHeaders = (cfg.idHeaders || []).map(normText);
  var headerRows = [];
  for (var r = 0; r < values.length; r++) {
    var normCells = values[r].map(function (x) { return normText(x); });
    var hasFecha = normCells.some(function (x) { return x === 'fecha'; });
    var hasImporte = normCells.some(function (x) {
      return x === 'importe' || x === 'monto' || x === 'abono' || x === 'cargo';
    });
    if (hasFecha && hasImporte) {
      headerRows.push({ row: r, cells: normCells });
    }
  }
  return headerRows.map(function (h, i) {
    var next = (i + 1 < headerRows.length) ? headerRows[i + 1].row : values.length;
    return {
      start: h.row + 1,
      end: next,
      dateCol: firstIndexOf_(h.cells, ['fecha']),
      amtCol: firstIndexOf_(h.cells, ['importe', 'monto', 'abono', 'cargo']),
      idCol: firstIndexOf_(h.cells, idHeaders),
      glosaCol: firstIndexOf_(h.cells, ['concepto', 'glosa', 'documento', 'detalle', 'nombre'])
    };
  });
}

function firstIndexOf_(normCells, candidates) {
  for (var i = 0; i < normCells.length; i++) {
    if (candidates.indexOf(normCells[i]) > -1) return i;
  }
  return null;
}

/**
 * Clasifica cada fila entrante contra el índice de lo ya cargado y contra
 * las demás filas del mismo lote.
 */
function classifyRows_(rows, existingIndex) {
  var seenInBatch = {};
  rows.forEach(function (row) {
    if (!row.key) { row.estado = ESTADO.SIN_ID; row.nota = 'No se pudo obtener ID de Cobro'; return; }

    // Duplicado dentro del mismo lote pegado.
    if (seenInBatch[row.key]) {
      var prev = seenInBatch[row.key];
      row.estado = ESTADO.DUP_LOTE;
      row.nota = 'Repetido en la misma cartola (fila ' + (prev.idx + 1) + ')';
      return;
    }
    seenInBatch[row.key] = row;

    var hits = existingIndex[row.key];
    if (!hits || !hits.length) {
      row.estado = ESTADO.NUEVO;
      row.nota = 'No existe en el conciliador';
      return;
    }
    // La llave ya existe: ¿mismo monto? -> DUPLICADO; si no -> REVISAR.
    var sameAmount = hits.some(function (h) {
      return montosIguales_(h.amount, row.importe);
    });
    if (sameAmount) {
      row.estado = ESTADO.DUPLICADO;
      row.nota = 'Ya cargado en ' + hits[0].sheet + ' (fila ' + hits[0].row + ')';
    } else {
      row.estado = ESTADO.REVISAR;
      row.nota = 'Mismo ID pero monto distinto (existe $' +
        formatCLP_(hits[0].amount) + ' en ' + hits[0].sheet + ')';
    }
  });
}

function montosIguales_(a, b) {
  if (isNaN(a) || isNaN(b)) return false;
  return Math.abs(a - b) < 1; // tolerancia de $1 por redondeo
}

function countByEstado_(rows) {
  var c = {};
  Object.keys(ESTADO).forEach(function (k) { c[ESTADO[k]] = 0; });
  rows.forEach(function (r) { c[r.estado] = (c[r.estado] || 0) + 1; });
  return c;
}

/**
 * Llama a la función de análisis específica del banco. Se usa un mapa explícito
 * (referencias hoisted) para no depender del binding de `this` en Apps Script.
 */
function dispatchAnalyze_(cfg, rows, existingIndex) {
  var registry = {
    BCI_analyze: BCI_analyze,
    Santander_analyze: Santander_analyze,
    Scotiabank_analyze: Scotiabank_analyze,
    ITAU_analyze: ITAU_analyze,
    BancoInternacional_analyze: BancoInternacional_analyze
  };
  var fn = registry[cfg.analyze];
  if (typeof fn === 'function') {
    return fn(cfg, rows, existingIndex);
  }
  // Fallback genérico si el banco no define análisis propio.
  return { titulo: cfg.label, mensajes: ['Análisis genérico.'] };
}
