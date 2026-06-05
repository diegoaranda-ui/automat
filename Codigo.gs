/**
 * Kavak Supply Tools — Apps Script Web App
 */

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'hub';
  const validPages = ['hub', 'docscan', 'b2bscan'];
  const target = validPages.includes(page) ? page : 'hub';
  return buildPage(target);
}

function buildPage(name) {
  const template = HtmlService.createTemplateFromFile(name);
  template.VERSION     = '1.0.0';
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
