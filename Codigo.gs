/**
 * Kavak Finanzas Tools — Apps Script Web App
 */

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'hub';
  const validPages = ['hub', 'finanzas'];
  const target = validPages.includes(page) ? page : 'hub';
  const tab = (e && e.parameter && e.parameter.tab) ? String(e.parameter.tab) : '';
  return buildPage(target, tab);
}

function buildPage(name, tab) {
  const template = HtmlService.createTemplateFromFile(name);
  template.VERSION     = '1.1.0';
  template.ACTIVE_PAGE = name;
  template.BASE_URL    = ScriptApp.getService().getUrl();
  // El sandbox de HtmlService no expone la query string al JS del cliente,
  // así que el tab activo se inyecta server-side (solo minúsculas, anti-inyección).
  template.ACTIVE_TAB  = /^[a-z]{1,30}$/.test(tab || '') ? tab : '';
  return template.evaluate()
    .setTitle('Kavak Finanzas Tools')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
  try {
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      muteHttpExceptions: true
    });
    return JSON.stringify({ status: res.getResponseCode(), body: res.getContentText() });
  } catch (err) {
    // Errores de transporte (red, timeout, payload demasiado grande) también
    // vuelven en el sobre {status, body} para que el cliente los muestre/reintente.
    return JSON.stringify({ status: 529, body: JSON.stringify({ error: { type: 'fetch_error', message: 'Error de red al llamar a la API: ' + String(err) } }) });
  }
}

// Planilla de papel de trabajo de conciliaciones
var CONCIL_SHEET_ID = '1p3TYuzbwMw1Iijd07lTpsJMM_e73VUmnIlBkeM57Txc';

// Papel de trabajo FINAL del Banco Internacional (1101-05): archivo aparte con
// hojas "Extracto" y "Mayor" y la columna K "Referencia" donde el agente
// escribe "diego" para los cruces con diferencia $0. Override: PAPEL_FINAL_SHEET_ID.
var PAPEL_FINAL_SHEET_ID = '1Y9YwGl14yDaNBINNwsCaJtmPKVCn5qjjHl9odqZV_OQ';

// Planilla de Control de Provisiones (facturas de proveedores vs provisiones)
var PROVISIONES_SHEET_ID = '1oOWGLYN7X28lennVGvp58n1LXmjU8-MoltVj7GeSIaU';

// Planilla del equipo "2801-01 Impuesto transferencia" — el análisis ICAR se
// escribe ahí, en la pestaña "Análisis ICAR" (no se toca ninguna otra pestaña)
var ICAR_SHEET_ID = '1D1SleLGZccIgXhVQ1TE99W1fllQsLgZkw8nGVO2ArEE';

/**
 * Escribe (sobreescribe) la pestaña "Análisis ICAR" de la planilla de
 * impuesto transferencia con el resultado del cruce por Stock ID.
 * payload: { analista, fecha, hora, saldoCuenta, sumFact, sumNC, sumDesc,
 *   nMovs, nStocks, ok, negRegistrado,
 *   pendiente: {n, monto, items:[{st,patente,mesVenta,fact,nc,desc,saldo}]},
 *   negPorRegistrar: {n, monto, items:[...]},
 *   pivot: {mes: {pendiente, pendienteN, negativo, negativoN}},
 *   resumen, notas_auditoria }
 */
