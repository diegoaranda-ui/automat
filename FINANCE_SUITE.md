# Finance Suite — Kavak Supply Chile

**Resumen ejecutivo, manual de uso y roadmap de fiabilidad**
Versión 1.0 · Junio 2026

---

## 1. Resumen ejecutivo

La **Finance Suite** es un módulo de la biblioteca *Operations Center* de Kavak Supply Chile que automatiza tareas financieras repetitivas usando **Claude Vision (IA)**. Se accede desde una sola URL (Apps Script Web App), sin instalaciones, y todo el procesamiento de IA ocurre en el servidor — la API key nunca llega al navegador.

### ¿Qué problema resuelve?
El área de Finanzas dedica horas a leer documentos (cartolas, facturas, estados financieros), transcribir datos a mano y cruzar información entre fuentes. La Finance Suite **lee, extrae y estructura esos datos automáticamente**, reduciendo el trabajo manual y los errores de transcripción.

### Los 4 módulos

| Módulo | Qué automatiza | Entrada | Salida |
|---|---|---|---|
| 🏦 **Conciliación Bancaria** | Cruce cartola banco vs. registros contables | 2 documentos (cartola + libro) | Transacciones conciliadas, diferencias, partidas sin match |
| 📊 **Reportería Financiera** | Lectura de estados financieros | 1 documento (balance/P&L/flujo) | KPIs, ratios, resumen ejecutivo, alertas |
| 📄 **Gestión Documental** | Extracción de datos de documentos tributarios | 1+ documentos (factura/boleta/contrato) | Emisor, receptor, ítems, totales, IVA |
| ⚙️ **Automatización Contable** | Generación de asientos contables | 1 documento fuente | Asiento debe/haber, validación de cuadre, export CSV |

### Beneficios clave
- **Velocidad**: un análisis que tomaba 10–15 min se reduce a ~30 segundos.
- **Trazabilidad**: cada análisis se guarda automáticamente en Google Sheets (panel `Registros` + `Dashboard`).
- **Consistencia**: misma estructura de salida siempre, lista para copiar/exportar.
- **Cero infraestructura**: corre en Apps Script, una URL compartida con el equipo.
- **Seguridad**: la API key vive solo en el servidor (Script Properties).

### Tecnología
- **Motor IA**: `claude-sonnet-4-6` (Messages API con visión)
- **Backend**: Google Apps Script (`callClaude` como proxy server-side)
- **Persistencia**: Google Sheets + historial local (`localStorage`)
- **Procesamiento de archivos**: compresión de imágenes en cliente (máx. 1600px) + render de PDF con pdf.js

---

## 2. Manual de uso

### Acceso general
1. Abre la URL del Web App de Kavak Supply.
2. En el *Operations Center*, haz clic en la tarjeta de Finanzas que necesites (Conciliación, Reportería, Gestión o Automatización).
3. Escribe tu nombre en el campo "Tu nombre…" del sidebar (se guarda para el registro en Sheets).
4. Sube el/los documento(s), pulsa el botón de análisis y espera el resultado (~30 s).

> **Atajo**: `Ctrl + Enter` ejecuta el análisis del módulo activo.
> **Formatos aceptados**: PDF, JPG, PNG. Los PDF se renderizan a imagen automáticamente.

---

### 🏦 Módulo 1 — Conciliación Bancaria

**Para qué sirve:** cruzar las transacciones de una cartola bancaria contra los registros contables y detectar diferencias.

**Pasos:**
1. Sube la **Cartola Bancaria** en la zona izquierda (📋).
2. Sube los **Registros Contables** en la zona derecha (📚).
3. Pulsa **⚡ Conciliar**.

**Qué obtienes:**
- **4 tarjetas KPI**: conciliados ✓, solo en cartola ⚠, solo en libro ⚠, diferencia total.
- **Tabla de conciliados**: fecha cartola, descripción, monto, fecha libro, glosa y nivel de confianza (alta/media). El cruce se hace por monto y fecha cercana (±3 días).
- **Tabla "Solo en cartola"**: movimientos del banco sin registro contable (posibles cargos/abonos no contabilizados).
- **Tabla "Solo en libro"**: asientos contables que no aparecen en el banco (posibles cheques no cobrados, errores).
- **Resumen** en texto.

**Cómo interpretarlo:** una diferencia total de $0 y pocas partidas sin match indica buena conciliación. Las partidas en ámbar/azul son las que requieren revisión manual.

---

### 📊 Módulo 2 — Reportería Financiera

**Para qué sirve:** leer un estado financiero y extraer métricas, ratios y un resumen ejecutivo.

**Pasos:**
1. Sube el **Estado Financiero** (balance general, estado de resultados o flujo de caja).
2. Pulsa **📊 Analizar**.

**Qué obtienes:**
- **Banner** con tipo de documento detectado, período, moneda y nivel de confianza.
- **Tarjetas KPI** con las 4 métricas principales.
- **Tabla de métricas** completa (categoría, nombre, valor, unidad, nota).
- **Tabla de ratios** con interpretación semáforo (bueno / neutro / alerta).
- **Resumen ejecutivo** redactado por la IA.
- **Alertas** financieras detectadas (si las hay).

**Cómo interpretarlo:** los ratios marcados "alerta" (rojo) son los que merecen atención. El resumen ejecutivo es un punto de partida, no un dictamen final.

---

### 📄 Módulo 3 — Gestión Documental Financiera

**Para qué sirve:** extraer automáticamente todos los datos de facturas, boletas, notas de crédito/débito y contratos.

**Pasos:**
1. Sube uno o varios documentos (factura, boleta, etc.).
2. Pulsa **🔍 Extraer datos**.

