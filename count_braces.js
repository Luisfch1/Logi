const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\ingen\\Documents\\APPS\\Antigravity\\Logi\\kinetic\\src\\controllers\\CaptureController.js', 'utf8');
const openBraces = (content.match(/{/g) || []).length;
const closeBraces = (content.match(/}/g) || []).length;
console.log(`Open: ${openBraces}, Close: ${closeBraces}`);