function writeIcarSheet(payload) {
  const p = (typeof payload === 'string') ? JSON.parse(payload) : (payload || {});
  const ssId = PropertiesService.getScriptProperties().getProperty('ICAR_SHEET_ID') || ICAR_SHEET_ID;
  const ss   = SpreadsheetApp.openById(ssId);

  let sh = ss.getSheetByName('Análisis ICAR');
  if (!sh) sh = ss.insertSheet('Análisis ICAR');
  else {
    sh.clearContents();
    sh.clearFormats();
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
    sh.setConditionalFormatRules([]);
    sh.getBandings().forEach(function(b){ b.remove(); });
    if (sh.getFilter()) sh.getFilter().remove();
  }

  const NCOLS = 9;
  function fmtM(v) { return (parseFloat(v) || 0).toLocaleString('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 }); }
  function pad(arr) { while (arr.length < NCOLS) arr.push(''); return arr; }
  const rows = [], marks = [];
  function push(arr, kind) { rows.push(pad(arr)); if (kind) marks.push({ r: rows.length, kind: kind }); }

  push(['ANÁLISIS IMPUESTO TRANSFERENCIA (ICAR) — cuenta 2801-01  ·  Kavak Finanzas Chile'], 'title');
  push(['Analista: ' + (p.analista || 'Anónimo'), 'Fecha análisis: ' + (p.fecha || '') + ' ' + (p.hora || ''),
    'Período: ' + (p.periodo || '—'), 'Saldo cuenta: ' + fmtM(p.saldoCuenta), 'Vehículos: ' + (p.nStocks || 0), 'Movimientos: ' + (p.nMovs || 0)], 'meta');
  push([]);

  // Cuadratura
  push(['CUADRATURA DEL SALDO'], 'sec-dark');
  push(['Facturado a clientes', 'Notas de crédito', 'Diarios (descuentos/pérdidas)', 'SALDO CUENTA', 'Veh. ok', 'Pérdida ya registrada (veh.)'], 'colhead');
  push([p.sumFact || 0, p.sumNC || 0, p.sumDesc || 0, p.saldoCuenta || 0, p.ok || 0, p.negRegistrado || 0], 'row-money4');
  push([]);

  // Pivot por mes
  const pivot = p.pivot || {};
  push(['DESCUADRES POR MES DE VENTA'], 'sec-dark');
  push(['Mes de venta', 'Facturado sin descontar', 'Veh.', 'Resultado negativo', 'Veh.', '', '', ''], 'colhead');
  Object.keys(pivot).sort().forEach(function(m) {
    const v = pivot[m];
    push([m, v.pendiente || 0, v.pendienteN || 0, Math.abs(v.negativo || 0), v.negativoN || 0, '', '', ''], 'row-pivot');
  });
  push([]);

  // Notas y resumen
  const notas = p.notas_auditoria || [];
  push(['NOTAS PARA AUDITORÍA (' + notas.length + ')'], 'sec-purple');
  notas.forEach(function(n, i) { push([(i + 1) + '. ' + n], 'row-nota'); });
  push([]);
  push(['RESUMEN'], 'sec-gray');
  push([p.resumen || ''], 'row-resumen');
  push([]);

  // ── DETALLE DE DESCUADRES POR VEHÍCULO (tabla filtrable, al final) ──
  // Unifica 'por registrar' (saldo negativo: descontado de más) y 'sin
  // descontar' (saldo positivo: facturado y ICAR aún no descuenta). Una sola
  // tabla con columna Situación + filtro nativo: se puede analizar por
  // Diferencia, por Descontado = 0 (no está el imp. de ICAR), por Situación, etc.
  const neg  = p.negPorRegistrar || { n: 0, monto: 0, items: [] };
  const pend = p.pendiente || { n: 0, monto: 0, items: [] };
  const detalle = [];
  (neg.items || []).forEach(function(o){ detalle.push({ o: o, sit: '🎯 Por registrar' }); });
  (pend.items || []).forEach(function(o){ detalle.push({ o: o, sit: '⏳ Sin descontar' }); });
  detalle.sort(function(a, b){ return Math.abs(b.o.saldo || 0) - Math.abs(a.o.saldo || 0); });

  push(['DETALLE DE DESCUADRES POR VEHÍCULO — ' + detalle.length + ' vehículo(s) · usa el filtro de la fila de títulos'], 'sec-red');
  push(['Fecha', 'Stock ID', 'Patente', 'Mes venta', 'Situación', 'Facturado', 'Descontado', 'Diferencia', 'Estado (Sí/No)'], 'colhead');
  const detHeaderRow = rows.length;          // fila del encabezado con filtro
  detalle.forEach(function(d) {
    const o = d.o;
    push([o.fecha || '—', o.st, o.patente || '—', o.mesVenta || 'Revisar fin de mes', d.sit,
      Math.abs((o.fact || 0) + (o.nc || 0)), Math.abs(o.desc || 0), Math.abs(o.saldo || 0), ''], 'row-det');
  });
  if (!detalle.length) push(['✓ Sin descuadres: la cuenta está cruzada.'], 'row-ok');
  const detLastRow = rows.length;

  sh.getRange(1, 1, rows.length, NCOLS).setValues(rows);

  marks.forEach(function(mk) {
    const R = sh.getRange(mk.r, 1, 1, NCOLS);
    switch (mk.kind) {
      case 'title':
        R.merge().setBackground('#000000').setFontColor('#ffffff').setFontWeight('bold').setFontSize(13).setVerticalAlignment('middle');
        sh.setRowHeight(mk.r, 38); break;
      case 'meta':
        R.setBackground('#f4f4f5').setFontColor('#3f3f46').setFontSize(10); break;
      case 'sec-dark':
        R.merge().setBackground('#18181b').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
        sh.setRowHeight(mk.r, 30); break;
      case 'sec-red':
        R.merge().setBackground('#dc1a23').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
        sh.setRowHeight(mk.r, 30); break;
      case 'sec-gray':
        R.merge().setBackground('#e4e4e7').setFontColor('#3f3f46').setFontWeight('bold').setFontSize(11); break;
      case 'sec-purple':
        R.merge().setBackground('#7c3aed').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11); break;
      case 'colhead':
        R.setBackground('#27272a').setFontColor('#e4e4e7').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center'); break;
      case 'row-money4':
        R.setFontSize(10).setFontWeight('bold');
        sh.getRange(mk.r, 1, 1, 4).setNumberFormat('$ #,##0').setHorizontalAlignment('right'); break;
      case 'row-det':
        R.setFontSize(10);
        sh.getRange(mk.r, 6, 1, 3).setNumberFormat('$ #,##0').setHorizontalAlignment('right');
        sh.getRange(mk.r, 8, 1, 1).setFontWeight('bold').setFontColor('#b01019'); break;
      case 'row-pivot':
        R.setFontSize(10);
        sh.getRange(mk.r, 2, 1, 1).setNumberFormat('$ #,##0').setHorizontalAlignment('right');
        sh.getRange(mk.r, 4, 1, 1).setNumberFormat('$ #,##0').setHorizontalAlignment('right').setFontColor('#b01019'); break;
      case 'row-ok':
        R.merge().setBackground('#e6f7f0').setFontColor('#0b6b3a').setFontWeight('bold'); break;
      case 'row-nota':
        R.merge().setWrap(true).setBackground('#f5f3ff').setFontColor('#4c1d95').setFontSize(10).setVerticalAlignment('middle');
        sh.setRowHeight(mk.r, 34); break;
      case 'row-resumen':
        R.merge().setWrap(true).setFontColor('#3f3f46').setFontSize(10);
        sh.setRowHeight(mk.r, 80); break;
    }
  });

  sh.setColumnWidth(1, 110); sh.setColumnWidth(2, 95); sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 110); sh.setColumnWidth(5, 130); sh.setColumnWidth(6, 115);
  sh.setColumnWidth(7, 115); sh.setColumnWidth(8, 115); sh.setColumnWidth(9, 120);
  sh.setFrozenRows(1);

  // Filtro nativo sobre la tabla de detalle (encabezado + datos): permite
  // ordenar/filtrar por Diferencia, por Descontado = 0 (no está el imp. ICAR),
  // por Situación, etc. Solo se permite un filtro básico por pestaña.
  if (detLastRow > detHeaderRow) {
    sh.getRange(detHeaderRow, 1, detLastRow - detHeaderRow + 1, NCOLS).createFilter();
  }

  return ss.getUrl() + '#gid=' + sh.getSheetId();
}

