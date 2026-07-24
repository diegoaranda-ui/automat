# Finance Suite — Kavak Finanzas Chile

**Resumen ejecutivo, manual de uso y roadmap de fiabilidad**
Versión 2.0 · Julio 2026

---

## 1. Resumen ejecutivo

La **Finance Suite** es un módulo de la biblioteca *Operations Center* de Kavak Finanzas Chile que automatiza tareas del cierre mensual. Se accede desde una sola URL (Apps Script Web App), sin instalaciones, y todo el procesamiento de IA ocurre en el servidor — la API key nunca llega al navegador.

Tras la revisión de julio 2026, la suite se enfocó en **tres módulos deterministas** de cierre y se retiraron los módulos de lectura genérica (Reportería, Gestión Documental y Automatización Contable): los números que importan para el cierre se calculan 100 % en código y la IA solo redacta el análisis.

### ¿Qué problema resuelve?
El área de Finanzas dedica horas a leer documentos (cartolas, mayores de NetSuite), transcribir datos a mano y cruzar información entre fuentes para el cierre. La Finance Suite **lee, cruza y estructura esos datos automáticamente**, produciendo papeles de trabajo trazables y reproducibles.

### Los 3 módulos

| Módulo | Qué automatiza | Entrada | Salida |
|---|---|---|---|
| 🏦 **Conciliación Bancaria** | Cruce cartola banco vs. registros contables | 2 documentos (cartola + libro) | Transacciones conciliadas, diferencias, partidas sin match |
| 🧾 **Control de Provisiones** | Facturas mensuales vs provisiones (NetSuite) | Export General Ledger (.xls/.xlsx/.csv) | Matriz F/P/FALTA, provisiones accionables con monto sugerido, comparativa mensual, notas de auditoría |
| 🚗 **Impuesto Transferencia (ICAR)** | Cruce por Stock ID del impuesto de transferencia facturado vs descontado del fondo ICAR (cuenta 2801-01) | Mayor 2801-01 / General Ledger NetSuite (.xls/.xlsx/.csv) | Cuadratura de la cuenta, análisis del asiento de ajuste por vehículo, pendientes de rendición ICAR, notas de auditoría |

### Beneficios clave
- **Velocidad**: un cruce de cierre que tomaba horas se reduce a ~30 segundos.
- **Trazabilidad**: cada análisis se guarda automáticamente en la planilla del equipo con cabecera de quién/cuándo/qué archivo/parámetros.
- **Reproducibilidad**: el mismo archivo produce siempre los mismos números (cálculo determinista).
- **Cero infraestructura**: corre en Apps Script, una URL compartida con el equipo.
- **Seguridad**: la API key vive solo en el servidor (Script Properties).

### Tecnología
- **Motor IA**: `claude-opus-4-8` en Provisiones e ICAR (redacción del análisis), `claude-sonnet-4-6` en Conciliación (Messages API con visión)
- **Backend**: Google Apps Script (`callClaude` como proxy server-side)
- **Persistencia**: Google Sheets (una planilla por módulo) + historial local (`localStorage`)
- **Procesamiento de archivos**: compresión de imágenes en cliente (máx. 1600px) + render de PDF con pdf.js; Excel/CSV parseados con SheetJS

---

## 2. Manual de uso

### Acceso general
1. Abre la URL del Web App de Kavak Finanzas.
2. En el *Operations Center*, haz clic en la tarjeta que necesites (Provisiones, Conciliación o Impuesto Transferencia).
3. Escribe tu nombre en el campo "Tu nombre…" del sidebar (se guarda para la trazabilidad).
4. Sube el/los documento(s), pulsa el botón de análisis y espera el resultado (~30 s).

> **Formatos aceptados**: PDF, JPG, PNG (Conciliación); .xls/.xlsx/.csv tal cual salen de NetSuite (Provisiones e ICAR).

---

### 🏦 Módulo 1 — Conciliación Bancaria

**Para qué sirve:** cruzar las transacciones de una cartola bancaria contra los registros contables y detectar diferencias.

**Pasos:**
1. Sube la **Cartola Bancaria** en la zona izquierda (📋).
2. Sube los **Registros Contables** en la zona derecha (📚).
3. Pulsa **⚡ Conciliar**.

**Qué obtienes:**
- **4 tarjetas KPI**: conciliados ✓, solo en cartola ⚠, solo en libro ⚠, diferencia total.
- **Tabla de conciliados**: fecha cartola, descripción, monto, fecha libro, glosa y nivel de confianza. El cruce se hace por monto y fecha cercana (±3 días).
- **Tablas "Solo en cartola" / "Solo en libro"**: partidas sin match que requieren revisión manual.
- **Resumen** en texto, escrito automáticamente en la pestaña `Desglose` de la planilla de conciliaciones.

**Cómo interpretarlo:** una diferencia total de $0 y pocas partidas sin match indica buena conciliación. Las partidas en ámbar/azul son las que requieren revisión.

---

### 🧾 Módulo 2 — Control de Provisiones

**Para qué sirve:** responder la pregunta de cierre mensual: *¿a qué proveedores de factura mensual recurrente les falta la factura del mes accionable y no tienen provisión registrada?* — y cuánto provisionar.

**Pasos:**
1. Exporta desde NetSuite el reporte **"CL - General Ledger (Con filtro por Cuenta)"** del período.
2. Súbelo al módulo (acepta el .xls tal cual sale de NetSuite; soporta multi-cuenta).
3. Ajusta el **Último mes cerrado** (el mes accionable que se analiza).
4. Pulsa **🧾 Analizar provisiones**.

