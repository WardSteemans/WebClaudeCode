const w = 'D:/ERP_goed';
const e = w.replace(':\\', '--').replace(':/', '--').replace(/\//g, '-');
console.log('encoded:', e);
const p = require('path').join(require('os').homedir(), '.claude', 'projects', e);
console.log('path:', p);
console.log('exists:', require('fs').existsSync(p));
