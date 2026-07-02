/**
 * banks/Scotiabank.gs
 * -----------------------------------------------------------------------------
 * Módulo Scotiabank (cuenta bancaria 1101-03). Aquí caen los pagos de reservas
 * vía DLOCAL, pero en el mayor llegan como asientos AGREGADOS ("Dlocal a
 * Scotiabank | 01-12 Junio"), no como pago individual con referencia. La llave
 * de deduplicación es el N° de documento (JECL); el análisis resalta aparte las
 * líneas relacionadas con DLOCAL.
 * -----------------------------------------------------------------------------
 */
function Scotiabank_analyze(cfg, rows, existingIndex) {
  var c = countByEstado_(rows);
  var nuevos = rows.filter(function (r) { return r.estado === ESTADO.NUEVO; });
  var dup = (c[ESTADO.DUPLICADO] || 0) + (c[ESTADO.DUP_LOTE] || 0);
  var revisar = rows.filter(function (r) { return r.estado === ESTADO.REVISAR; });

  var esDlocal = function (r) { return /dlocal/i.test((r.idText || '') + ' ' + (r.glosa || '')); };
  var dlocal = rows.filter(esDlocal);
  var montoDlocal = dlocal.reduce(function (s, r) { return s + (isNaN(r.importe) ? 0 : Math.abs(r.importe)); }, 0);
  var montoNuevos = nuevos.reduce(function (s, r) { return s + (isNaN(r.importe) ? 0 : Math.abs(r.importe)); }, 0);

  var msgs = [];
  msgs.push('Movimientos nuevos (cuenta 1101-03): ' + nuevos.length + ' por ' + formatCLP_(montoNuevos) + '.');
  msgs.push('Relacionados con DLOCAL / reservas: ' + dlocal.length + ' asiento(s) por ' + formatCLP_(montoDlocal) + '.');
  msgs.push('Ya cargados (duplicados por N° doc): ' + dup + '.');
  if (revisar.length) {
    msgs.push('⚠ ' + revisar.length + ' con mismo N° doc pero monto distinto → revisar.');
  }
  return { titulo: 'Scotiabank — Pagos de reservas / DLOCAL (cuenta 1101-03)', mensajes: msgs };
}
