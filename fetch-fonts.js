const fs = require('fs');
const http = require('https');
const path = require('path');

const fontsDir = path.join(__dirname, 'www', 'fonts');

if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

async function downloadFont(name, weight, url) {
    return new Promise((resolve, reject) => {
        const dest = path.join(fontsDir, `${name}-${weight}.woff2`);
        const file = fs.createWriteStream(dest);
        http.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`Downloaded ${name}-${weight}.woff2`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

async function run() {
    console.log("Downloading fonts...");
    // Space Grotesk Weights: 500, 700, 900
    await downloadFont('space-grotesk', '500', 'https://fonts.gstatic.com/s/spacegrotesk/v15/V8mQoQDjQSkGpu8pnHXFAA_fyyKXwhrmN2n6.woff2');
    await downloadFont('space-grotesk', '700', 'https://fonts.gstatic.com/s/spacegrotesk/v15/V8mQoQDjQSkGpu8pnHXFAA_fyyKXwhrqNqn6.woff2');
    await downloadFont('space-grotesk', '900', 'https://fonts.gstatic.com/s/spacegrotesk/v15/V8mQoQDjQSkGpu8pnHXFAA_fyyKXwhr7Nqn6.woff2');
    
    // Inter Weights: 300, 400, 500, 700
    await downloadFont('inter', '300', 'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa25L7SUc.woff2');
    await downloadFont('inter', '400', 'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7SUc.woff2');
    await downloadFont('inter', '500', 'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa2JL7SUc.woff2');
    await downloadFont('inter', '700', 'https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1iL7SUc.woff2');
    console.log("All done.");
}

run();
