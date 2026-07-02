/**
 * banks/Scotiabank.gs
 * -----------------------------------------------------------------------------
 * Módulo Scotiabank. Aquí caen los PAGOS de las RESERVAS / DLOCAL. La llave es
 * la referencia DLOCAL / id de reserva. El análisis resalta:
 *   - cuántos movimientos se reconocen como DLOCAL / reserva,
 *   - pagos ya registrados (duplicados),
 *   - pagos sin referencia DLOCAL identificable.
 * AJUSTA cfg.columns en Config.gs cuando tengas una muestra real de la cartola.
 * -----------------------------------------------------------------------------
 */
function Scotiabank_analyze(cfg, rows, existingIndex) {
  var c = countByEstado_(rows);
  var nuevos = rows.filter(function (r) { return r.estado === ESTADO.NUEVO; });
  var dup = (c[ESTADO.DUPLICADO] || 0) + (c[ESTADO.DUP_LOTE] || 0);
  var revisar = rows.filter(function (r) { return r.estado === ESTADO.REVISAR; });
  var sinRef = rows.filter(function (r) { return r.estado === ESTADO.SIN_ID; });
  var conDlocal = rows.filter(function (r) { return r.key && r.key.indexOf('DLOCAL') === 0; });
  var montoNuevos = nuevos.reduce(function (s, r) { return s + (isNaN(r.importe) ? 0 : r.importe); }, 0);

  var msgs = [];
  msgs.push('Pagos de reservas nuevos: ' + nuevos.length + ' por ' + formatCLP_(montoNuevos) + '.');
  msgs.push('Reconocidos como DLOCAL: ' + conDlocal.length + ' de ' + rows.length + '.');
  msgs.push('Ya registrados (duplicados): ' + dup + '.');
  if (revisar.length) msgs.push('⚠ ' + revisar.length + ' con misma referencia y monto distinto → revisar.');
  if (sinRef.length) msgs.push('⚠ ' + sinRef.length + ' sin referencia DLOCAL/reserva identificable → revisar glosa.');
  return { titulo: 'Scotiabank — Pagos de reservas / DLOCAL', mensajes: msgs };
}