/**
 * Agrupador de transferencias sueltas: escribe (sobreescribe) la pestaña
 * "Agrupador" en la planilla de conciliaciones con el extracto sumado por
 * Detalle y su origen en el Mayor. Visuales Kavak + filtro nativo.
 * payload: { analista, fecha, hora, extName, mayName, nExtracto, nMayor,
 *   resumen:{nGrupos,nMulti,nDetalle,nMonto,nSin,totalExtracto},
 *   grupos:[{detalle,n,total,origen,base,dif}] }
 */
/**
 * Lee las hojas "Extracto" y "Mayor" de la planilla de conciliaciones y las
 * devuelve como arrays 2D (con la fila de encabezados). El cruce lo calcula
 * el cliente (finanzas.html) y luego escribe la hoja "Match".
 */
function concilId_() {
  return PropertiesService.getScriptProperties().getProperty('CONCIL_SHEET_ID') || CONCIL_SHEET_ID;
}
function papelFinalId_() {
  return PropertiesService.getScriptProperties().getProperty('PAPEL_FINAL_SHEET_ID') || PAPEL_FINAL_SHEET_ID;
}
// Extrae el ID de una URL de Google Sheets (o devuelve el texto si ya es un ID)
function sheetIdFrom_(s) {
  s = String(s || '').trim();
  var m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : s;
}
function leerConciliadorBanco() {
  var ss = SpreadsheetApp.openById(concilId_());
  function rowsOf(name) {
    var sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 1) return null;
    return sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getDisplayValues();
  }
  var ex = rowsOf('Extracto'), ma = rowsOf('Mayor');
  if (!ex) throw new Error('No encontré la hoja "Extracto" en la planilla (o está vacía).');
  if (!ma) throw new Error('No encontré la hoja "Mayor" en la planilla (o está vacía).');
  return JSON.stringify({ extracto: ex, mayor: ma });
}

// ── Helpers de normalización (versión GAS, para ubicar filas al escribir) ──
function _norm(s){ return String(s||'').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Z0-9ÑÁÉÍÓÚ ]+/g,' ').split(/\s+/).filter(String).join(' ').trim(); }
function _fkey(v){
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getFullYear()*10000+(v.getMonth()+1)*100+v.getDate();
  var s = String(v).trim(), d = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (d) return (+d[1])*10000+(+d[2])*100+(+d[3]);
  d = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (d) return (+d[3])*10000+(+d[2])*100+(+d[1]);
  var n = parseFloat(s.replace(/[^0-9.\-]/g,'')); if (isFinite(n) && n>25569 && n<80000){ var dt=new Date(Math.round((n-25569)*86400*1000)); return dt.getUTCFullYear()*10000+(dt.getUTCMonth()+1)*100+dt.getUTCDate(); }
  return s.toUpperCase();
}
function _montoCL(v){ if (typeof v==='number') return v; var s=String(v==null?'':v).trim(); if(!s) return 0; var neg=/^\(.*\)$/.test(s)||/-/.test(s); s=s.replace(/[^0-9.,]/g,''); if(s.indexOf(',')!==-1) s=s.replace(/\./g,'').replace(',','.'); else s=s.replace(/\./g,''); var n=parseFloat(s)||0; return neg?-Math.abs(n):n; }
function _col(head, names){ for (var i=0;i<names.length;i++){ var b=names[i].toLowerCase(); for(var j=0;j<head.length;j++){ if(String(head[j]||'').toLowerCase().trim()===b) return j; } } for (var k=0;k<names.length;k++){ var b2=names[k].toLowerCase(); for(var m=0;m<head.length;m++){ if(String(head[m]||'').toLowerCase().indexOf(b2)!==-1 && String(head[m]||'')!=='') return m; } } return -1; }

/**
 * "Agente" de referencia: rellena la columna Referencia (K) con "diego" en las
 * hojas Extracto y Mayor del papel de trabajo, SOLO en las filas de los grupos
 * con diferencia 0, respetando la fecha y solo si la celda está vacía.
 * payload: { grupos: [{ norm, fkey, total, origenNorm }] }  (solo dif 0)
 * Devuelve {extracto:<n marcadas>, mayor:<n marcadas>}.
 */
