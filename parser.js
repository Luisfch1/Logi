const fs=require('fs');const lines=fs.readFileSync('config_reference.js','utf8').split('\n');console.log(lines.map(l=>l.trim().substring(0,80)).filter(l=>l).slice(0,100).join('\n'));