**Qué obtienes:**
- **Cabecera de trazabilidad**: analista, fecha/hora, archivo fuente, cuenta y parámetros.
- **KPIs**: proveedores recurrentes, con meses sin cubrir, meses FALTA, provisión sugerida del mes accionable.
- **🎯 Accionable del mes**: proveedores que facturaron el mes anterior pero no el mes de cierre → sugerencia de provisión con monto.
- **⏸ Confirmar vigencia**: recurrentes que llevan meses sin facturar (no se sugiere monto automático).
- **Matriz mensual** por proveedor (`F`/`P`/`F+P`/`FALTA`). **Clic en un proveedor** abre sus movimientos reales del General Ledger, con los extractos de Memo/Nota que justifican devengos, provisiones y reclasificaciones.
- **Comparativa mensual**: evolución de facturación por proveedor con deltas mes a mes (⚠ a ±50 % o factura faltante).
- **Notas para auditoría** con cifras exactas, listas para copiar.
- Escritura automática en la planilla **Control Provisiones** (pestaña `Provisiones` + `Dashboard` con comparativa, desglose de otros movimientos y gráfico de columnas).

**Cómo se calcula (fiabilidad):** la IA clasifica y comenta, pero los números son deterministas. La **factura típica** de cada proveedor se recalcula desde sus facturas reales (columna D empieza con "IR" = factura recepcionada; moda con tolerancia ±5 %, mediana si no hay repetición — nunca el promedio). Las provisiones (Type "Diario") y reversos jamás entran al monto sugerido. El monto sugerido solo aplica al proveedor/mes accionable; los meses anteriores son referencia (se regularizan a fin de año). El mismo archivo produce siempre el mismo resultado.

**Cómo interpretarlo:** un proveedor con montos idénticos en meses separados puede facturar por trimestre — confirma el contrato antes de provisionar mensual (las notas de auditoría lo señalan).

---

### 🚗 Módulo 3 — Impuesto Transferencia (ICAR)

**Para qué sirve:** cruzar por **Stock ID** el impuesto de transferencia facturado al cliente contra lo descontado del fondo ICAR en la cuenta 2801-01, para determinar el resultado por vehículo y armar el análisis del asiento de ajuste.

**Pasos:**
1. Exporta el **mayor de la cuenta 2801-01** (o el General Ledger de NetSuite filtrado por esa cuenta). Para el análisis completo, exporta desde el inicio del año.
2. Súbelo al módulo.
3. Pulsa **🚗 Analizar impuesto**.

**Qué obtienes:**
- **KPIs**: saldo de la cuenta, pendientes de rendición, resultado negativo por registrar, cruces OK.
- **Banner de cuadratura** de la cuenta.
- **🎯 Análisis del asiento de ajuste**: por Stock ID / patente / mes de venta, con facturado, descontado y diferencia, y total copiable. **El sistema analiza el asiento, nunca lo ejecuta** — el analista lo registra.
- **Pivot por mes de venta** (incluye el bucket "Revisar fin de mes" para cruces sin mes cerrado).
- **⏳ Facturado sin descontar**: vehículos a la espera de la rendición de ICAR (sin acción).
- **📆 Fuera de ventana**: descuentos cuya factura al cliente quedó fuera del rango del export (sugerencia: exportar el mayor desde inicio de año).
- **Notas de auditoría** y resumen, escritos en la pestaña `Análisis ICAR` de la planilla del equipo (no se toca ninguna otra pestaña).

**Cómo se calcula (fiabilidad):** determinista como Provisiones. El resultado por Stock se clasifica en código (OK si el saldo ≤ tolerancia; resultado negativo por registrar si facturado + descontado > 0; facturado sin descontar si hay factura pero aún no descuento; fuera de ventana si el descuento no tiene su factura en el export). La IA solo redacta el resumen y las notas.

---

### Historial y Google Sheets
- Cada análisis queda en el **historial local** (sidebar, hasta 50 ítems). Haz clic en un ítem para recuperar su resultado.
- Cada módulo escribe (modo sobrescritura) en su propia planilla: Conciliación → `Desglose`; Provisiones → `Provisiones` + `Dashboard`; ICAR → `Análisis ICAR`.

---

## 3. Roadmap de fiabilidad — qué agregar

Hoy la suite es un **apoyo a la decisión**, no un sistema de registro contable oficial. Mejoras priorizadas:

### 🔴 Prioridad alta
1. **Doble pasada / verificación** para montos críticos (self-consistency o comparar dos corridas).
2. **Registro de auditoría persistente**: guardar quién analizó qué, cuándo, con qué archivo (hash), resultado y si fue revisado/aprobado.
3. **Validación de cuadratura visible** en ICAR y Provisiones (recalcular en cliente y marcar en rojo cualquier descuadre inesperado).

### 🟡 Prioridad media
4. **Soporte multi-página real en PDF** para cartolas largas en Conciliación.
5. **Tolerancia configurable en conciliación** (rango de fechas ±N días, margen de monto, conciliaciones muchos-a-uno).
6. **Edición manual del resultado antes de guardar**, sin re-subir el documento.

### 🟢 Prioridad baja
7. **Detección de duplicados** de archivos ya procesados (por hash/cuenta/período).
8. **Internacionalización**: parametrizar para otros mercados Kavak (RUT, IVA, plan de cuentas).

### Recomendación de gobernanza
- Definir un **flujo de aprobación humana** obligatorio (la IA propone y redacta, una persona aprueba y registra).
- Documentar que las salidas son **análisis asistidos por IA con números deterministas**, no documentos contables oficiales.

---

*Documento del equipo de Finanzas — Kavak Chile.*