function marcarReferenciaBancoIntl(payload) {
  var p = (typeof payload === 'string') ? JSON.parse(payload) : (payload || {});
  var grupos = p.grupos || [];
  if (!grupos.length) return JSON.stringify({ extracto: 0, mayor: 0, msg: 'No hay grupos con diferencia 0.' });
  // Papel de trabajo final: el que venga en el payload (URL/ID pegada por el
  // analista) o el default PAPEL_FINAL_SHEET_ID.
  var ss = SpreadsheetApp.openById(p.sheetId ? sheetIdFrom_(p.sheetId) : papelFinalId_());
  var REF = 'diego';

  // Índices para búsqueda rápida
  var byNormFecha = {};   // norm|fkey -> true  (extracto)
  var byFecha = {};       // fkey -> [{origenNorm, total}]  (mayor)
  grupos.forEach(function(g) {
    byNormFecha[g.norm + '|' + g.fkey] = true;
    if (!byFecha[g.fkey]) byFecha[g.fkey] = [];
    byFecha[g.fkey].push({ origenNorm: g.origenNorm || '', total: Math.abs(Math.round(g.total)) });
  });

  function refColIdx(head) { var c = _col(head, ['Referencia', 'Referencia ']); return c !== -1 ? c : 10; } // K = índice 10 (0-based)

  var out = { extracto: 0, mayor: 0, log: [] };

  // ── Extracto: marca filas cuyo Detalle+Fecha pertenece a un grupo dif-0 ──
  var she = ss.getSheetByName('Extracto');
  if (she && she.getLastRow() > 1) {
    var ve = she.getRange(1, 1, she.getLastRow(), Math.max(11, she.getLastColumn())).getValues();
    var he = ve[0]; var cDet = _col(he, ['Detalle','Descripción','Descripcion','Glosa','Movimiento']); var cFe = _col(he, ['Fecha','Date']); var cRef = refColIdx(he);
    var updates = [];
    for (var i = 1; i < ve.length; i++) {
      var det = cDet !== -1 ? ve[i][cDet] : '';
      if (!String(det || '').trim()) continue;
      var actual = ve[i][cRef];
      if (actual !== '' && actual != null) continue;                 // solo si K vacía
      var key = _norm(det) + '|' + _fkey(cFe !== -1 ? ve[i][cFe] : '');
      if (byNormFecha[key]) {
        updates.push(i + 1);
        if (out.log.length < 800) out.log.push({ hoja: 'Extracto', fila: i + 1, texto: String(det).slice(0, 60), fecha: cFe !== -1 ? String(ve[i][cFe]) : '' });
      }
    }
    updates.forEach(function(r){ she.getRange(r, cRef + 1).setValue(REF); });
    out.extracto = updates.length;
  }

  // ── Mayor: marca filas del mismo tercero/fecha (o monto+fecha) de un grupo ──
  var shm = ss.getSheetByName('Mayor');
  if (shm && shm.getLastRow() > 1) {
    var vm = shm.getRange(1, 1, shm.getLastRow(), Math.max(11, shm.getLastColumn())).getValues();
    var hm = vm[0]; var cNota = _col(hm, ['Nota','Memo','Memo/Nota','Glosa','Nombre']); var cFm = _col(hm, ['Fecha','Date']);
    var cMon = _col(hm, ['Monto','Importe','Valor']); var cDeb = _col(hm, ['Débito','Debito','Debit']); var cCre = _col(hm, ['Crédito','Credito','Credit']);
    var cRefM = refColIdx(hm);
    var ups = [];
    for (var j = 1; j < vm.length; j++) {
      var actualM = vm[j][cRefM];
      if (actualM !== '' && actualM != null) continue;
      var fk = _fkey(cFm !== -1 ? vm[j][cFm] : '');
      var cands = byFecha[fk]; if (!cands) continue;                 // la fecha DEBE coincidir
      var nota = _norm(cNota !== -1 ? vm[j][cNota] : '');
      var monto = (cMon !== -1 && vm[j][cMon] !== '' && vm[j][cMon] != null) ? _montoCL(vm[j][cMon])
                : ((cDeb !== -1 ? _montoCL(vm[j][cDeb]) : 0) - (cCre !== -1 ? _montoCL(vm[j][cCre]) : 0));
      var am = Math.abs(Math.round(monto));
      var hit = cands.some(function(c){
        if (c.origenNorm && nota && (nota === c.origenNorm || nota.indexOf(c.origenNorm) === 0 || c.origenNorm.indexOf(nota) === 0)) return true;
        return c.total && am === c.total;    // misma fecha + mismo monto
      });
      if (hit) {
        ups.push(j + 1);
        if (out.log.length < 800) out.log.push({ hoja: 'Mayor', fila: j + 1, texto: String(cNota !== -1 ? vm[j][cNota] : '').slice(0, 60), fecha: cFm !== -1 ? String(vm[j][cFm]) : '', monto: Math.round(monto) });
      }
    }
    ups.forEach(function(r){ shm.getRange(r, cRefM + 1).setValue(REF); });
    out.mayor = ups.length;
  }
  return JSON.stringify(out);
}

