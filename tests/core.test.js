// 執行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/bni-core.js');

const MEMBERS = [
  { name: '陳志達', aliases: ['達哥'], group: 'A組' },
  { name: '韋翔', aliases: [], group: 'A組' },
  { name: '志安', aliases: [], group: 'B組' },
  { name: '育文', aliases: [], group: 'B組' }
];

const FILLED = `【大信鍊金術師｜11/9-13積分回報】

姓名：達哥

💟本週外部引薦（+1／件）：2件

💟本週引薦成功成交（+5／件｜引薦會員拿分）：1件

💟本週完成引薦故事（參與會員各 +5／篇）：1篇
📌 引薦故事須 Po 商務大群組，並標註合作會員，以群組貼文為計分依據

本週服務鏈3人以上完成服務爆擊分（參與會員各 +5／條）：1條

🔆如有三人以上服務鏈爆擊（請列出會員名字）
達哥 → 韋翔 → 志安

⭐ 本週個人積分合計：17分`;

test('固定格式：數字、姓名別名、週次、服務鏈都解析正確', () => {
  const [r] = C.parseText(FILLED, { members: MEMBERS });
  assert.equal(r.type, 'weekly');
  assert.equal(r.week, '11/9-13');
  assert.equal(r.name, '陳志達');
  assert.deepEqual(r.counts, { ref: 2, close: 1, story: 1, chain: 1 });
  assert.equal(r.selfTotal, 17);
  assert.equal(r.total, 2 + 5 + 5 + 5);
  assert.deepEqual(r.chains, [['陳志達', '韋翔', '志安']]);
  assert.deepEqual(r.warnings, []);
});

test('範本沒填的欄位是「未填」，不會把標籤裡的 3人、+5 當成數字', () => {
  const [r] = C.parseText(C.weeklyTemplate('11/9-13').replace('＿＿＿＿', '韋翔'), { members: MEMBERS });
  assert.equal(r.name, '韋翔');
  assert.deepEqual(r.counts, { ref: null, close: null, story: null, chain: null });
  assert.deepEqual(r.chains, []);
  assert.equal(r.total, 0);
  assert.ok(r.warnings.includes('四個項目都沒填'));
});

test('全形數字、中文數字、自報合計錯誤會被提醒', () => {
  const text = FILLED.replace('2件', '２件').replace('：1件', '：一件').replace('17分', '20分');
  const [r] = C.parseText(text, { members: MEMBERS });
  assert.equal(r.counts.ref, 2);
  assert.equal(r.counts.close, 1);
  assert.ok(r.warnings.some(w => w.includes('自己算的合計是 20 分')));
});

test('一次貼上兩個人的回報會拆成兩筆', () => {
  const two = FILLED + '\n\n' + FILLED.replace('姓名：達哥', '姓名：志安');
  const items = C.parseText(two, { members: MEMBERS });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => i.name), ['陳志達', '志安']);
});

test('自然語句回報', () => {
  const [r] = C.parseText('韋翔這週引薦3件，成交1件，沒有故事', { members: MEMBERS, week: '11/16-20' });
  assert.equal(r.name, '韋翔');
  assert.equal(r.week, '11/16-20');
  assert.equal(r.counts.ref, 3);
  assert.equal(r.counts.close, 1);
  assert.equal(r.counts.story, 0);
  assert.equal(r.total, 3 + 5);
});

test('海報案例：A→B→C 服務鏈，三人分數 11 / 11 / 5', () => {
  // 達哥：發給B +1、B成交 +5、爆擊 +5
  // 韋翔：發給C +1、C成交 +5、爆擊 +5
  // 志安：爆擊 +5
  const a = C.computeTotal({ ref: 1, close: 1, story: 0, chain: 1 });
  const b = C.computeTotal({ ref: 1, close: 1, story: 0, chain: 1 });
  const c = C.computeTotal({ ref: 0, close: 0, story: 0, chain: 1 });
  assert.deepEqual([a, b, c], [11, 11, 5]);
  // 三人再合寫故事，各 +5
  assert.equal(C.computeTotal({ ref: 1, close: 1, story: 1, chain: 1 }), 16);
});

test('海報案例：A 給 B 成交，A 6 分、B 0 分', () => {
  assert.equal(C.computeTotal({ ref: 1, close: 1, story: 0, chain: 0 }), 6);
  assert.equal(C.computeTotal({ ref: 0, close: 0, story: 0, chain: 0 }), 0);
});

test('引薦故事格式：抓出引薦人、被引薦、合作會員', () => {
  const story = `引薦人：達哥｜被引薦：韋翔（@志安）
引薦情境／客戶需求：客戶新居要做全室水電
如何對接：達哥先約客戶看現場，再介紹韋翔
最後結果：成交，客戶又延伸介紹給志安`;
  const [s] = C.parseText(story, { members: MEMBERS, week: '11/9-13' });
  assert.equal(s.type, 'story');
  assert.equal(s.referrer, '陳志達');
  assert.equal(s.referee, '韋翔');
  assert.deepEqual(s.collaborators, ['志安']);
  assert.deepEqual(s.participants, ['陳志達', '韋翔', '志安']);
  assert.match(s.result, /成交/);
  assert.deepEqual(s.warnings, []);
});

