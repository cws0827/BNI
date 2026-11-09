// 把 js/bni-core.js 和 apps-script/Code.gs 合成一個檔案，部署時只要貼一次。
// 改過任一個來源檔之後執行：node tools/build-gs.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const OUT = path.join(root, 'apps-script', 'all-in-one.gs');

function build() {
  const core = fs.readFileSync(path.join(root, 'js', 'bni-core.js'), 'utf8');
  const code = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');
  return [
    '/* ============================================================',
    '   大信鍊金術師 — Apps Script 一鍵部署檔',
    '   整份複製，貼進 Apps Script 的「程式碼.gs」取代原本內容即可。',
    '   此檔由 tools/build-gs.js 自動產生，請勿直接修改；',
    '   要改程式請改 js/bni-core.js 或 apps-script/Code.gs 再重新產生。',
    '   ============================================================ */',
    '',
    core.trimEnd(),
    '',
    code.trimEnd(),
    ''
  ].join('\n');
}

module.exports = { build, OUT };
if (require.main === module) {
  fs.writeFileSync(OUT, build());
  console.log('已產生 ' + path.relative(root, OUT));
}
