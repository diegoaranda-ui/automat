/**
 * banks/Santander.gs
 * -----------------------------------------------------------------------------
 * Módulo Santander. También caen COBROS → misma lógica de ID de Cobro (PAY).
 * Se diferencia de BCI en el énfasis del mensaje (Santander suele traer más
 * cobros sin PAY explícito, así que resaltamos esa cobertura).
 * AJUSTA cfg.columns en Config.gs cuando tengas una muestra real de la cartola.
 * -----------------------------------------------------------------------------
 */
function Santander_analyze(cfg, rows, existingIndex) {
  var c = countByEstado_(rows);
  var nuevos = rows.filter(function (r) { return r.estado === ESTADO.NUEVO; });
  var revisar = rows.filter(function (r) { return r.estado === ESTADO.REVISAR; });
  var sinId = rows.filter(function (r) { return r.estado === ESTADO.SIN_ID; });
  var dup = (c[ESTADO.DUPLICADO] || 0) + (c[ESTADO.DUP_LOTE] || 0);
  var montoNuevos = nuevos.reduce(function (s, r) { return s + (isNaN(r.importe) ? 0 : r.importe); }, 0);
  var cobertura = rows.length ? Math.round(100 * (rows.length - sinId.length) / rows.length) : 0;

  var msgs = [];
  msgs.push('Cobros nuevos a conciliar: ' + nuevos.length + ' por ' + formatCLP_(montoNuevos) + '.');
  msgs.push('Ya cargados (duplicados): ' + dup + '.');
  msgs.push('Cobertura de ID de Cobro: ' + cobertura + '% (' + (rows.length - sinId.length) + '/' + rows.length + ').');
  if (revisar.length) msgs.push('⚠ ' + revisar.length + ' con mismo ID y monto distinto → revisar.');
  if (sinId.length) msgs.push('⚠ ' + sinId.length + ' cobros sin ID de Cobro → conciliar por monto/fecha manualmente.');
  return { titulo: 'Santander — Cobros (ID de Cobro / PAY)', mensajes: msgs };
}
