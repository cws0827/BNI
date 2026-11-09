/* ============================================================
   大信鍊金術師：黃金矩陣計畫 — Google Apps Script 後端
   同一個 Apps Script 專案裡要有兩個檔案：
     1. Code.gs（本檔）
     2. bni-core.gs（內容 = repo 裡的 js/bni-core.js，原封不動貼上）
   部署步驟見 apps-script/README.md
   ============================================================ */

var SHEETS = {
  members: {
    name: '會員名單',
    cols: [['name', '姓名'], ['aliases', '別名（逗號分隔）'], ['group', '小組'], ['note', '備註']]
  },
  coordinators: {
    name: '協調員',
    cols: [['name', '姓名'], ['code', '通行碼'], ['role', '角色']]
  },
  weekly: {
    name: '週回報',
    cols: [['id', '紀錄ID'], ['week', '週次'], ['name', '姓名'], ['ref', '外部引薦'], ['close', '成交'],
      ['story', '引薦故事'], ['chain', '服務鏈爆擊'], ['total', '系統合計'], ['selfTotal', '自報合計'],
      ['chains', '服務鏈名單'], ['warnings', '提醒'], ['raw', '原始訊息'], ['reporter', '回報人'],
      ['time', '回報時間'], ['status', '狀態']]
  },
  stories: {
    name: '引薦故事',
    cols: [['id', '紀錄ID'], ['week', '週次'], ['referrer', '引薦人'], ['referee', '被引薦'],
      ['collaborators', '合作會員'], ['participants', '參與會員'], ['scenario', '引薦情境'],
      ['docking', '如何對接'], ['result', '最後結果'], ['raw', '原始訊息'], ['reporter', '回報人'],
      ['time', '回報時間'], ['status', '狀態']]
  },
  log: {
    name: '操作紀錄',
    cols: [['time', '時間'], ['who', '操作人'], ['action', '動作'], ['detail', '內容']]
  }
};

/* ── 第一次使用：在編輯器選 setup 執行一次 ─────────────────── */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (k) {
    var def = SHEETS[k];
    var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, def.cols.length).setValues([def.cols.map(function (c) { return c[1]; })])
        .setFontWeight('bold').setBackground('#1b1b24').setFontColor('#E3B84C');
      sh.setFrozenRows(1);
    }
  });
  var mem = ss.getSheetByName(SHEETS.members.name);
  if (mem.getLastRow() === 1) {
    mem.getRange(2, 1, 3, 4).setValues([
      ['達哥', '', '', '範例，請換成正式名單'],
      ['韋翔', '', '', '範例'],
      ['志安', '', '', '範例']
    ]);
  }
  var co = ss.getSheetByName(SHEETS.coordinators.name);
  if (co.getLastRow() === 1) {
    co.getRange(2, 1, 3, 3).setValues([
      ['協調員一', randomCode_(), '協調員'],
      ['協調員二', randomCode_(), '協調員'],
      ['管理員', randomCode_(), '管理員']
    ]);
  }
  var first = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
}

function randomCode_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/* ── HTTP 入口 ───────────────────────────────────────────── */
// GET：公開資料（會員名單、排行榜），不含原始訊息與客戶資料
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'leaderboard';
  try {
    if (action === 'members') return json_({ ok: true, members: readMembers_() });
    if (action === 'leaderboard') return json_(publicLeaderboard_());
    return json_({ ok: false, error: '未知的動作' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// POST：協調員動作，一律要通行碼
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '資料格式錯誤' }); }
  var who = auth_(body.code);
  if (!who) return json_({ ok: false, error: '通行碼不正確' });
  try {
    switch (body.action) {
      case 'login': return json_({ ok: true, name: who.name, role: who.role, members: readMembers_() });
      case 'submit': return json_(submit_(who, body.items || []));
      case 'week': return json_(week_(body.week));
      case 'void': return json_(voidRow_(who, body.id));
      case 'leaderboard': return json_(publicLeaderboard_());
      default: return json_({ ok: false, error: '未知的動作' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ── 動作 ───────────────────────────────────────────────── */
function auth_(code) {
  code = String(code || '').trim();
  if (!code) return null;
  var list = readRows_(SHEETS.coordinators);
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].code).trim() === code && list[i].name) return { name: list[i].name, role: list[i].role || '協調員' };
  }
  return null;
}