test('故事範本原樣貼上：佔位字不會被當成會員', () => {
  const [s] = C.parseText('引薦人：達哥｜被引薦：韋翔（標註合作會員）\n引薦情境／客戶需求：a\n如何對接：b\n最後結果：c', { members: MEMBERS, week: '11/9-13' });
  assert.deepEqual(s.collaborators, []);
  assert.deepEqual(s.participants, ['陳志達', '韋翔']);
});

test('故事和週回報混在一起貼', () => {
  const mixed = FILLED + '\n\n引薦人：韋翔｜被引薦：志安\n引薦情境／客戶需求：x\n如何對接：y\n最後結果：z';
  const items = C.parseText(mixed, { members: MEMBERS, week: '11/9-13' });
  assert.deepEqual(items.map(i => i.type), ['weekly', 'story']);
});

test('LINE 聊天記錄匯出：姓名空白時用發訊者', () => {
  const exp = '2026.11.13 星期五\n21:03\t韋翔\t"【大信鍊金術師｜11/9-13積分回報】\n姓名：＿＿＿＿\n💟本週外部引薦（+1／件）：1件"';
  const [r] = C.parseText(exp, { members: MEMBERS });
  assert.equal(r.name, '韋翔');
  assert.equal(r.counts.ref, 1);
});

test('名單外的名字、不到三人的服務鏈都會提醒', () => {
  const text = FILLED.replace('姓名：達哥', '姓名：路人甲').replace('達哥 → 韋翔 → 志安', '路人甲 → 韋翔');
  const [r] = C.parseText(text, { members: MEMBERS });
  assert.ok(r.warnings.some(w => w.includes('不在會員名單')));
  assert.ok(r.warnings.some(w => w.includes('不到 3 人')));
});

test('存檔：同一週同一人重報會取代舊的；名單外的人擋下', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const [r] = C.parseText(FILLED, { members: MEMBERS });
  const p1 = C.planSubmission({ weekly: [], stories: [] }, [r], { reporter: '協調員一', now, members: MEMBERS });
  assert.equal(p1.weeklyAppend.length, 1);
  const store = { weekly: p1.weeklyAppend, stories: [] };
  const bad = Object.assign({}, r, { rawName: '路人甲', name: '路人甲' });
  const p2 = C.planSubmission(store, [r, bad], { reporter: '協調員二', now: new Date(now.getTime() + 1000), members: MEMBERS });
  assert.deepEqual(p2.supersede, [p1.weeklyAppend[0].id]);
  assert.equal(p2.results[0].ok, true);
  assert.equal(p2.results[1].ok, false);
});

test('排行榜：個人加總、小組加總、同分同名次', () => {
  const rows = [
    { week: '11/9-13', name: '陳志達', ref: 1, close: 1, story: 0, chain: 1, status: '有效' },
    { week: '11/9-13', name: '韋翔', ref: 1, close: 1, story: 0, chain: 1, status: '有效' },
    { week: '11/9-13', name: '志安', ref: 0, close: 0, story: 0, chain: 1, status: '有效' },
    { week: '11/9-13', name: '志安', ref: 9, close: 9, story: 0, chain: 0, status: '已取代' }
  ];
  const lb = C.leaderboard(rows, MEMBERS);
  assert.deepEqual(lb.individuals.slice(0, 3).map(p => [p.name, p.total, p.rank]), [['陳志達', 11, 1], ['韋翔', 11, 1], ['志安', 5, 3]]);
  assert.deepEqual(lb.groups.map(g => [g.group, g.total]), [['A組', 22], ['B組', 5]]);
});

test('單週檢核：服務鏈有人沒報、故事篇數對不上', () => {
  const weekly = [
    { week: '11/9-13', name: '陳志達', ref: 1, close: 1, story: 1, chain: 1, chains: '陳志達→韋翔→志安', status: '有效' },
    { week: '11/9-13', name: '韋翔', ref: 1, close: 1, story: 0, chain: 0, chains: '', status: '有效' }
  ];
  const stories = [{ week: '11/9-13', participants: '陳志達、韋翔', status: '有效' }];
  const chk = C.weekCheck('11/9-13', weekly, stories, MEMBERS);
  assert.deepEqual(chk.missing, ['志安', '育文']);
  assert.ok(chk.notes.some(n => n.includes('韋翔 的爆擊填 0 條')));
  assert.ok(chk.notes.some(n => n.includes('志安 這週還沒回報')));
  assert.ok(chk.notes.some(n => n.includes('韋翔：自報故事 0 篇，登記的故事貼文 1 篇')));
});

