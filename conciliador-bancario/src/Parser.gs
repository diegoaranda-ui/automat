/**
 * Parser.gs
 * -----------------------------------------------------------------------------
 * Utilidades de parseo y normalización de la cartola pegada por el usuario.
 * Todo lo que sea "entender el texto crudo" vive aquí; el motor (Engine.gs)
 * sólo consume filas ya normalizadas.
 * -----------------------------------------------------------------------------
 */

/**
 * Convierte texto pegado (CSV / TSV / copiado desde Sheets) en una matriz.
 * Detecta el delimitador automáticamente: tab, ; o ,.
 */
function parseRawToMatrix(rawText) {
  if (!rawText || !rawText.trim()) return [];
  var text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var lines = text.split('\n').filter(function (l) { return l.trim() !== ''; });
  if (!lines.length) return [];

  var delim = detectDelimiter_(lines[0]);
  return lines.map(function (line) {
    return splitLine_(line, delim).map(function (c) { return c.trim(); });
  });
}

function detectDelimiter_(sampleLine) {
  var counts = {
    '\t': (sampleLine.match(/\t/g) || []).length,
    ';':  (sampleLine.match(/;/g) || []).length,
    ',':  (sampleLine.match(/,/g) || []).length
  };
  var best = '\t', bestN = -1;
  Object.keys(counts).forEach(function (d) {
    if (counts[d] > bestN) { bestN = counts[d]; best = d; }
  });
  // Si no hay separadores claros, asumimos tab (copia desde Sheets).
  return bestN <= 0 ? '\t' : best;
}

/** Split respetando comillas dobles simples de CSV. */
function splitLine_(line, delim) {
  if (delim !== ',') return line.split(delim);
  var out = [], cur = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * ¿Esta fila parece un encabezado? (contiene "Fecha" e "Importe", etc.)
 * Sirve para descartar la fila de títulos si el usuario la pega.
 */
function looksLikeHeader_(cells) {
  var joined = cells.join(' ').toLowerCase();
  return /fecha/.test(joined) && /(importe|monto|abono|cargo)/.test(joined);
}

/**
 * Normaliza un monto. Soporta dos formatos, seleccionables con `fmt`:
 *   - 'clp' : formato chileno de texto  "4.711.920" -> 4711920, "1.234,56" -> 1234.56
 *   - 'us'  : formato estándar / NetSuite "7812548.0", "5.6530906E7" (científico),
 *             "1.0E8" -> 100000000, comas de miles opcionales.
 *   - 'auto' (default): si trae notación científica o una sola coma decimal lo
 *             trata como 'us'; si trae múltiples puntos lo trata como 'clp'.
 * Acepta paréntesis o signo menos para negativos. Devuelve número o NaN.
 */
function parseAmount(raw, fmt) {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'number') return raw;
  var s = String(raw).trim();
  if (!s) return NaN;
  fmt = fmt || 'auto';

  var negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '').replace(/\$/g, '').replace(/CLP/gi, '').replace(/\s/g, '').trim();
  if (s.charAt(0) === '-') { negative = true; s = s.slice(1); }

  var n;
  var hasExp = /[eE]/.test(s);
  if (fmt === 'us' || (fmt === 'auto' && hasExp)) {
    // Punto = decimal; comas = miles.
    n = Number(s.replace(/,/g, ''));
  } else if (fmt === 'clp') {
    n = s.indexOf(',') > -1 ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
                            : parseFloat(s.replace(/\./g, ''));
  } else { // auto sin notación científica
    if (s.indexOf(',') > -1) {
      n = parseFloat(s.replace(/\./g, '').replace(',', '.')); // coma decimal es-CL
    } else {
      // Sólo puntos: los tratamos como separadores de miles (caso conciliador CL).
      n = parseFloat(s.replace(/\./g, ''));
    }
  }
  if (isNaN(n)) return NaN;
  return negative ? -n : n;
}

/**
 * Normaliza una fecha a "yyyy-mm-dd" (string estable para comparar). Soporta
 * dd/mm/yyyy, dd-mm-yyyy, ISO "2026-05-14T00:00:00.000" y objetos Date.
 * Si no matchea, devuelve el texto original recortado.
 */
function normalizeDate(raw) {
  if (raw === null || raw === undefined) return '';
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    return Utilities.formatDate(raw, 'America/Santiago', 'yyyy-MM-dd');
  }
  var s = String(raw).trim();
  // ISO / NetSuite: 2026-05-14T00:00:00.000 -> 2026-05-14
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    var d = ('0' + m[1]).slice(-2);
    var mo = ('0' + m[2]).slice(-2);
    var y = m[3].length === 2 ? '20' + m[3] : m[3];
    return y + '-' + mo + '-' + d;
  }
  return s;
}

/**
 * Extrae un ID de Cobro tipo PAY-XXXXXX de un texto. Devuelve normalizado
 * "PAY-146419" o '' si no hay.
 */
function extractPayId(text) {
  if (!text) return '';
  var m = String(text).match(/PAY[\s\-_]?0*?(\d{3,})/i);
  return m ? 'PAY-' + m[1] : '';
}

/**
 * Extrae una referencia DLOCAL / reserva. Busca "DLOCAL" seguido de dígitos,
 * o un token alfanumérico largo que parezca referencia. Devuelve '' si no hay.
 */
function extractDlocalRef(text) {
  if (!text) return '';
  var s = String(text);
  var m = s.match(/DLOCAL[\s\-_#:]*([A-Z0-9\-]{4,})/i);
  if (m) return 'DLOCAL-' + m[1].toUpperCase();
  // Fallback: PAY-ID también puede venir en reservas.
  var pay = extractPayId(s);
  if (pay) return pay;
  // Token de referencia largo (>=8 alfanuméricos).
  var t = s.match(/\b([A-Z0-9]{8,})\b/i);
  return t ? t[1].toUpperCase() : '';
}

/** Normaliza texto para llaves/hashes: minúsculas, sin acentos ni dobles espacios. */
function normText(s) {
  if (!s) return '';
  var map = { 'á':'a','é':'e','í':'i','ó':'o','ú':'u','ü':'u','ñ':'n',
              'à':'a','è':'e','ì':'i','ò':'o','ù':'u' };
  return String(s)
    .toLowerCase()
    .replace(/[áéíóúüñàèìòù]/g, function (c) { return map[c] || c; })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrae un RUT chileno normalizado (sin puntos, con guión) o ''. */
function extractRut(text) {
  if (!text) return '';
  var m = String(text).match(/(\d{1,2}\.?\d{3}\.?\d{3})[\-\s]?([0-9kK])/);
  if (!m) return '';
  return m[1].replace(/\./g, '') + '-' + m[2].toUpperCase();
}

/** Hash simple y estable de una cadena (fallback de deduplicación). */
function hashKey_(str) {
  var h = 0, s = String(str);
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return 'H' + (h >>> 0).toString(36);
}
