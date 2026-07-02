/**
 * banks/Itau.gs
 * -----------------------------------------------------------------------------
 * Módulo ITAU. Aquí se pagan las REMUNERACIONES. La llave es beneficiario/RUT +
 * período (yyyy-mm). El riesgo típico es pagar dos veces a la misma persona en
 * el mismo período, así que el análisis resalta duplicidades por RUT+período.
 * AJUSTA cfg.columns en Config.gs cuando tengas una muestra real de la cartola.
 * -----------------------------------------------------------------------------
 */
function ITAU_analyze(cfg, rows, existingIndex) {
  var c = countByEstado_(rows);
  var nuevos = rows.filter(function (r) { return r.estado === ESTADO.NUEVO; });
  var dupLote = rows.filter(function (r) { return r.estado === ESTADO.DUP_LOTE; });
  var dupHist = c[ESTADO.DUPLICADO] || 0;
  var revisar = rows.filter(function (r) { return r.estado === ESTADO.REVISAR; });
  var sinRut = rows.filter(function (r) { return r.keyType === 'hash'; });
  var montoNuevos = nuevos.reduce(function (s, r) { return s + (isNaN(r.importe) ? 0 : r.importe); }, 0);

  var msgs = [];
  msgs.push('Remuneraciones nuevas: ' + nuevos.length + ' por ' + formatCLP_(montoNuevos) + '.');
  msgs.push('Ya pagadas en el conciliador (mismo RUT+período): ' + dupHist + '.');
  if (dupLote.length) {
    msgs.push('⚠ ' + dupLote.length + ' beneficiarios REPETIDOS en esta misma cartola (posible doble pago).');
  }
  if (revisar.length) {
    msgs.push('⚠ ' + revisar.length + ' con mismo RUT+período pero monto distinto → revisar.');
  }
  if (sinRut.length) {
    msgs.push('⚠ ' + sinRut.length + ' sin RUT identificable → se deduplican por nombre+período+monto.');
  }
  return { titulo: 'ITAU — Pago de remuneraciones', mensajes: msgs };
}