function writeAgrupadorSheet(payload) {
  var p = (typeof payload === 'string') ? JSON.parse(payload) : (payload || {});
  // La hoja "Match" se escribe en Conciliador_Unico_CL (CONCIL_SHEET_ID),
  // junto a las hojas Extracto/Mayor donde el analista pega los movimientos.
  var ss = SpreadsheetApp.openById(concilId_());
  var sh = ss.getSheetByName('Match');
  if (!sh) sh = ss.insertSheet('Match');
  else {
    sh.clearContents(); sh.clearFormats();
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
    sh.setConditionalFormatRules([]);
    sh.getBandings().forEach(function(b){ b.remove(); });
    if (sh.getFilter()) sh.getFilter().remove();
  }
  var NCOLS = 7;
  function fmtM(v){ return (parseFloat(v) || 0).toLocaleString('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 }); }
  function pad(a){ while (a.length < NCOLS) a.push(''); return a; }
  var rows = [], marks = [];
  function push(a, k){ rows.push(pad(a)); if (k) marks.push({ r: rows.length, kind: k }); }
  var R = p.resumen || {};

  push(['MATCH BANCO INTERNACIONAL — Extracto vs Mayor  ·  Kavak Finanzas Chile'], 'title');
  push(['Analista: ' + (p.analista || 'Anónimo'), 'Fecha: ' + (p.fecha || '') + ' ' + (p.hora || ''),
        'Extracto: ' + (p.nExtracto || 0) + ' movs', 'Mayor: ' + (p.nMayor || 0) + ' movs',
        'Total extracto: ' + fmtM(R.totalExtracto), '', ''], 'meta');
  push([]);
  push(['RESUMEN'], 'sec-dark');
  push(['Grupos (Detalle+Fecha)', 'Con 2+ transf.', 'Match por Nota', 'Match por Fecha+Monto', 'Sin match', '', ''], 'colhead');
  push([R.nGrupos || 0, R.nMulti || 0, R.nNota || 0, R.nFechaMonto || 0, R.nSin || 0, '', ''], 'row-kpi');
  push([]);

  push(['MATCH — Extracto agrupado por Detalle+Fecha vs Mayor · usa el filtro de la fila de títulos'], 'sec-red');
  push(['Detalle (extracto)', 'Fecha', 'N° transf.', 'Total sumado', 'Origen (Nota Mayor)', 'Match por', 'Dif. vs Mayor'], 'colhead');
  var headRow = rows.length;
  (p.grupos || []).forEach(function(g) {
    var base = g.base === 'nota' ? 'nota' : (g.base === 'fecha_monto' ? 'fecha+monto' : (g.base === 'ia' ? ('IA ' + (g.confianza || '')).trim() : 'sin match'));
    var origen = g.origen || (g.pista ? 'posible por monto: ' + g.pista : '—');
    push([g.detalle || '', g.fecha || '', g.n || 0, Math.round(g.total || 0), origen, base, (g.dif == null ? '' : Math.round(g.dif))], 'row-det');
  });
  var lastRow = rows.length;

  sh.getRange(1, 1, rows.length, NCOLS).setValues(rows);
  marks.forEach(function(mk) {
    var Rg = sh.getRange(mk.r, 1, 1, NCOLS);
    switch (mk.kind) {
      case 'title': Rg.merge().setBackground('#000000').setFontColor('#ffffff').setFontWeight('bold').setFontSize(13).setVerticalAlignment('middle'); sh.setRowHeight(mk.r, 38); break;
      case 'meta': Rg.setBackground('#f4f4f5').setFontColor('#3f3f46').setFontSize(10); break;
      case 'sec-dark': Rg.merge().setBackground('#18181b').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11); sh.setRowHeight(mk.r, 28); break;
      case 'sec-red': Rg.merge().setBackground('#dc1a23').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11); sh.setRowHeight(mk.r, 28); break;
      case 'colhead': Rg.setBackground('#27272a').setFontColor('#e4e4e7').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center'); break;
      case 'row-kpi': Rg.setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center').setBackground('#e4e4e7'); break;
      case 'row-det':
        Rg.setFontSize(10);
        sh.getRange(mk.r, 4, 1, 1).setNumberFormat('$ #,##0').setHorizontalAlignment('right').setFontWeight('bold');
        sh.getRange(mk.r, 3, 1, 1).setHorizontalAlignment('right');
        sh.getRange(mk.r, 7, 1, 1).setNumberFormat('$ #,##0').setHorizontalAlignment('right'); break;
    }
  });
  sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 95); sh.setColumnWidth(3, 85); sh.setColumnWidth(4, 125);
  sh.setColumnWidth(5, 230); sh.setColumnWidth(6, 105); sh.setColumnWidth(7, 120);
  sh.setFrozenRows(1);
  if (lastRow > headRow) sh.getRange(headRow, 1, lastRow - headRow + 1, NCOLS).createFilter();
  return ss.getUrl() + '#gid=' + sh.getSheetId();
}