**Qué obtienes:**
- **Cabecera**: tipo de documento, número, fecha, estado (vigente/anulado/pagado/pendiente).
- **Tarjetas Emisor / Receptor**: RUT (con botón de copiar), nombre, giro, dirección.
- **Tabla de ítems**: descripción, cantidad, precio unitario, precio total.
- **Totales**: subtotal, IVA (19%) y TOTAL destacado.
- Se guarda automáticamente en Sheets con el RUT del emisor y el total.

**Cómo interpretarlo:** verifica siempre el RUT y el total contra el documento original antes de usarlo en un pago o registro.

---

### ⚙️ Módulo 4 — Automatización Contable

**Para qué sirve:** generar el asiento contable de un documento fuente según el Plan de Cuentas chileno estándar.

**Pasos:**
1. Sube el **documento fuente** (factura, boleta, recibo, comprobante).
2. Pulsa **⚙️ Generar asiento**.

**Qué obtienes:**
- **Cabecera**: tipo de operación, número de documento, fecha y glosa.
- **Tabla del asiento**: código de cuenta, nombre de cuenta, centro de costo, Debe y Haber.
- **Indicador de cuadre**: ✓ Cuadrado / ✗ Descuadrado (con la diferencia si no cuadra).
- **Notas** del "contador IA".
- **Exportar CSV** y **Copiar asiento** para llevar a tu ERP/planilla.

**Cómo interpretarlo:** el asiento es una **propuesta** que debe revisar un contador. Si aparece "Descuadrado", revisa montos antes de usarlo. Las cuentas sugeridas pueden requerir ajuste al plan de cuentas específico de Kavak.

---

### Historial y Google Sheets
- Cada análisis queda en el **historial local** (sidebar, hasta 50 ítems). Haz clic en un ítem para recuperar su resultado.
- Conciliación, Gestión y Automatización **guardan automáticamente** un registro en la pestaña `Registros` de la planilla Kavak, visible en el `Dashboard`.

---

## 3. Roadmap de fiabilidad — qué agregar

Estas son mejoras priorizadas para convertir la herramienta de "asistente rápido" a "sistema confiable de producción". Importante: hoy la suite es un **apoyo a la decisión**, no un sistema de registro contable oficial.

### 🔴 Prioridad alta (fiabilidad básica)

1. **Validación matemática automática**
   - Verificar que `subtotal + IVA = total` en Gestión Documental.
   - Verificar que `total_debe = total_haber` en Automatización (ya hay flag `cuadrado`, pero conviene recalcularlo en el cliente, no confiar solo en la IA).
   - Validar el **dígito verificador del RUT** (ya existe `rutDV` en el proyecto — reutilizarlo) y marcar en rojo si no calza.
   - **Por qué**: detecta errores de extracción de la IA sin intervención humana.

2. **Indicador de confianza visible + umbral de revisión**
   - Mostrar siempre el nivel de confianza (ya viene en el JSON) y **forzar revisión manual** cuando sea "baja".
   - Resaltar campos individuales con baja certeza.

3. **Validación cruzada del IVA chileno**
   - Confirmar que el IVA corresponde al 19% del neto; si no, alertar (posible documento exento, error o boleta).

4. **Doble pasada / verificación de la IA**
   - Para montos críticos, pedir a Claude que re-verifique su propia extracción (self-consistency) o ejecutar el análisis 2 veces y comparar.

### 🟡 Prioridad media (robustez operativa)

5. **Soporte multi-página real en PDF**
   - Hoy se procesa principalmente la primera página. Cartolas y estados financieros suelen tener varias páginas. Enviar todas las páginas como imágenes separadas.

6. **Plan de cuentas configurable de Kavak**
   - Cargar el plan de cuentas real de Kavak (desde una pestaña de Sheets) y pasarlo en el prompt de Automatización para que use los códigos correctos.

7. **Conexión directa con SII / facturación electrónica**
   - Validar facturas contra el **XML del DTE** o el portal del SII (folio, RUT, monto) en vez de solo leer la imagen. Esto elimina la mayor fuente de error.

8. **Tolerancia configurable en conciliación**
   - Permitir ajustar el rango de fechas (±N días) y un margen de monto, además de manejar conciliaciones muchos-a-uno (varios cargos = un asiento).

9. **Registro de auditoría**
   - Guardar en Sheets quién analizó qué, cuándo, con qué documento (hash), el resultado y si fue revisado/aprobado. Trazabilidad completa.

10. **Edición manual del resultado antes de guardar**
    - Permitir corregir un dato extraído antes de exportar/guardar, en lugar de re-subir el documento.

### 🟢 Prioridad baja (escalabilidad y experiencia)

11. **Exportación a formatos contables** (además de CSV): Excel con formato, o formato de importación del ERP de Kavak.
12. **Procesamiento por lotes**: subir 20 facturas y procesarlas en cola.
13. **Detección de duplicados**: avisar si un documento (por número + RUT) ya fue procesado.
14. **Dashboard financiero dedicado** en Sheets: gráficos de gastos por categoría, conciliaciones por día, montos procesados.
15. **Internacionalización**: parametrizar para otros mercados Kavak (México, Brasil) con sus formatos tributarios.

### Recomendación de gobernanza
Antes de usar la suite para decisiones con impacto monetario directo:
- Definir un **flujo de aprobación humana** obligatorio (la IA propone, una persona aprueba).
- Establecer un **período de validación en paralelo** (comparar salida de la IA vs. proceso manual durante X semanas y medir precisión).
- Documentar que las salidas son **estimaciones asistidas por IA**, no documentos contables oficiales, hasta validar la precisión.

---

*Documento generado para el equipo de Finanzas — Kavak Supply Chile.*