test('週次判斷', () => {
  assert.equal(C.weekOfDate('2026-11-09'), '11/9-13');
  assert.equal(C.weekOfDate('2026-11-15'), '11/9-13');
  assert.equal(C.weekOfDate('2026-12-02'), '11/30-12/4');
  assert.equal(C.weekFromText('【大信鍊金術師｜11/16-20積分回報】'), '11/16-20');
});

test('固定格式後面接一則沒有標頭的自然語句，要拆開而不是蓋掉數字', () => {
  const text = '【大信鍊金術師｜11/9-13積分回報】\n姓名：志安\n💟本週外部引薦（+1／件）：0件\n💟本週引薦成功成交（+5／件｜引薦會員拿分）：0件\n\n韋翔這週引薦1件，成交1件';
  const items = C.parseText(text, { members: MEMBERS });
  assert.equal(items.length, 2);
  assert.equal(items[0].name, '志安');
  assert.equal(items[0].counts.ref, 0);
  assert.equal(items[0].counts.close, 0);
  assert.equal(items[1].name, '韋翔');
  assert.equal(items[1].counts.ref, 1);
});

test('同一則回報同一項出現兩次、數字不同，會提醒', () => {
  const [r] = C.parseText('姓名：志安\n外部引薦：1件\n外部引薦：3件', { members: MEMBERS, week: '11/9-13' });
  assert.equal(r.counts.ref, 3);
  assert.ok(r.parseNotes.some(n => n.includes('出現兩次')));
});

test('正式名單：46 人、9 組，綽號對得上海報上的人', () => {
  const R = C.rosterMembers();
  assert.equal(R.length, 46);
  assert.equal(new Set(R.map(m => m.group)).size, 9);
  const all = R.flatMap(m => [m.name, ...m.aliases]);
  assert.equal(new Set(all).size, all.length, '名字或綽號有重複');
  const n = s => C.resolveName(s, R).name;
  assert.equal(n('達哥'), '黃裕達');
  assert.equal(n('韋翔'), '陳韋翔');
  assert.equal(n('志安'), '許志安');
  assert.equal(n('小姜'), '姜則旭');
  assert.equal(n('mia'), '黃氏英');
  assert.equal(R.find(m => m.name === '林佳欣').role, '組長');
  assert.equal(R.find(m => m.name === '黃氏英').role, '培訓長');
  const [r] = C.parseText(FILLED, { members: R });
  assert.equal(r.name, '黃裕達');
  assert.deepEqual(r.chains, [['黃裕達', '陳韋翔', '許志安']]);
  assert.deepEqual(r.warnings, []);
});

test('一鍵部署檔和原始碼同步（沒同步請執行 node tools/build-gs.js）', () => {
  const fs = require('fs');
  const { build, OUT } = require('../tools/build-gs.js');
  assert.equal(fs.readFileSync(OUT, 'utf8'), build());
});

test('一鍵部署檔在 Apps Script 環境能載入，setup 會寫入 46 位會員', () => {
  const fs = require('fs');
  const vm = require('vm');
  const { OUT } = require('../tools/build-gs.js');
  // 模擬試算表
  const sheets = {};
  function mkSheet(name) {
    const rows = [];
    const sh = {
      name, rows,
      getLastRow: () => rows.length,
      getRange: (r, c, nr, nc) => ({
        setValues(v) { v.forEach((row, i) => { rows[r - 1 + i] = row.slice(); }); return this; },
        getValues() { return rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)); },
        setValue(v) { rows[r - 1][c - 1] = v; },
        setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }
      }),
      setFrozenRows() {}
    };
    sheets[name] = sh; return sh;
  }
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: mkSheet, getSheets: () => Object.values(sheets), deleteSheet() {} };
  const out = [];
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => { out.push(s); return { setMimeType() { return this; } }; } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Math, JSON, Date, String, Object, Array, RegExp, parseInt, isNaN, Infinity
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(OUT, 'utf8'), ctx);
  ctx.setup();
  assert.equal(sheets['會員名單'].rows.length, 47);
  const code = sheets['協調員'].rows[1][1];
  // 登入、送出、讀排行榜，走一遍完整流程
  ctx.doPost({ postData: { contents: JSON.stringify({ action: 'login', code }) } });
  assert.equal(JSON.parse(out.pop()).ok, true);
  const items = ctx.BNICore.parseText('姓名：達哥\n外部引薦：1件\n成交：1件', { members: ctx.BNICore.rosterMembers(), week: '11/9-13' });
  ctx.doPost({ postData: { contents: JSON.stringify({ action: 'submit', code, items }) } });
  assert.equal(JSON.parse(out.pop()).results[0].ok, true);
  ctx.doGet({ parameter: { action: 'leaderboard' } });
  const lb = JSON.parse(out.pop());
  assert.equal(lb.individuals[0].name, '黃裕達');
  assert.equal(lb.individuals[0].total, 6);
  ctx.doPost({ postData: { contents: JSON.stringify({ action: 'login', code: 'wrong' }) } });
  assert.equal(JSON.parse(out.pop()).ok, false);
});