/**
 * Escribe (sobreescribe) la hoja "Provisiones" de la planilla de Control de
 * Provisiones con el resultado del análisis del módulo Provisiones.
 * Llamado desde finanzas.html.
 *
 * payload: {
 *   analista, fecha, hora, cuenta, periodo, mes_cierre,
 *   proveedores: [{nombre, recurrente, meses:{"1":"F"|"P"|"F+P"|"FALTA"|""},
 *                  factura_promedio, meses_falta:[n], provision_sugerida_mensual, comentario}],
 *   total_provision_sugerida, resumen, notas_auditoria: [str],
 *   comparativa: {filas:[{prov,montos:[],delta}], totFact:[], totProv:[]},
 *   otros: [{cuenta,tipo,prov,mes,monto,n}], cuentas: [str]
 * }
 * Escribe la pestaña "Provisiones" y delega tablas/gráficos en "Dashboard".
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
    // clearFormats() NO deshace merges ni borra reglas condicionales:
    // sin esto, los merges de la corrida anterior ocultan datos o rompen merge().
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
    sh.setConditionalFormatRules([]);
    sh.getBandings().forEach(function(b){ b.remove(); });
    if (sh.getFilter()) sh.getFilter().remove();
  }

  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const provs = p.proveedores || [];
  const mesCierre = Math.min(12, Math.max(1, parseInt(p.mes_cierre, 10) || 6));
  const mesDesde = Math.min(mesCierre, Math.max(1, parseInt(p.mes_desde, 10) || 1));
  const nMes = mesCierre - mesDesde + 1;   // cantidad de columnas-mes visibles
  const mesNombre = MESES[mesCierre - 1];

  const header = ['Proveedor', 'Recurrente'];
  for (var m = mesDesde; m <= mesCierre; m++) header.push(MESES[m-1]);
  header.push('Fact. típica', 'Prov. sugerida/mes', 'Comentario');
  const REAL_COLS = Math.max(header.length, nMes + 2); // matriz y comparativa caben

  function fmtMoney(v) {
    const n = parseFloat(v) || 0;
    return n.toLocaleString('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 });
  }
  function pad(arr, len) { while (arr.length < len) arr.push(''); return arr; }

  // Filas + marcas de formato: cada push registra qué tipo de fila es,
  // así el formateo no depende de aritmética manual de offsets.
  const rows = [];
  const marks = [];
  function push(arr, kind) {
    rows.push(pad(arr, REAL_COLS));
    if (kind) marks.push({ r: rows.length, kind: kind });
  }

  // Pendientes: accionables (con actividad reciente) vs revisar vigencia
  // (falta en el cierre pero sin facturar hace meses) vs referencia (previos)
  const pendCierre = [], pendRevisar = [], pendPrevios = [];
  provs.forEach(function(pr) {
    (pr.meses_falta || []).forEach(function(m) {
      // Solo el accionable lleva monto a provisionar; el resto muestra la
      // factura típica como contexto (meses previos se regularizan a fin de año)
      const esAccionable = (m === mesCierre && pr.accionable === true);
      const item = { prov: pr.nombre, mesNum: m, mes: MESES[m-1],
        monto: esAccionable ? (parseFloat(pr.provision_sugerida_mensual) || 0) : (parseFloat(pr.factura_promedio) || 0),
        ultimoF: pr.ultimo_mes_factura || 0 };
      if (m === mesCierre) {
        (esAccionable ? pendCierre : pendRevisar).push(item);
      } else {
        pendPrevios.push(item);
      }
    });
  });
  var totalAccionable = pendCierre.reduce(function(a, x) { return a + x.monto; }, 0);

  // ── Título y metadata ──
  push(['CONTROL DE PROVISIONES — ' + mesNombre + '  ·  Kavak Finanzas Chile'], 'title');
  push([
    'Analista: ' + (p.analista || 'Anónimo'),
    'Fecha análisis: ' + (p.fecha || '') + ' ' + (p.hora || ''),
    'Cuenta: ' + (p.cuenta || '—'),
    'Período: ' + (p.periodo || '—'),
    'ACCIONABLE ' + mesNombre + ': ' + fmtMoney(totalAccionable)
  ], 'meta');
  push([]);

  // ── ACCIONABLE: provisionar en el mes de cierre ──
  push(['🎯 PROVISIONAR EN ' + mesNombre.toUpperCase() + ' (ACCIONABLE) — ' + pendCierre.length + ' proveedor(es) · ' + fmtMoney(totalAccionable)], 'sec-red');
  push(['Proveedor', 'Monto a provisionar', 'Base del cálculo', 'Registrada (Sí/No)', 'Nº asiento', 'Notas'], 'colhead');
  if (pendCierre.length) {
    pendCierre.forEach(function(x) {
      push([x.prov, x.monto, 'Factura típica del proveedor (valor más frecuente)', '', '', ''], 'row-accionable');
    });
  } else {
    push(['✓ ' + mesNombre + ' al día: todos los proveedores con actividad reciente tienen factura o provisión.'], 'row-ok');
  }
  push([]);

  // ── Revisar vigencia: sin factura en el cierre y sin actividad reciente ──
  if (pendRevisar.length) {
    push(['⏸ SIN FACTURA HACE MESES — CONFIRMAR VIGENCIA DEL SERVICIO (' + pendRevisar.length + ') · sin provisión automática'], 'sec-gray');
    push(['Proveedor', 'Última factura', 'Fact. típica (referencia)', 'Vigente (Sí/No)', 'Acción', 'Notas'], 'colhead');
    pendRevisar.forEach(function(x) {
      push([x.prov, x.ultimoF ? MESES[x.ultimoF - 1] : '—', x.monto, '', '', ''], 'row-ref');
    });
    push([]);
  }

  // ── Matriz mensual ──
  push(['MATRIZ MENSUAL  ·  F = factura (IR) · P = provisión (Diario) · FALTA = provisionar'], 'sec-dark');
  push(header.slice(), 'colhead');
  var matDataStart = rows.length + 1;
  provs.forEach(function(pr) {
    const r = [pr.nombre || '', pr.recurrente ? 'Sí' : 'No'];
    for (var m = mesDesde; m <= mesCierre; m++) r.push((pr.meses && pr.meses[String(m)]) || '');
    r.push(parseFloat(pr.factura_promedio) || 0);
    // 'Prov. sugerida/mes' solo para el proveedor accionable del cierre
    r.push(pr.accionable === true ? (parseFloat(pr.provision_sugerida_mensual) || 0) : '');
    r.push(pr.comentario || '');
    push(r, 'row-matriz');
  });
  push([]);

  // ── Referencia: meses anteriores ──
  if (pendPrevios.length) {
    push(['REFERENCIA — meses anteriores ya cerrados (' + pendPrevios.length + ') · sin monto a provisionar (se regulariza a fin de año)'], 'sec-gray');
    push(['Proveedor', 'Mes', 'Fact. típica (contexto)', '', '', ''], 'colhead');
    pendPrevios.forEach(function(x) {
      push([x.prov, x.mes, x.monto, '', '', ''], 'row-ref');
    });
    push([]);
  }

  // ── Notas para auditoría ──
  const notas = p.notas_auditoria || [];
  push(['NOTAS PARA AUDITORÍA — variaciones y justificaciones (' + notas.length + ')'], 'sec-purple');
  notas.forEach(function(n, i) {
    push([(i + 1) + '. ' + n], 'row-nota');
  });
  push([]);

  // ── Resumen ──
  push(['RESUMEN'], 'sec-gray');
  push([p.resumen || ''], 'row-resumen');

  sh.getRange(1, 1, rows.length, REAL_COLS).setValues(rows);

  // ══ Formato por tipo de fila ══
  marks.forEach(function(mk) {
    const R = sh.getRange(mk.r, 1, 1, REAL_COLS);
    switch (mk.kind) {
      case 'title':
        R.merge().setBackground('#000000').setFontColor('#ffffff').setFontWeight('bold').setFontSize(13).setVerticalAlignment('middle');
        sh.setRowHeight(mk.r, 38); break;
      case 'meta':
        R.setBackground('#f4f4f5').setFontColor('#3f3f46').setFontSize(10); break;
      case 'sec-red':
        R.merge().setBackground('#dc1a23').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
        sh.setRowHeight(mk.r, 30); break;
      case 'sec-dark':
        R.merge().setBackground('#18181b').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
        sh.setRowHeight(mk.r, 30); break;
      case 'sec-gray':
        R.merge().setBackground('#e4e4e7').setFontColor('#3f3f46').setFontWeight('bold').setFontSize(11); break;
      case 'sec-purple':
        R.merge().setBackground('#7c3aed').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11); break;
      case 'colhead':
        R.setBackground('#27272a').setFontColor('#e4e4e7').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center'); break;
      case 'row-accionable':
        R.setBackground('#fde8e9').setFontSize(10);
        sh.getRange(mk.r, 2, 1, 1).setNumberFormat('$ #,##0').setHorizontalAlignment('right').setFontWeight('bold').setFontColor('#b01019'); break;
      case 'row-ok':
        R.merge().setBackground('#e6f7f0').setFontColor('#0b6b3a').setFontWeight('bold'); break;
      case 'row-matriz':
        R.setFontSize(10);
        sh.getRange(mk.r, 3 + nMes, 1, 2).setNumberFormat('$ #,##0').setHorizontalAlignment('right');
        sh.getRange(mk.r, 3, 1, nMes).setHorizontalAlignment('center').setFontWeight('bold'); break;
      case 'row-comp':
        R.setFontSize(10);
        sh.getRange(mk.r, 2, 1, nMes).setNumberFormat('$ #,##0').setHorizontalAlignment('right');
        sh.getRange(mk.r, 2 + nMes, 1, 1).setHorizontalAlignment('right').setFontWeight('bold'); break;
      case 'row-comp-total':
        R.setFontWeight('bold').setBackground('#f4f4f5').setFontSize(10);
        sh.getRange(mk.r, 2, 1, mesCierre).setNumberFormat('$ #,##0').setHorizontalAlignment('right'); break;
      case 'row-comp-prov':
        R.setFontColor('#71717a').setFontSize(10);
        sh.getRange(mk.r, 2, 1, mesCierre).setNumberFormat('$ #,##0').setHorizontalAlignment('right'); break;
      case 'row-ref':
        R.setFontColor('#52525b').setFontSize(10);
        sh.getRange(mk.r, 3, 1, 1).setNumberFormat('$ #,##0').setHorizontalAlignment('right'); break;
      case 'row-nota':
        R.merge().setWrap(true).setBackground('#f5f3ff').setFontColor('#4c1d95').setFontSize(10).setVerticalAlignment('middle');
        sh.setRowHeight(mk.r, 34); break;
      case 'row-resumen':
        R.merge().setWrap(true).setFontColor('#3f3f46').setFontSize(10);
        sh.setRowHeight(mk.r, 80); break;
    }
  });

  // Semáforo F/P/FALTA en la matriz y resalte de la columna del mes de cierre
  if (provs.length > 0) {
    const mesRange = sh.getRange(matDataStart, 3, provs.length, nMes);
    const rules = [
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('FALTA')
        .setBackground('#fde2e1').setFontColor('#b3261e').setRanges([mesRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('F')
        .setBackground('#d6f5e3').setFontColor('#0b6b3a').setRanges([mesRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('F+P')
        .setBackground('#d6f5e3').setFontColor('#0b6b3a').setRanges([mesRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('P')
        .setBackground('#fff1d6').setFontColor('#9a6700').setRanges([mesRange]).build()
    ];
    sh.setConditionalFormatRules(rules);
    // Borde en la columna del mes accionable
    sh.getRange(matDataStart - 1, 2 + nMes, provs.length + 1, 1)
      .setBorder(true, true, true, true, false, false, '#dc1a23', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }

  // Anchos
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 110);
  for (var c = 3; c <= REAL_COLS; c++) sh.setColumnWidth(c, 84);
  sh.setColumnWidth(REAL_COLS, 240);
  sh.setFrozenRows(1);

  // Tablas y gráficos en su propia hoja
  writeProvisionesDashboard_(ss, p, mesDesde, mesCierre, MESES);

  return ss.getUrl() + '#gid=' + sh.getSheetId();
}

/**
 * Hoja "Dashboard" de la planilla de Provisiones: comparativa mensual por
 * proveedor, gráfico de facturación por mes y desglose de otros movimientos.
 * Se reconstruye completa en cada análisis.
 */
