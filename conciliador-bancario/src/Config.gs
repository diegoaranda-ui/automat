/**
 * Config.gs
 * -----------------------------------------------------------------------------
 * Configuración central del Conciliador Bancario (config-driven).
 *
 * Cada banco es un "módulo" con:
 *   - key            : identificador interno del banco.
 *   - label          : nombre visible en menús y hojas.
 *   - tipoOperacion  : qué tipo de movimiento cae principalmente (cobros / pagos).
 *   - keyStrategy    : cómo se obtiene la LLAVE de conciliación / deduplicación
 *                      a partir de una fila (ej: PAY-ID para BCI).
 *   - columns        : mapeo de columnas de la CARTOLA que sube el usuario.
 *                      Los índices son 0-based DENTRO de la cartola pegada.
 *                      Si un banco no trae cierta columna, se deja en null.
 *   - idHeaders      : posibles encabezados donde vive el "ID de Cobro" dentro
 *                      del conciliador (para escanear lo YA cargado).
 *   - analyze        : nombre de la función de análisis específica del banco
 *                      (declarada en src/banks/<Banco>.gs).
 *
 * IMPORTANTE: sólo el layout de BCI está confirmado contra la hoja real
 * ("1101-02 | Banco BCI $"). Los demás bancos traen una configuración inicial
 * razonable y claramente marcada como AJUSTABLE — corrige los índices de
 * `columns` cuando tengas una muestra real de cada cartola.
 * -----------------------------------------------------------------------------
 */

// Nombre de la hoja que genera el motor con el análisis del mayor entrante.
var MAYOR_NUEVO_SHEET = 'Mayor Nuevo';

// Nombre de la hoja de trabajo mejorada.
var HOJA_TRABAJO_SHEET = 'Hoja de Trabajo';

// Paleta usada por Worksheet.gs (coherente en toda la herramienta).
var PALETTE = {
  header:      '#0B3D5C', // azul corporativo oscuro
  headerText:  '#FFFFFF',
  nuevo:       '#E6F4EA', // verde suave  -> cargar
  nuevoText:   '#137333',
  duplicado:   '#FCE8E6', // rojo suave   -> ya está, no cargar
  duplicadoTx: '#C5221F',
  revisar:     '#FEF7E0', // ámbar suave  -> incongruencia, revisar
  revisarTx:   '#B06000',
  sinId:       '#E8F0FE', // azul suave   -> sin ID de cobro
  sinIdText:   '#1A73E8',
  zebra:       '#F8F9FA',
  border:      '#DADCE0'
};

/**
 * Registro de bancos. Se construye vía función (no var top-level cruzando
 * archivos) para no depender del orden de evaluación de archivos en Apps Script.
 */
function getBankRegistry() {
  return {
    // ---------------------------------------------------------------- BCI ----
    // Layout CONFIRMADO contra la hoja real. En BCI caen COBROS y la llave es
    // el "ID de Cobro" (PAY-XXXXXX) que viene en la columna "ID Transacción".
    BCI: {
      key: 'BCI',
      label: 'BCI',
      tipoOperacion: 'cobros',
      requiereIdCobro: true,
      keyStrategy: 'payId',
      columns: {
        fecha: 0,        // A Fecha
        glosa: 1,        // B Concepto
        glosa2: 2,       // C Concepto 2
        importe: 3,      // D Importe
        idCobro: 4,      // E ID Transacción  <- PAY-XXXXXX
        debitoCredito: 8 // I Débito/Crédito (si viene en la cartola)
      },
      idHeaders: ['ID Transacción', 'ID Transaccion', 'Nombre', 'ID de Cobro', 'Pay ID', 'PAY ID'],
      analyze: 'BCI_analyze'
    },

    // ---------------------------------------------------------- Santander ----
    // AJUSTABLE. También caen COBROS -> misma estrategia de ID de Cobro.
    Santander: {
      key: 'Santander',
      label: 'Santander',
      tipoOperacion: 'cobros',
      requiereIdCobro: true,
      keyStrategy: 'payId',
      columns: {
        fecha: 0,
        glosa: 1,
        glosa2: 2,
        importe: 3,
        idCobro: 4,
        debitoCredito: null
      },
      idHeaders: ['ID Transacción', 'ID Transaccion', 'ID de Cobro', 'Nombre', 'Pay ID'],
      analyze: 'Santander_analyze'
    },

    // --------------------------------------------------------- Scotiabank ----
    // AJUSTABLE. Caen los PAGOS de las RESERVAS / DLOCAL -> la llave es la
    // referencia DLOCAL / id de reserva.
    Scotiabank: {
      key: 'Scotiabank',
      label: 'Scotiabank',
      tipoOperacion: 'pagos_reservas',
      requiereIdCobro: false,
      keyStrategy: 'dlocal',
      columns: {
        fecha: 0,
        glosa: 1,
        glosa2: 2,
        importe: 3,
        idCobro: 4,      // referencia DLOCAL / reserva
        debitoCredito: null
      },
      idHeaders: ['Referencia', 'DLOCAL', 'DLocal', 'Reserva', 'ID Reserva', 'ID Transacción'],
      analyze: 'Scotiabank_analyze'
    },

    // --------------------------------------------------------------- ITAU ----
    // AJUSTABLE. Aquí se pagan las REMUNERACIONES -> la llave es el
    // beneficiario/RUT + período. La duplicidad típica es pagar 2 veces a la
    // misma persona en el mismo período.
    ITAU: {
      key: 'ITAU',
      label: 'ITAU',
      tipoOperacion: 'remuneraciones',
      requiereIdCobro: false,
      keyStrategy: 'remuneracion',
      columns: {
        fecha: 0,
        glosa: 1,        // beneficiario / nombre
        glosa2: 2,       // RUT o detalle
        importe: 3,
        idCobro: null,
        debitoCredito: null
      },
      idHeaders: ['RUT', 'Beneficiario', 'Nombre', 'ID Transacción'],
      analyze: 'ITAU_analyze'
    },

    // ------------------------------------------------ Banco Internacional ----
    // AJUSTABLE. Caen TODO tipo de pagos y cobros -> se clasifica por
    // Débito/Crédito y se usa la mejor llave disponible (PAY-ID si existe,
    // si no, hash de fecha+monto+glosa).
    BancoInternacional: {
      key: 'BancoInternacional',
      label: 'Banco Internacional',
      tipoOperacion: 'mixto',
      requiereIdCobro: false,
      keyStrategy: 'auto',
      columns: {
        fecha: 0,
        glosa: 1,
        glosa2: 2,
        importe: 3,
        idCobro: 4,
        debitoCredito: 8
      },
      idHeaders: ['ID Transacción', 'ID Transaccion', 'ID de Cobro', 'Referencia', 'Nombre'],
      analyze: 'BancoInternacional_analyze'
    }
  };
}

/** Devuelve la config de un banco por su key, o lanza error claro. */
function getBankConfig(bankKey) {
  var reg = getBankRegistry();
  var cfg = reg[bankKey];
  if (!cfg) {
    throw new Error('Banco no configurado: "' + bankKey + '". Bancos válidos: ' +
      Object.keys(reg).join(', '));
  }
  return cfg;
}

/** Lista [{key,label}] para poblar el selector de la sidebar. */
function listBanks() {
  var reg = getBankRegistry();
  return Object.keys(reg).map(function (k) {
    return { key: k, label: reg[k].label, tipo: reg[k].tipoOperacion };
  });
}
