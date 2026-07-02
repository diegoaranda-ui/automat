/**
 * banks/Itau.gs
 * -----------------------------------------------------------------------------
 * Módulo ITAU (cuenta bancaria 1101-04). Es una cuenta operativa mixta: caen
 * pagos varios (Autopistas, tarjetas, gastos bancarios), traspasos "Entre
 * Cuenta" y los pagos de REMUNERACIONES como asientos AGREGADOS ("PAGOS DE
 * REMUNERACIONES" / "PAGO DE SUELDOS"). La llave de deduplicación es el N° de
 * documento (JECL); el análisis resalta aparte las líneas de remuneraciones.
 * -----------------------------------------------------------------------------
 */
function ITAU_analyze(cfg, rows, existingIndex) {
  var c = countByEstado_(rows);
  var nuevos = rows.filter(function (r) { return r.estado === ESTADO.NUEVO; });
  var dup = (c[ESTADO.DUPLICADO] || 0) + (c[ESTADO.DUP_LOTE] || 0);
  var revisar = rows.filter(function (r) { return r.estado === ESTADO.REVISAR; });

  var esRemuneracion = function (r) {
    return /remunerac|sueldo|nomina|finiquito/i.test((r.idText || '') + ' ' + (r.glosa || ''));
  };
  var remun = rows.filter(esRemuneracion);
  var montoRemun = remun.reduce(function (s, r) { return s + (isNaN(r.importe) ? 0 : Math.abs(r.importe)); }, 0);
  var montoNuevos = nuevos.reduce(function (s, r) { return s + (isNaN(r.importe) ? 0 : Math.abs(r.importe)); }, 0);

  var msgs = [];
  msgs.push('Movimientos nuevos (cuenta 1101-04): ' + nuevos.length + ' por ' + formatCLP_(montoNuevos) + '.');
  msgs.push('Remuneraciones / sueldos: ' + remun.length + ' asiento(s) por ' + formatCLP_(montoRemun) + '.');
  msgs.push('Ya cargados (duplicados por N° doc): ' + dup + '.');
  if (revisar.length) {
    msgs.push('⚠ ' + revisar.length + ' con mismo N° doc pero monto distinto → revisar.');
  }
  // Aviso de posible doble pago de remuneraciones: mismo monto de remuneración
  // repetido en el lote.
  var porMonto = {};
  remun.forEach(function (r) {
    var k = Math.round(Math.abs(r.importe));
    porMonto[k] = (porMonto[k] || 0) + 1;
  });
  var repetidos = Object.keys(porMonto).filter(function (k) { return porMonto[k] > 1; });
  if (repetidos.length) {
    msgs.push('⚠ Remuneraciones con monto repetido (posible doble pago): ' + repetidos.length + ' monto(s).');
  }
  return { titulo: 'ITAU — Cuenta 1101-04 (incluye remuneraciones)', mensajes: msgs };
}
