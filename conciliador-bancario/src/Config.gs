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
 * IMPORTANTE: BCI, Santander, Banco Internacional e ITAU están confirmados
 * contra cartolas reales (export NetSuite General Ledger). Sólo Scotiabank
 * queda con configuración inicial AJUSTABLE — corrige los índices de `columns`
 * cuando tengas una muestra real de su cartola.
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
    // Layout CONFIRMADO contra la cartola real del mayor: export NetSuite
    // "CL - General Ledger (Con filtro por Cuenta)" de la cuenta 1101-02.
    // En BCI la llave es el "ID de Cobro" (PAY-XXXXXX) que viene en las columnas
    // Memo/Nota. Los montos vienen en Debit/Credit en formato US/científico.
    // Índices 0-based de la cartola NetSuite:
    //   0 Account | 1 Type | 2 Date | 3 Document Number | 4 Período | 5 Name |
    //   6 Name(Diario) | 7 RUT | 8 Debit | 9 Credit | 10 Saldo |
    //   11 Memo/Nota CABECERA | 12 Memo/Nota Línea | 13 Item | 14 Stock ID |
    //   15 SKU Related | 16 Amount(Foreign Currency) | ... | 21 ID de transacción
    BCI: {
      key: 'BCI',
      label: 'BCI',
      tipoOperacion: 'cobros',
      requiereIdCobro: true,
      keyStrategy: 'payId',
      format: 'netsuite_gl',   // activa filtrado de preámbulo/subtotales/totales
      numberFormat: 'us',      // 7812548.0 / 5.6530906E7
      columns: {
        accountCol: 0,   // sólo se conservan filas con Account VACÍO...
        typeCol: 1,      // ...y Type con valor (Pago / Diario)
        fecha: 2,        // Date (ISO)
        docNumber: 3,    // Document Number (PYMTCL / JECL)
        glosa: 5,        // Name
        glosa2: 15,      // SKU Related (vehículo)
        debit: 8,        // Debit
        credit: 9,       // Credit
        importe: 16,     // Amount (Foreign Currency) como respaldo
        idCobro: 11,     // Memo/Nota CABECERA  <- PAY-XXXXXX
        idCobroAlt: 12,  // Memo/Nota Línea       (respaldo del PAY)
        transId: 21      // ID de transacción NetSuite
      },
      idHeaders: ['ID Transacción', 'ID Transaccion', 'Nombre', 'ID de Cobro', 'Memo', 'Memo/Nota', 'Pay ID', 'PAY ID'],
      analyze: 'BCI_analyze'
    },

    // ---------------------------------------------------------- Santander ----
    // CONFIRMADO: mismo export NetSuite "General Ledger" que BCI, cuenta 1101-01.
    // También caen COBROS -> llave = ID de Cobro (PAY-XXXXXX) en Memo/Nota, con
    // P-XXXX como llave secundaria. Movimientos sin referencia (Diario,
    // devoluciones) quedan como SIN ID para revisión manual.
    Santander: {
      key: 'Santander',
      label: 'Santander',
      tipoOperacion: 'cobros',
      requiereIdCobro: true,
      keyStrategy: 'payId',
      format: 'netsuite_gl',
      numberFormat: 'us',
      columns: {
        accountCol: 0,
        typeCol: 1,
        fecha: 2,
        docNumber: 3,
        glosa: 5,
        glosa2: 15,
        debit: 8,
        credit: 9,
        importe: 16,
        idCobro: 11,
        idCobroAlt: 12,
        transId: 21
      },
      idHeaders: ['ID Transacción', 'ID Transaccion', 'ID de Cobro', 'Nombre', 'Memo', 'Memo/Nota', 'Pay ID'],
      analyze: 'Santander_analyze'
    },

    // --------------------------------------------------------- Scotiabank ----
    // AJUSTABLE. Caen los PAGOS de las RESERVAS / DLOCAL -> la llave es la
    // referencia DLOCAL / id de reserva. Si su cartola también es export
    // NetSuite, copia el bloque de columnas de BCI y ajusta keyStrategy.
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
    // CONFIRMADO: export NetSuite "General Ledger". El archivo trae varias
    // cuentas; sólo interesa la bancaria 1101-04 (accountFilter). Es una cuenta
    // operativa mixta: las remuneraciones caen como asientos AGREGADOS ("PAGOS
    // DE REMUNERACIONES" / "PAGO DE SUELDOS"), no como pago por persona/RUT.
    // Por eso la llave de deduplicación es el N° de documento (JECL), y el
    // análisis resalta aparte las líneas de remuneraciones.
    ITAU: {
      key: 'ITAU',
      label: 'ITAU',
      tipoOperacion: 'remuneraciones',
      requiereIdCobro: false,
      keyStrategy: 'auto',
      format: 'netsuite_gl',
      numberFormat: 'us',
      accountFilter: '1101-04',
      columns: {
        accountCol: 0,
        typeCol: 1,
        fecha: 2,
        docNumber: 3,   // JECL...  <- llave de deduplicación
        glosa: 11,      // Memo/Nota CABECERA (describe el movimiento)
        glosa2: 5,      // Name (suele venir vacío en estos asientos)
        debit: 8,
        credit: 9,
        importe: 16,
        idCobro: 11,
        idCobroAlt: 12,
        rutCol: 7,      // RUT (referencia; no se usa como llave)
        transId: 21
      },
      idHeaders: ['RUT', 'Beneficiario', 'Nombre', 'Documento', 'Document Number', 'Memo', 'Memo/Nota', 'ID Transacción'],
      analyze: 'ITAU_analyze'
    },

    // ------------------------------------------------ Banco Internacional ----
    // CONFIRMADO: mismo export NetSuite "General Ledger", cuenta 1101-05.
    // Caen TODO tipo de pagos y cobros. Sólo ~12% trae PAY/P-ref, así que la
    // llave de deduplicación por defecto es el N° de documento (PYMTCL/JECL),
    // que está siempre presente. Cascada: PAY-nnn > P-XXXX > DLOCAL > N° doc > hash.
    BancoInternacional: {
      key: 'BancoInternacional',
      label: 'Banco Internacional',
      tipoOperacion: 'mixto',
      requiereIdCobro: false,
      keyStrategy: 'auto',
      format: 'netsuite_gl',
      numberFormat: 'us',
      columns: {
        accountCol: 0,
        typeCol: 1,
        fecha: 2,
        docNumber: 3,   // PYMTCL / JECL  <- llave por defecto
        glosa: 5,
        glosa2: 15,
        debit: 8,
        credit: 9,
        importe: 16,
        idCobro: 11,
        idCobroAlt: 12,
        transId: 21
      },
      idHeaders: ['ID Transacción', 'ID Transaccion', 'ID de Cobro', 'Referencia', 'Documento', 'Document Number', 'Memo', 'Memo/Nota', 'Nombre'],
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
