/**
 * banks/BancoInternacional.gs
 * -----------------------------------------------------------------------------
 * Módulo Banco Internacional. Caen TODO tipo de pagos y cobros. Se clasifica
 * por Débito/Crédito y se usa la mejor llave disponible (PAY-ID > DLOCAL > hash
 * fecha+monto+glosa). El análisis separa cargos (pagos) de abonos (cobros).
 * AJUSTA cfg.columns en Config.gs cuando tengas una muestra real de la cartola.
 * -----------------------------------------------------------------------------
 */
function BancoInternacional_analyze(cfg, rows, existingIndex) {
  var c = countByEstado_(rows);
  var nuevos = rows.filter(function (r) { return r.estado === ESTADO.NUEVO; });
  var dup = (c[ESTADO.DUPLICADO] || 0) + (c[ESTADO.DUP_LOTE] || 0);
  var revisar = rows.filter(function (r) { return r.estado === ESTADO.REVISAR; });

  // Clasificación cobro/pago: por columna Débito/Crédito si viene, si no por signo.
  function esPago(r) {
    var dc = normText(r.dc);
    if (dc) return /debito|debit|cargo|pago/.test(dc);
    return r.importe < 0;
  }
  var pagos = rows.filter(esPago);
  var cobros = rows.filter(function (r) { return !esPago(r); });
  var conId = rows.filter(function (r) { return r.keyType === 'payId' || r.keyType === 'dlocal'; });
  var porHash = rows.filter(function (r) { return r.keyType === 'hash'; });
  var montoNuevos = nuevos.reduce(function (s, r) { return s + (isNaN(r.importe) ? 0 : r.importe); }, 0);

  var msgs = [];
  msgs.push('Movimientos nuevos: ' + nuevos.length + ' por ' + formatCLP_(montoNuevos) + '.');
  msgs.push('Composición: ' + cobros.length + ' cobros / ' + pagos.length + ' pagos.');
  msgs.push('Con ID (PAY/DLOCAL): ' + conId.length + '   ·   deduplicados por fecha+monto+glosa: ' + porHash.length + '.');
  msgs.push('Ya cargados (duplicados): ' + dup + '.');
  if (revisar.length) msgs.push('⚠ ' + revisar.length + ' con misma llave y monto distinto → revisar.');
  return { titulo: 'Banco Internacional — Pagos y cobros (mixto)', mensajes: msgs };
}