function writeProvisionesDashboard_(ss, p, mesDesde, mesCierre, MESES) {
  let sh = ss.getSheetByName('Dashboard');
  if (!sh) sh = ss.insertSheet('Dashboard');
  else {
    sh.clearContents();
    sh.clearFormats();
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
    sh.getCharts().forEach(function(c) { sh.removeChart(c); });
    sh.getBandings().forEach(function(b){ b.remove(); });
  }

  const mesNombre = MESES[mesCierre - 1];
  const nMes = mesCierre - mesDesde + 1;
  const comp = p.comparativa || { filas: [], totFact: [], totProv: [] };
  const otros = p.otros || [];
  const NCOLS = Math.max(nMes + 2, 7);

  function pad(arr, len) { while (arr.length < len) arr.push(''); return arr; }
  const rows = [];
  const marks = [];
  function push(arr, kind) {
    rows.push(pad(arr, NCOLS));
    if (kind) marks.push({ r: rows.length, kind: kind });
  }

  push(['DASHBOARD PROVISIONES — comparativas y desgloses  ·  ' + (p.periodo || '')], 'title');
  push(['Analista: ' + (p.analista || 'Anónimo'), 'Fecha análisis: ' + (p.fecha || '') + ' ' + (p.hora || ''), 'Cuentas: ' + ((p.cuentas || []).join(' · ') || p.cuenta || '—')], 'meta');
  push([]);

  // ── Tabla base del gráfico: total facturado y provisiones por mes ──
  push(['FACTURACIÓN (IR) Y PROVISIONES (DIARIO) POR MES'], 'sec-dark');
  push(['Mes', 'Total facturado', 'Provisiones'], 'colhead');
  var chartDataStart = rows.length + 1;
  for (var m = mesDesde - 1; m < mesCierre; m++) {
    push([MESES[m], comp.totFact[m] || 0, comp.totProv[m] || 0], 'row-money2');
  }
  var chartDataEnd = rows.length;
  push([]);

  // ── Comparativa por proveedor ──
  if (comp.filas && comp.filas.length) {
    push(['COMPARATIVA MENSUAL POR PROVEEDOR — Δ ' + mesNombre + ' vs mes anterior · ⚠ = ±50% o sin factura'], 'sec-dark');
    const ch = ['Proveedor'];
    for (var m = mesDesde; m <= mesCierre; m++) ch.push(MESES[m-1]);
    ch.push('Δ %');
    push(ch, 'colhead');
    comp.filas.forEach(function(fRow) {
      const r = [fRow.prov];
      for (var m = mesDesde - 1; m < mesCierre; m++) r.push(fRow.montos[m] || '');
      r.push(fRow.delta || '');
      push(r, 'row-comp');
    });
    push([]);
  }

  // ── Otros movimientos (sin IR ni Diario) ──
  push(['OTROS MOVIMIENTOS DEL ARCHIVO — fuera de la lógica de provisiones (' + otros.length + ' líneas)'], 'sec-gray');
  push(['Cuenta', 'Tipo (NetSuite)', 'Proveedor', 'Mes', 'Monto neto', 'N° movs'], 'colhead');
  if (otros.length) {
    otros.forEach(function(x) {
      push([x.cuenta || '', x.tipo || '', x.prov || '', MESES[(x.mes || 1) - 1] || x.mes, parseFloat(x.monto) || 0, x.n || ''], 'row-otro');
    });
  } else {
    push(['— El archivo no trae movimientos fuera de la regla IR/Diario —'], 'row-empty');
  }

  sh.getRange(1, 1, rows.length, NCOLS).setValues(rows);

  // ══ Formato ══
  marks.forEach(function(mk) {
    const R = sh.getRange(mk.r, 1, 1, NCOLS);
    switch (mk.kind) {
      case 'title':
        R.merge().setBackground('#000000').setFontColor('#ffffff').setFontWeight('bold').setFontSize(13).setVerticalAlignment('middle');
        sh.setRowHeight(mk.r, 38); break;
      case 'meta':
        R.setBackground('#f4f4f5').setFontColor('#3f3f46').setFontSize(10); break;
      case 'sec-dark':
        R.merge().setBackground('#18181b').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
        sh.setRowHeight(mk.r, 30); break;
      case 'sec-gray':
        R.merge().setBackground('#e4e4e7').setFontColor('#3f3f46').setFontWeight('bold').setFontSize(11); break;
      case 'colhead':
        R.setBackground('#27272a').setFontColor('#e4e4e7').setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center'); break;
      case 'row-money2':
        R.setFontSize(10);
        sh.getRange(mk.r, 2, 1, 2).setNumberFormat('$ #,##0').setHorizontalAlignment('right'); break;
      case 'row-comp':
        R.setFontSize(10);
        sh.getRange(mk.r, 2, 1, nMes).setNumberFormat('$ #,##0').setHorizontalAlignment('right');
        sh.getRange(mk.r, 2 + nMes, 1, 1).setHorizontalAlignment('right').setFontWeight('bold'); break;
      case 'row-otro':
        R.setFontSize(10).setFontColor('#52525b');
        sh.getRange(mk.r, 5, 1, 1).setNumberFormat('$ #,##0').setHorizontalAlignment('right'); break;
      case 'row-empty':
        R.merge().setFontColor('#a1a1aa').setFontStyle('italic'); break;
    }
  });

  // ── Gráfico de columnas: facturación y provisiones por mes ──
  const chart = sh.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange(chartDataStart - 1, 1, chartDataEnd - chartDataStart + 2, 3))
    .setPosition(4, Math.min(NCOLS, 5), 0, 0)
    .setOption('title', 'Facturación (IR) vs Provisiones (Diario) por mes')
    .setOption('titleTextStyle', { color: '#18181b', fontSize: 13, bold: true })
    .setOption('colors', ['#18181b', '#dc1a23'])
    .setOption('backgroundColor', { fill: '#ffffff' })
    .setOption('legend', { position: 'bottom' })
    .setOption('hAxis', { textStyle: { color: '#52525b', fontSize: 10 } })
    .setOption('vAxis', { textStyle: { color: '#52525b', fontSize: 10 }, minValue: 0, format: 'short' })
    .setOption('width', 560)
    .setOption('height', 300);
  sh.insertChart(chart.build());

  // Anchos
  sh.setColumnWidth(1, 230);
  for (var c = 2; c <= NCOLS; c++) sh.setColumnWidth(c, 105);
  sh.setFrozenRows(1);
}
