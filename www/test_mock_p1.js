const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const dom = new JSDOM(`<!DOCTYPE html><body></body>`);
global.window = dom.window;
global.document = window.document;
global.Blob = window.Blob;
global.File = window.File;

global.localStorage = { getItem: () => null, setItem: () => {} };
global.PDFLib = require('pdf-lib');
global.alert = console.warn;
global.exportStatusSet = () => {};

// Parse index.html to extract the JS
const code = fs.readFileSync('c:/Users/ingen/Documents/APPS/Antigravity/Logi/www/index.html', 'utf8');
const scriptMatch = code.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
const mainScript = scriptMatch[6].replace(/<\/?script[^>]*>/g, '');

const scriptWrapper = `
${mainScript}

// Mocks
window.PDFLib = global.PDFLib;
const dummySelected = [{ blob: new Blob([new Uint8Array(10)]), id: '123' }];
async function run() {
  try {
    await buildRegistroFotograficoPdfBlob(dummySelected, 'Test', '2024-01-01', '2024-01-01', { applyLogo: false, applyStamp: false, applyTemplate: false });
    console.log('SUCCESS_P1');
  } catch(e) {
    console.error('ERROR_P1:', e);
  }
}
run();
`;

fs.writeFileSync('c:/Users/ingen/Documents/APPS/Antigravity/Logi/www/mock_p1.js', scriptWrapper);
