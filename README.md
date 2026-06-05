# Kavak Supply Tools — Apps Script

Web App de Apps Script para Supply Chile. Automatiza el dictamen legal de documentos
vehiculares (C2B) y de empresas (B2B) con Claude Vision, más utilidades de validación.

## Archivos

| Archivo (repo) | Nombre en Apps Script | Descripción |
|---|---|---|
| `Codigo.gs` | `Codigo` (Code.gs) | Router (`doGet`) + `include()` + proxy `callClaude` |
| `hub.html` | `hub` | Shell: sidebar + carga DocScan/B2BScan/Validador en iframes |
| `docscan.html` | `docscan` | DocScan (C2B) — servido por `?page=docscan` |
| `b2bscan.html` | `b2bscan` | B2B Scan — servido por `?page=b2bscan` |
| `validador.html` | `validador` | Validador de RUT/patente — servido por `?page=validador` |
| `_styles_hub.html` | `_styles_hub` | CSS global del hub (partial) |
| `_header.html` | `_header` | Header compartido (partial) |
| `_sidebar.html` | `_sidebar` | Sidebar compartido (partial) |

> **Importante:** el nombre del archivo HTML en Apps Script debe coincidir EXACTAMENTE
> con el de la tabla (sin `.html`). El router hace `createTemplateFromFile('docscan')`,
> así que el archivo debe llamarse `docscan`, no `DOCScan_v3_standalone`.

## Deploy en Apps Script

1. Ir a [script.google.com](https://script.google.com) → Nuevo proyecto.
2. Pegar `Codigo.gs` en el archivo `Code.gs`.
3. Crear un archivo HTML por cada fila de la tabla con el nombre exacto indicado y pegar su contenido.
4. **Configurar la API key** (obligatorio): *Configuración del proyecto → Propiedades del script → Agregar propiedad*:
   - Propiedad: `ANTHROPIC_KEY`
   - Valor: tu API key de Anthropic (`sk-ant-...`)
   La key vive sólo en el servidor; nunca se envía al navegador.
5. Implementar → Nueva implementación → Aplicación web:
   - Ejecutar como: **Yo**
   - Acceso: **Cualquier usuario de Kavak**
6. Copiar la URL `/exec` y compartirla con el equipo.
7. Cada cambio de código requiere una **nueva versión** de la implementación.

## Arquitectura

- `doGet(?page=hub|docscan|b2bscan|validador)` → `buildPage(name)` con `HtmlService`.
- El **hub** ya no embebe las herramientas: las carga en `<iframe src="…?page=…">` de forma
  diferida (al abrir cada una). Una sola fuente de verdad por herramienta.
- Las llamadas a Claude pasan por `google.script.run.callClaude(payload)` → `UrlFetchApp`
  en el servidor. El frontend conserva su lógica de reintentos/overload.

## Herramientas

### DocScan (C2B)
- Análisis de RT, SOAP, Permiso de Circulación, padrón, cédula.
- Compresión de imágenes y render de PDF (pdf.js) antes de enviar.
- Detección de vigencia/vencimiento y deuda estimada.
- Validación de RUT (módulo 11) con **sugerencia de dígito verificador** cuando no calza.
- **Dictamen consolidado**: al analizar varios documentos juntos, cruza RUT/patente entre
  ellos, valida vigencias y entrega un veredicto copiable con alertas.
- Historial local con búsqueda, export CSV, timer de inspección.

### B2B Scan
- Módulos: Estatuto, Vigencia societaria, E-RUT SII.
- Detecta COBRAR Y PERCIBIR, "en un día" vs notarial, administrador/rep. legal.
- Links a modificaciones en el Registro de Empresas y Sociedades.

### Validador
- Valida RUT chileno (dígito verificador) y formato de patente al instante, sin IA ni subir documento.
- Sugiere el RUT correcto y normaliza la patente. Botones de copiado.
