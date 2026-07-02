# Conciliador Bancario — Módulos por banco (Google Apps Script)

Herramienta de conciliación para la hoja **Conciliador** de Google Sheets. Al
cargar la **cartola del mayor** de un banco, la clasifica movimiento a movimiento
para saber qué es **nuevo**, qué está **duplicado** (ya cargado), qué tiene
**incongruencia** (misma llave, monto distinto) y qué viene **sin ID** — con un
módulo de análisis distinto por banco.

> Este repo versiona el código Apps Script. **No** edita la hoja viva por sí
> solo: se instala en el proyecto Apps Script ligado al Conciliador (ver
> _Instalación_).

## Bancos y lógica de cada módulo

| Banco | Cae principalmente | Llave de conciliación / dedup |
|-------|--------------------|-------------------------------|
| **BCI** | Cobros | **ID de Cobro** `PAY-XXXXXX` (col. *Memo/Nota*) — layout NetSuite confirmado |
| **Santander** | Cobros | ID de Cobro `PAY-XXXXXX` |
| **Scotiabank** | Pagos de reservas / DLOCAL | Referencia **DLOCAL** / id de reserva |
| **ITAU** | Remuneraciones | **RUT + período** (yyyy-mm) — detecta doble pago |
| **Banco Internacional** | Todo (pagos y cobros) | Mejor llave disponible: PAY-ID › DLOCAL › hash(fecha+monto+glosa) |

Estados que asigna el motor a cada fila de la cartola:

- **NUEVO** — la llave no existe en el conciliador → se puede cargar.
- **DUPLICADO** — la llave ya existe con el mismo monto → no volver a cargar.
- **DUP EN LOTE** — repetido dentro de la misma cartola pegada.
- **REVISAR** — la llave existe pero con **monto distinto** → posible error.
- **SIN ID** — no se pudo obtener ID de Cobro → conciliación manual.

## Arquitectura

```
appsscript.json          Manifiesto (zona horaria, scopes, V8)
src/
  Config.gs              Registro de bancos + mapeo de columnas (config-driven)
  Parser.gs              Texto→matriz, montos CLP/US, fechas, extracción de IDs
  Engine.gs              Motor: índice de lo cargado, clasificación, dedup
  Worksheet.gs           Hoja "Mayor Nuevo" a color + "Hoja de Trabajo"
  Menu.gs                Menú 🏦 Conciliador + handlers de la sidebar
  Sidebar.html           UI para elegir banco y pegar la cartola
  banks/
    BCI.gs               Análisis de cobros (ID de Cobro / PAY)
    Santander.gs         Análisis de cobros (cobertura de PAY)
    Scotiabank.gs        Análisis de pagos de reservas / DLOCAL
    Itau.gs              Análisis de remuneraciones (doble pago por RUT+período)
    BancoInternacional.gs Análisis mixto (clasifica cobro/pago)
```

Para **ajustar** el layout de un banco (columnas de la cartola), edita
`columns` del banco en `src/Config.gs`. Sólo BCI está confirmado contra la
cartola real; el resto trae una configuración inicial marcada como *AJUSTABLE*.

### Formato de la cartola BCI (NetSuite General Ledger)

BCI usa el export **"CL - General Ledger (Con filtro por Cuenta)"** de NetSuite
(cuenta 1101-02). El parser ya lo entiende:

- **Filtra** automáticamente preámbulo, encabezado, subcuentas y filas de total
  (regla: conserva sólo filas con *Account* vacío y *Type* con valor).
- **ID de Cobro**: lo toma de las columnas *Memo/Nota* (`PAY-XXXXXX`). Los
  asientos tipo *Diario* sin PAY (ej. "Entre Cuenta", "ANTICIPO TANNER") quedan
  como **SIN ID**.
- **Montos** en formato US/científico (`7812548.0`, `5.6530906E7`): se controlan
  con `numberFormat: 'us'` y se toman de *Debit/Credit* (respaldo *Amount FC*).

Índices 0-based de la cartola NetSuite (ver `columns` de BCI en `Config.gs`):
`0 Account · 1 Type · 2 Date · 3 Document Number · 5 Name · 8 Debit · 9 Credit ·
11 Memo/Nota CABECERA · 12 Memo/Nota Línea · 15 SKU · 16 Amount(FC) · 21 ID de transacción`.

## Uso

1. Menú **🏦 Conciliador → “Cargar cartola del mayor…”**.
2. Elige el banco y **pega la cartola** (copiada desde Excel/Sheets, o CSV).
   Se detecta solo el separador (tab/`;`/`,`) y el formato de montos y fechas.
3. Se genera la hoja **“<Banco> · Mayor Nuevo”** con cada movimiento a
   color según su estado + un resumen y los mensajes del análisis del banco.
4. **“Reconstruir Hoja de Trabajo”** arma una vista priorizada (primero lo
   accionable: REVISAR y NUEVO).

## Instalación

### Opción A — pegar manualmente (rápida)
1. En el Conciliador: **Extensiones → Apps Script**.
2. Crea los archivos con los mismos nombres/rutas que en `src/` (Apps Script
   admite `/` en el nombre para simular carpetas) y pega el contenido.
   El archivo `Sidebar.html` debe llamarse `src/Sidebar`.
3. Guarda, recarga la hoja y aparecerá el menú **🏦 Conciliador**.

### Opción B — con clasp (recomendada, versionada)
```bash
npm install -g @google/clasp
clasp login
# copia .clasp.json.example a .clasp.json y pon el scriptId del proyecto ligado
cp .clasp.json.example .clasp.json
clasp push
```
El `scriptId` se obtiene en el editor de Apps Script del Conciliador:
**Configuración del proyecto → ID de secuencia de comandos**.

## Notas

- Los scopes son `spreadsheets.currentonly` y `script.container.ui`: la
  herramienta sólo actúa sobre la hoja donde está instalada.
- El índice de "lo ya cargado" se construye escaneando todas las hojas del
  conciliador y detectando bloques por su fila de encabezado (Fecha + Importe),
  así que funciona con el layout de dos bloques (Extracto + Mayor) de BCI.
