/**
 * Kavak Supply Tools — Apps Script Web App
 */

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'hub';
  const validPages = ['hub', 'docscan', 'b2bscan', 'validador'];
  const target = validPages.includes(page) ? page : 'hub';
  return buildPage(target);
}

function buildPage(name) {
  const template = HtmlService.createTemplateFromFile(name);
  template.VERSION     = '1.1.0';
  template.ACTIVE_PAGE = name;
  template.BASE_URL    = ScriptApp.getService().getUrl();
  return template.evaluate()
    .setTitle('Kavak Supply Tools')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Proxy server-side a la Messages API de Claude.
 * La API key vive en Configuración del proyecto → Propiedades del script → ANTHROPIC_KEY,
 * nunca en el cliente. El frontend la invoca con google.script.run.callClaude(payload).
 *
 * Devuelve un JSON string: {"status": <httpCode>, "body": "<respuesta cruda de Anthropic>"}
 * para que el cliente conserve su lógica de reintentos/overload.
 */
function callClaude(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
  if (!key) {
    return JSON.stringify({ status: 500, body: JSON.stringify({ error: { message: 'Falta ANTHROPIC_KEY en Propiedades del script.' } }) });
  }
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return JSON.stringify({ status: res.getResponseCode(), body: res.getContentText() });
}
