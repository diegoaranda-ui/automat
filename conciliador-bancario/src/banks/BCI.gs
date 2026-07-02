/**
 * banks/BCI.gs
 * -----------------------------------------------------------------------------
 * Módulo BCI. En BCI caen COBROS y la llave es el ID DE COBRO (PAY-XXXXXX) que
 * viene en la columna "ID Transacción". El foco del análisis es:
 *   - detectar cobros SIN ID de Cobro (no conciliables por PAY),
 *   - detectar cobros ya cargados (duplicados) para no volver a subirlos,
 *   - detectar incongruencias (mismo PAY, monto distinto).
 * -----------------------------------------------------------------------------
 */
function BCI_analyze(cfg, rows, existingIndex) {
  var c = countByEstado_(rows);
  var sinId = rows.filter(function (r) { return r.estado === ESTADO.SIN_ID; });
  var nuevos = rows.filter(function (r) { return r.estado === ESTADO.NUEVO; });
  var revisar = rows.filter(function (r) { return r.estado === ESTADO.REVISAR; });
  var dup = (c[ESTADO.DUPLICADO] || 0) + (c[ESTADO.DUP_LOTE] || 0);

  var montoNuevos = nuevos.reduce(function (s, r) { return s + (isNaN(r.importe) ? 0 : r.importe); }, 0);

  var msgs = [];
  msgs.push('Cobros nuevos a conciliar: ' + nuevos.length + ' por ' + formatCLP_(montoNuevos) + '.');
  msgs.push('Ya cargados (no volver a subir): ' + dup + '.');
  if (revisar.length) {
    msgs.push('⚠ ' + revisar.length + ' con MISMO ID de Cobro pero monto distinto → revisar posible error.');
  }
  if (sinId.length) {
    msgs.push('⚠ ' + sinId.length + ' cobros SIN ID de Cobro (PAY): no se pueden deduplicar por PAY, revisar manual.');
  } else {
    msgs.push('Todos los cobros traen ID de Cobro (PAY). ✔');
  }
  return { titulo: 'BCI — Cobros (ID de Cobro / PAY)', mensajes: msgs };
}