function submit_(who, items) {
  if (!items.length) return { ok: false, error: '沒有資料' };
  if (items.length > 80) return { ok: false, error: '一次最多 80 筆' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var weekly = readRows_(SHEETS.weekly);
    var stories = readRows_(SHEETS.stories);
    var plan = BNICore.planSubmission({ weekly: weekly, stories: stories }, items, {
      reporter: who.name, now: new Date(), members: readMembers_()
    });
    setStatus_(SHEETS.weekly, plan.supersede, BNICore.STATUS.superseded);
    appendRows_(SHEETS.weekly, plan.weeklyAppend);
    appendRows_(SHEETS.stories, plan.storyAppend);
    var saved = plan.results.filter(function (r) { return r.ok; }).length;
    log_(who.name, '送出回報', '成功 ' + saved + ' 筆／共 ' + items.length + ' 筆');
    return { ok: true, results: plan.results };
  } finally {
    lock.releaseLock();
  }
}

function week_(week) {
  if (!BNICore.isWeek(week)) return { ok: false, error: '週次不正確' };
  var members = readMembers_();
  var chk = BNICore.weekCheck(week, readRows_(SHEETS.weekly), readRows_(SHEETS.stories), members);
  return { ok: true, week: week, reports: chk.reports, stories: chk.stories, missing: chk.missing, notes: chk.notes };
}

function voidRow_(who, id) {
  id = String(id || '');
  var def = id.charAt(0) === 'S' ? SHEETS.stories : SHEETS.weekly;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var n = setStatus_(def, [id], BNICore.STATUS.voided);
    if (!n) return { ok: false, error: '找不到這筆紀錄' };
    log_(who.name, '撤銷', id);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function publicLeaderboard_() {
  var lb = BNICore.leaderboard(readRows_(SHEETS.weekly), readMembers_());
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    individuals: lb.individuals.map(function (p) {
      return { rank: p.rank, name: p.name, group: p.group, total: p.total, ref: p.ref, close: p.close, story: p.story, chain: p.chain, weeks: p.weeks };
    }),
    groups: lb.groups
  };
}

/* ── 試算表讀寫 ─────────────────────────────────────────── */
function sheet_(def) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.name);
  if (!sh) throw new Error('找不到工作表「' + def.name + '」，請先執行 setup');
  return sh;
}

function readRows_(def) {
  var sh = sheet_(def);
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var values = sh.getRange(2, 1, n, def.cols.length).getValues();
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    def.cols.forEach(function (c, j) { o[c[0]] = row[j] instanceof Date ? row[j].toISOString() : row[j]; });
    return o;
  });
}

function appendRows_(def, rows) {
  if (!rows.length) return;
  var sh = sheet_(def);
  var values = rows.map(function (r) { return def.cols.map(function (c) { return r[c[0]] == null ? '' : r[c[0]]; }); });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, def.cols.length).setValues(values);
}

function setStatus_(def, ids, status) {
  if (!ids.length) return 0;
  var sh = sheet_(def);
  var col = def.cols.map(function (c) { return c[0]; }).indexOf('status') + 1;
  var n = 0;
  readRows_(def).forEach(function (r) {
    if (ids.indexOf(String(r.id)) >= 0) { sh.getRange(r._row, col).setValue(status); n++; }
  });
  return n;
}

function readMembers_() {
  return readRows_(SHEETS.members).filter(function (r) { return String(r.name).trim(); }).map(function (r) {
    return {
      name: String(r.name).trim(),
      aliases: String(r.aliases || '').split(/[,，、\s]+/).map(function (s) { return s.trim(); }).filter(Boolean),
      group: String(r.group || '').trim()
    };
  });
}

function log_(who, action, detail) {
  appendRows_(SHEETS.log, [{ time: new Date().toISOString(), who: who, action: action, detail: detail }]);
}
