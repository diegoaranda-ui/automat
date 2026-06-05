# Kavak Supply Tools — Apps Script
## Archivos

| Archivo | Descripción |
|---------|-------------|
| `Codigo.gs` | Router principal — pegar en el archivo Code.gs de Apps Script |
| `hub.html` | Hub completo con DocScan y B2BScan embebidos — **este es el principal** |
| `_styles_hub.html` | CSS global compartido (partial) |
| `_header.html` | Header compartido (partial) |
| `_sidebar.html` | Sidebar compartido (partial) |
| `DOCScan_v3_standalone.html` | DocScan para usar solo fuera del hub |
| `B2BScan_v1_standalone.html` | B2B Scan para usar solo fuera del hub |

## Deploy en Apps Script

1. Ir a script.google.com → Nuevo proyecto
2. Pegar `Codigo.gs` en el archivo Code.gs
3. Crear archivo HTML llamado `hub` → pegar contenido de `hub.html`
4. Crear archivo HTML llamado `_styles_hub` → pegar contenido de `_styles_hub.html`
5. Crear archivo HTML llamado `_header` → pegar contenido de `_header.html`
6. Crear archivo HTML llamado `_sidebar` → pegar contenido de `_sidebar.html`
7. Implementar → Nueva implementación → Aplicación web
   - Ejecutar como: Yo
   - Acceso: Cualquier usuario de Kavak
8. Copiar URL y compartir con el equipo

## Herramientas incluidas

### DocScan v3 (C2B)
- Análisis de RT, SOAP y Permiso de Circulación
- Compresión automática de imágenes antes de enviar
- Detección de estado del permiso (vigente/vencido)
- Cálculo de deuda estimada con fórmula: valor_permiso + $35.000 × años_vencidos
- Historial local con búsqueda
- KPI timer de inspección

### B2B Scan v1 (B2B)
- Módulos: Estatuto, Vigencia societaria, E-RUT SII
- Estatuto: detecta COBRAR Y PERCIBIR, En un día vs Notarial, Administrador/Rep. Legal
- Facultades en mayúscula extraídas completas
- Links clickeables a modificaciones en Registro de Empresas y Sociedades
- Análisis simultáneo de los 3 módulos sin perder estado al cambiar tab
- Exportar CSV del historial

## Próximamente
- Autofact (integración con GetAPI.cl o Boostr.cl)
- Panel inspecciones del día (sync BBDD BOT sin IMPORTRANGE)
