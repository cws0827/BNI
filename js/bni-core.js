/* ============================================================
   大信鍊金術師：黃金矩陣計畫 — 共用核心
   解析回報訊息、計分、資料檢核、訊息範本。

   同一份檔案三處共用，確保「網頁算的」和「後端算的」一模一樣：
   - 瀏覽器：<script src="js/bni-core.js"></script> → window.BNICore
   - Apps Script：整份貼成 bni-core.gs → 全域 BNICore
   - Node 測試：require('./js/bni-core.js')
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BNICore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ── 活動設定 ─────────────────────────────────────────── */
  var EVENT = {
    title: '大信鍊金術師：黃金矩陣計畫',
    start: '2026-11-09',
    end: '2026-12-18'
  };

  // 每一項的分數。規則若有調整，只改這裡。
  var POINTS = { ref: 1, close: 5, story: 5, chain: 5 };

  var FIELDS = [
    { key: 'ref', label: '外部引薦', unit: '件' },
    { key: 'close', label: '引薦成功成交', unit: '件' },
    { key: 'story', label: '引薦故事', unit: '篇' },
    { key: 'chain', label: '服務鏈爆擊', unit: '條' }
  ];

  // 週次：週一～週日歸同一週（週末補報算當週）。
  var WEEKS = [
    { label: '11/9-13', start: '2026-11-09', end: '2026-11-15' },
    { label: '11/16-20', start: '2026-11-16', end: '2026-11-22' },
    { label: '11/23-27', start: '2026-11-23', end: '2026-11-29' },
    { label: '11/30-12/4', start: '2026-11-30', end: '2026-12-06' },
    { label: '12/7-11', start: '2026-12-07', end: '2026-12-13' },
    { label: '12/14-18', start: '2026-12-14', end: '2026-12-20' }
  ];

  var STATUS = { active: '有效', superseded: '已取代', voided: '已撤銷' };

  /* ── 小工具 ───────────────────────────────────────────── */
  var CN_DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var CN_CLASS = '零〇一二兩两三四五六七八九十';

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  function weekOfDate(d) {
    var s = typeof d === 'string' ? d : ymd(d || new Date());
    if (s < WEEKS[0].start) return WEEKS[0].label;
    for (var i = 0; i < WEEKS.length; i++) {
      if (s >= WEEKS[i].start && s <= WEEKS[i].end) return WEEKS[i].label;
    }
    return WEEKS[WEEKS.length - 1].label;
  }

  function isWeek(label) {
    for (var i = 0; i < WEEKS.length; i++) if (WEEKS[i].label === label) return true;
    return false;
  }

  // 從「11/9-13」「11/9～11/13」「11/16」之類的文字找出週次
  function weekFromText(text) {
    var m = String(text || '').match(/(\d{1,2})\/(\d{1,2})/);
    if (!m) return '';
    var s = '2026-' + pad2(parseInt(m[1], 10)) + '-' + pad2(parseInt(m[2], 10));
    for (var i = 0; i < WEEKS.length; i++) {
      if (s >= WEEKS[i].start && s <= WEEKS[i].end) return WEEKS[i].label;
    }
    return '';
  }

  function normalize(s) {
    s = String(s == null ? '' : s)
      .replace(/\r\n?/g, '\n')
      .replace(/[​-‍⁠﻿]/g, '')
      .replace(/ |　/g, ' ');
    s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    s = s.replace(/[：︰]/g, ':').replace(/／/g, '/').replace(/[～〜]/g, '~')
      .replace(/＋/g, '+').replace(/－/g, '-').replace(/｜/g, '|').replace(/＠/g, '@');
    // 各種箭頭統一成 →
    s = s.replace(/-+>|=+>|[➡➜➔⇒⟶＞>]️?/g, '→');
    return s;
  }

  function stripParens(s) { return String(s).replace(/（[^）]*）|\([^)]*\)/g, ' '); }

  // 去掉行首 emoji、符號、清單編號
  function stripLead(line) {
    return String(line).replace(/^[^㐀-鿿A-Za-z0-9【@]+/, '').replace(/^\d+[.、)]\s*/, '').trim();
  }

  function isBlankValue(v) { return !String(v || '').replace(/[_＿\s件張篇條分次個筆]/g, ''); }

  function cnToInt(s) {
    if (s.indexOf('十') >= 0) {
      var p = s.split('十');
      var tens = p[0] ? CN_DIGIT[p[0].slice(-1)] : 1;
      var ones = p[1] ? CN_DIGIT[p[1].charAt(0)] : 0;
      return (tens || 0) * 10 + (ones || 0);
    }
    var n = 0;
    for (var i = 0; i < s.length; i++) n = n * 10 + (CN_DIGIT[s.charAt(i)] || 0);
    return n;
  }

  function toInt(token) { return /^\d+$/.test(token) ? parseInt(token, 10) : cnToInt(token); }

  function parseCount(v) {
    v = String(v || '');
    var m = v.match(/\d+/);
    if (m) return parseInt(m[0], 10);
    m = v.match(new RegExp('[' + CN_CLASS + ']+'));
    if (m) return cnToInt(m[0]);
    if (/無|沒有|没有|^\s*-\s*$/.test(v)) return 0;
    return null;
  }

  function cleanName(s) {
    return String(s || '').replace(/[（(][^）)]*[）)]/g, '').replace(/[^㐀-鿿A-Za-z·]/g, '');
  }

  function uniq(arr) {
    var out = [];
    arr.forEach(function (x) { if (x && out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  /* ── 會員名稱比對 ─────────────────────────────────────── */
  // members: [{ name, aliases: [], group }]
  function resolveName(raw, members) {
    var s = cleanName(raw);
    if (!s) return { name: '', known: false };
    if (!members || !members.length) return { name: s, known: null };
    var i, j, m;
    for (i = 0; i < members.length; i++) {
      m = members[i];
      if (m.name === s) return { name: m.name, known: true };
      for (j = 0; j < (m.aliases || []).length; j++) if (m.aliases[j] === s) return { name: m.name, known: true };
    }
    // 名字包含在較長字串裡（例如「達哥水電」）
    var best = null, bestLen = 0;
    for (i = 0; i < members.length; i++) {
      m = members[i];
      [m.name].concat(m.aliases || []).forEach(function (n) {
        if (n && n.length >= 2 && s.indexOf(n) >= 0 && n.length > bestLen) { best = m.name; bestLen = n.length; }
      });
    }
    if (best) return { name: best, known: true };
    return { name: s, known: false };
  }

  function memberGroup(name, members) {
    for (var i = 0; i < (members || []).length; i++) if (members[i].name === name) return members[i].group || '';
    return '';
  }

  /* ── 計分 ────────────────────────────────────────────── */
  function computeTotal(counts) {
    var t = 0;
    FIELDS.forEach(function (f) { t += (parseInt(counts[f.key], 10) || 0) * POINTS[f.key]; });
    return t;
  }

  /* ── 拆段：一次貼上很多人的回報 ────────────────────────── */
  var RE_LINE_EXPORT = /^(\d{1,2}:\d{2})\s+([^\t]+?)\t(.*)$/;      // LINE 匯出：時間<TAB>名稱<TAB>內容
  var RE_LINE_DATE = /^\d{4}[./-]\d{1,2}[./-]\d{1,2}/;              // LINE 匯出的日期行

  // 行首是不是某位會員的名字（自然語句回報：「韋翔這週引薦1件」）
  function startsWithMember(core, members) {
    if (!members || !members.length || core.indexOf(':') >= 0 || core.indexOf('→') >= 0) return false;
    if (!/\d|[零一二兩三四五六七八九十]|引薦|成交|故事|爆擊/.test(core)) return false;
    for (var i = 0; i < members.length; i++) {
      var names = [members[i].name].concat(members[i].aliases || []);
      for (var j = 0; j < names.length; j++) if (names[j] && names[j].length >= 2 && core.indexOf(names[j]) === 0) return true;
    }
    return false;
  }

  function splitBlocks(text, members) {
    var lines = normalize(text).split('\n');
    var blocks = [];
    var cur = null;
    function open(sender) { cur = { lines: [], sender: sender || '', hasName: false, hasContent: false }; blocks.push(cur); }
    lines.forEach(function (raw) {
      var line = raw, sender = '';
      var ex = line.match(RE_LINE_EXPORT);
      if (ex) { sender = ex[2].trim(); line = ex[3]; open(sender); }
      else if (RE_LINE_DATE.test(line.trim()) && line.trim().length <= 20) return;
      line = line.replace(/^"|"$/g, '');
      var core = stripLead(line);
      if (!core) { if (cur) cur.lines.push(''); return; }
      var isHeader = /^【/.test(core);
      var isName = /^姓名\s*:/.test(core);
      var isStory = /^引薦人\s*:/.test(core);
      var isNatural = startsWithMember(core, members);
      if (!cur) open();
      else if (isNatural && (cur.hasName || cur.hasContent)) open();
      else if ((isHeader || isStory) && (cur.hasName || cur.hasContent)) open();
      else if (isName && (cur.hasName || cur.hasContent)) open();
      cur.lines.push(line);
      if (isName) cur.hasName = true;
      else if (!isHeader) cur.hasContent = true;
    });
    return blocks.filter(function (b) {
      return b.lines.some(function (l) { return stripLead(l); });
    }).map(function (b) {
      return { lines: b.lines, sender: b.sender, text: b.lines.join('\n').replace(/^\n+|\n+$/g, '') };
    });
  }

  function isStoryBlock(lines) {
    var joined = lines.map(stripLead).join('\n');
    return /(^|\n|\|)\s*引薦人\s*:/.test(joined) && /被引薦/.test(joined);
  }

  /* ── 週回報解析 ───────────────────────────────────────── */
  var RULES = [
    { key: 'total', kw: '合計|總計|總分|積分' },
    { key: 'chain', kw: '爆擊|服務鏈|連鎖' },
    { key: 'story', kw: '故事' },
    { key: 'close', kw: '成交' },
    { key: 'ref', kw: '引薦|轉介' }
  ];

  function classify(label) {
    for (var i = 0; i < RULES.length; i++) if (new RegExp(RULES[i].kw).test(label)) return RULES[i].key;
    return '';
  }

  function parseCountLine(core) {
    var s = stripParens(core).replace(/(\d|三)\s*人以上/g, ' ');
    var ci = s.lastIndexOf(':');
    if (ci >= 0) {
      var key = classify(s.slice(0, ci));
      if (!key) return null;
      var val = s.slice(ci + 1);
      return [{ key: key, value: isBlankValue(val) ? null : parseCount(val) }];
    }
    // 自然語句：「這週引薦3件、成交1件」
    var out = [];
    var work = s;
    RULES.forEach(function (rule) {
      var re = new RegExp('(' + rule.kw + ')[^0-9' + CN_CLASS + ':]{0,10}?([0-9]+|[' + CN_CLASS + ']+)', 'g');
      work = work.replace(re, function (m, kw, num) {
        out.push({ key: rule.key, value: toInt(num) });
        return new Array(m.length + 1).join(' ');
      });
    });
    // 「這週沒有成交」「無故事」
    for (var i = 1; i < RULES.length; i++) {
      var neg = new RegExp('(沒有|没有|無)[^,，、。]{0,4}(' + RULES[i].kw + ')');
      if (neg.test(work)) {
        var key = RULES[i].key;
        if (!out.some(function (o) { return o.key === key; })) out.push({ key: key, value: 0 });
        work = work.replace(neg, ' ');
      }
    }
    return out.length ? out : null;
  }

  function parseChain(core) {
    return core.split('→').map(function (seg) {
      return cleanName(stripParens(seg).split(':').pop());
    }).filter(Boolean);
  }

  function parseWeekly(block, opts) {
    var item = {
      type: 'weekly', week: '', rawName: '', name: '',
      counts: { ref: null, close: null, story: null, chain: null },
      selfTotal: null, chains: [], parseNotes: [], raw: block.text
    };
    block.lines.forEach(function (line) {
      var core = stripLead(line);
      if (!core) return;
      if (/^【/.test(core)) { var wk = weekFromText(core); if (wk) item.week = wk; return; }
      if (/^姓名\s*:/.test(core)) { item.rawName = core.replace(/^姓名\s*:/, '').trim(); return; }
      if (core.indexOf('→') >= 0) {
        var ch = parseChain(core);
        if (ch.length) item.chains.push(ch);
        return;
      }
      var res = parseCountLine(core);
      if (res) {
        res.forEach(function (r) {
          if (r.key === 'total') { if (r.value != null) item.selfTotal = r.value; }
          else if (r.value != null && item.counts[r.key] != null && r.value !== item.counts[r.key]) {
            var f = FIELDS.filter(function (x) { return x.key === r.key; })[0];
            item.parseNotes.push('「' + f.label + '」出現兩次（' + item.counts[r.key] + ' 和 ' + r.value + '），先用後面的，請確認');
            item.counts[r.key] = r.value;
          }
          else if (r.value != null || item.counts[r.key] == null) item.counts[r.key] = r.value;
        });
      } else if (/\d/.test(stripParens(core))) {
        item.parseNotes.push('有一行看不懂：「' + core + '」');
      }
    });
    if (!cleanName(item.rawName) && block.sender) {
      item.rawName = block.sender;
      item.parseNotes.push('姓名欄空白，先用 LINE 發訊者「' + block.sender + '」');
    }
    if (!cleanName(item.rawName) && opts.members && opts.members.length) {
      // 自然語句：找內文第一個出現的會員名字
      var hit = '', pos = Infinity;
      opts.members.forEach(function (m) {
        [m.name].concat(m.aliases || []).forEach(function (n) {
          var p = n ? block.text.indexOf(n) : -1;
          if (p >= 0 && p < pos) { pos = p; hit = m.name; }
        });
      });
      if (hit) { item.rawName = hit; item.parseNotes.push('沒有「姓名」欄，從內文推測是「' + hit + '」，請確認'); }
    }
    if (!item.week) item.week = opts.week || '';
    return prepareWeekly(item, opts.members);
  }

  // 依目前欄位重新計算總分與提醒（解析後、手動修改後都呼叫）
  function prepareWeekly(item, members) {
    var r = resolveName(item.rawName || item.name, members);
    item.name = r.name;
    item.nameKnown = r.known;
    item.chains = (item.chains || []).map(function (ch) {
      return ch.map(function (n) { return resolveName(n, members).name || n; });
    }).filter(function (ch) { return ch.length; });
    item.total = computeTotal(item.counts);
    item.warnings = validateWeekly(item, members);
    return item;
  }

  function validateWeekly(item, members) {
    var w = [];
    var hasList = members && members.length;
    if (!item.week) w.push('沒有週次');
    else if (!isWeek(item.week)) w.push('週次「' + item.week + '」不在活動期間');
    if (!item.name) w.push('沒有姓名');
    else if (hasList && item.nameKnown === false) w.push('「' + item.name + '」不在會員名單');
    var blanks = FIELDS.filter(function (f) { return item.counts[f.key] == null; }).map(function (f) { return f.label; });
    if (blanks.length === FIELDS.length) w.push('四個項目都沒填');
    else if (blanks.length) w.push(blanks.join('、') + ' 未填，以 0 計');
    FIELDS.forEach(function (f) {
      if ((item.counts[f.key] || 0) > 30) w.push(f.label + ' ' + item.counts[f.key] + ' ' + f.unit + '，數字異常偏高');
    });
    if (item.selfTotal != null && item.selfTotal !== item.total) {
      w.push('自己算的合計是 ' + item.selfTotal + ' 分，系統算出 ' + item.total + ' 分');
    }
    var chainN = item.counts.chain || 0;
    if (chainN > 0 && !item.chains.length) w.push('爆擊填了 ' + chainN + ' 條，但沒有列出服務鏈名單');
    else if (item.chains.length && item.chains.length !== chainN) w.push('爆擊填 ' + chainN + ' 條，名單列了 ' + item.chains.length + ' 條');
    item.chains.forEach(function (ch) {
      var label = ch.join('→');
      if (ch.length < 3) w.push('服務鏈「' + label + '」不到 3 人');
      if (item.name && ch.indexOf(item.name) < 0) w.push('服務鏈「' + label + '」裡沒有回報人自己');
      if (hasList) ch.forEach(function (n) {
        if (resolveName(n, members).known === false) w.push('服務鏈裡的「' + n + '」不在會員名單');
      });
    });
    return w;
  }

  /* ── 引薦故事解析 ─────────────────────────────────────── */
  var STORY_LABELS = [
    { key: 'referrer', re: /^引薦人\s*:/ },
    { key: 'referee', re: /^(被引薦|收引薦)[^:]{0,4}:/ },
    { key: 'collab', re: /^(合作會員|標註|協作)[^:]{0,4}:/ },
    { key: 'scenario', re: /^(引薦情境|客戶需求|情境)[^:]{0,8}:/ },
    { key: 'docking', re: /^(如何對接|對接)[^:]{0,4}:/ },
    { key: 'result', re: /^(最後結果|結果)[^:]{0,4}:/ }
  ];
  var PLACEHOLDER = /標註合作會員|^合作會員$/;

  function splitNames(s) {
    return String(s || '').split(/[、,，\/&＆和與及\s]+/).map(cleanName).filter(function (n) { return n && !PLACEHOLDER.test(n); });
  }

  function parseStory(block, opts) {
    var f = { referrer: '', referee: '', collab: [], scenario: '', docking: '', result: '' };
    var current = '';
    block.lines.forEach(function (line) {
      var core = stripLead(line);
      if (!core) return;
      if (/^【/.test(core)) return;
      var parts = core.split('|');
      var matchedAny = false;
      parts.forEach(function (part) {
        part = stripLead(part);
        for (var i = 0; i < STORY_LABELS.length; i++) {
          var L = STORY_LABELS[i];
          if (L.re.test(part)) {
            matchedAny = true;
            current = L.key;
            var v = part.slice(part.indexOf(':') + 1).trim();
            if (L.key === 'referrer' || L.key === 'referee') {
              var inParens = [];
              v.replace(/（([^）]*)）|\(([^)]*)\)/g, function (m, a, b) { inParens.push(a || b); return ''; });
              inParens.forEach(function (p) { f.collab = f.collab.concat(splitNames(p.replace(/^[^:]*:/, ''))); });
              var names = splitNames(stripParens(v).replace(/@[^\s@]+/g, ''));
              f[L.key] = names[0] || '';
              f.collab = f.collab.concat(names.slice(1));
            } else if (L.key === 'collab') {
              f.collab = f.collab.concat(splitNames(v.replace(/@/g, ' ')));
            } else {
              f[L.key] = v;
            }
            return;
          }
        }
      });
      if (!matchedAny && current && ['scenario', 'docking', 'result'].indexOf(current) >= 0) {
        f[current] = (f[current] ? f[current] + '\n' : '') + line.trim();
      }
    });
    var mentions = [];
    block.text.replace(/@([㐀-鿿A-Za-z·]+)/g, function (m, n) { mentions.push(n); return m; });
    var item = {
      type: 'story',
      week: opts.week || '',
      referrer: f.referrer,
      referee: f.referee,
      collaborators: uniq(f.collab.concat(mentions)),
      scenario: f.scenario, docking: f.docking, result: f.result,
      parseNotes: [], raw: block.text
    };
    return prepareStory(item, opts.members);
  }

  function prepareStory(item, members) {
    var known = {};
    function res(n) { var r = resolveName(n, members); known[r.name] = r.known; return r.name; }
    item.referrer = res(item.referrer);
    item.referee = res(item.referee);
    item.collaborators = uniq((item.collaborators || []).map(res)).filter(function (n) {
      return n && n !== item.referrer && n !== item.referee;
    });
    item.participants = uniq([item.referrer, item.referee].concat(item.collaborators));
    var w = [];
    if (!item.week) w.push('沒有週次');
    if (!item.referrer) w.push('沒有引薦人');
    if (!item.referee) w.push('沒有被引薦會員');
    if (members && members.length) item.participants.forEach(function (n) {
      if (known[n] === false) w.push('「' + n + '」不在會員名單');
    });
    if (!String(item.result || '').trim()) w.push('「最後結果」沒有寫');
    if (!String(item.scenario || '').trim()) w.push('「引薦情境」沒有寫');
    item.warnings = w;
    return item;
  }

  /* ── 對外主函式：貼上一段文字 → 解析成多筆 ──────────────── */
  function parseText(text, opts) {
    opts = opts || {};
    return splitBlocks(text, opts.members).map(function (b) {
      return isStoryBlock(b.lines) ? parseStory(b, opts) : parseWeekly(b, opts);
    }).filter(function (item) {
      if (item.type === 'story') return true;
      var any = FIELDS.some(function (f) { return item.counts[f.key] != null; });
      return any || item.chains.length || cleanName(item.rawName);
    });
  }

  /* ── 存檔規劃（後端與示範模式共用） ────────────────────── */
  // existing: { weekly: [row], stories: [row] }，row 為物件
  // ctx: { reporter, now(Date), members }
  function planSubmission(existing, items, ctx) {
    var plan = { weeklyAppend: [], storyAppend: [], supersede: [], results: [] };
    var stamp = ctx.now.getTime().toString(36).toUpperCase();
    var time = ctx.now.toISOString();
    var members = ctx.members || [];
    var activeWeekly = (existing.weekly || []).filter(function (r) { return r.status === STATUS.active; });
    var activeStories = (existing.stories || []).filter(function (r) { return r.status === STATUS.active; });

    items.forEach(function (raw, i) {
      if (!raw || (raw.type !== 'weekly' && raw.type !== 'story')) {
        plan.results.push({ index: i, ok: false, message: '資料格式不正確' }); return;
      }
      var item = JSON.parse(JSON.stringify(raw));
      if (!isWeek(item.week)) { plan.results.push({ index: i, ok: false, message: '週次不正確' }); return; }

      if (item.type === 'weekly') {
        FIELDS.forEach(function (f) {
          var n = parseInt(item.counts && item.counts[f.key], 10);
          item.counts[f.key] = isNaN(n) || n < 0 ? 0 : Math.min(n, 99);
        });
        prepareWeekly(item, members);
        if (!item.name || item.nameKnown === false) {
          plan.results.push({ index: i, ok: false, message: '「' + (item.name || '（空白）') + '」不在會員名單，請先修正姓名' }); return;
        }
        var replaced = activeWeekly.filter(function (r) { return r.week === item.week && r.name === item.name; });
        replaced.forEach(function (r) { plan.supersede.push(r.id); });
        activeWeekly = activeWeekly.filter(function (r) { return replaced.indexOf(r) < 0; });
        var row = {
          id: 'W' + stamp + i, week: item.week, name: item.name,
          ref: item.counts.ref, close: item.counts.close, story: item.counts.story, chain: item.counts.chain,
          total: item.total, selfTotal: item.selfTotal == null ? '' : item.selfTotal,
          chains: item.chains.map(function (c) { return c.join('→'); }).join('；'),
          warnings: item.warnings.join('；'), raw: String(item.raw || '').slice(0, 2000),
          reporter: ctx.reporter, time: time, status: STATUS.active
        };
        plan.weeklyAppend.push(row);
        activeWeekly.push(row);
        plan.results.push({ index: i, ok: true, message: replaced.length ? '已更新（取代先前的回報）' : '已儲存', id: row.id });
      } else {
        prepareStory(item, members);
        var bad = item.participants.filter(function (n) { return resolveName(n, members).known === false; });
        if (!item.referrer || !item.referee || bad.length) {
          plan.results.push({ index: i, ok: false, message: bad.length ? '「' + bad.join('、') + '」不在會員名單' : '引薦人、被引薦都要填' }); return;
        }
        var sig = storySignature(item);
        var dup = activeStories.some(function (r) { return storySignature(r) === sig; });
        if (dup) { plan.results.push({ index: i, ok: false, message: '這篇故事已經登記過' }); return; }
        var srow = {
          id: 'S' + stamp + i, week: item.week, referrer: item.referrer, referee: item.referee,
          collaborators: item.collaborators.join('、'), participants: item.participants.join('、'),
          scenario: item.scenario || '', docking: item.docking || '', result: item.result || '',
          raw: String(item.raw || '').slice(0, 3000),
          reporter: ctx.reporter, time: time, status: STATUS.active
        };
        plan.storyAppend.push(srow);
        activeStories.push(srow);
        plan.results.push({ index: i, ok: true, message: '已登記故事', id: srow.id });
      }
    });
    return plan;
  }

  function storySignature(s) {
    return [s.week, s.referrer, s.referee, String(s.scenario || '').replace(/\s/g, '').slice(0, 30)].join('|');
  }

  /* ── 排行榜 ──────────────────────────────────────────── */
  function leaderboard(weeklyRows, members) {
    members = members || [];
    var by = {};
    members.forEach(function (m) {
      by[m.name] = { name: m.name, group: m.group || '', ref: 0, close: 0, story: 0, chain: 0, total: 0, weeks: {} };
    });
    (weeklyRows || []).forEach(function (r) {
      if (r.status !== STATUS.active) return;
      var p = by[r.name] || (by[r.name] = { name: r.name, group: memberGroup(r.name, members), ref: 0, close: 0, story: 0, chain: 0, total: 0, weeks: {} });
      FIELDS.forEach(function (f) { p[f.key] += parseInt(r[f.key], 10) || 0; });
      var t = computeTotal(r);
      p.total += t;
      p.weeks[r.week] = (p.weeks[r.week] || 0) + t;
    });
    var order = members.map(function (m) { return m.name; });
    var individuals = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return order.indexOf(a.name) - order.indexOf(b.name);
    });
    var rank = 0, prev = null;
    individuals.forEach(function (p, i) { if (p.total !== prev) { rank = i + 1; prev = p.total; } p.rank = rank; });

    var groups = {};
    individuals.forEach(function (p) {
      var g = p.group || '未分組';
      (groups[g] = groups[g] || { group: g, total: 0, members: [] });
      groups[g].total += p.total;
      groups[g].members.push(p.name);
    });
    var groupList = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.total - a.total; });
    return { individuals: individuals, groups: groupList };
  }

  /* ── 單週檢核（協調員總覽用） ─────────────────────────── */
  function weekCheck(week, weeklyRows, storyRows, members) {
    var notes = [];
    var reports = (weeklyRows || []).filter(function (r) { return r.week === week && r.status === STATUS.active; });
    var stories = (storyRows || []).filter(function (r) { return r.week === week && r.status === STATUS.active; });
    var reported = {};
    reports.forEach(function (r) { reported[r.name] = r; });

    var missing = (members || []).filter(function (m) { return !reported[m.name]; }).map(function (m) { return m.name; });

    // 服務鏈：A 列了 A→B→C，B、C 也應該各自回報這條爆擊
    var chains = {};
    reports.forEach(function (r) {
      String(r.chains || '').split('；').filter(Boolean).forEach(function (c) {
        (chains[c] = chains[c] || []).push(r.name);
      });
    });
    Object.keys(chains).forEach(function (c) {
      c.split('→').forEach(function (n) {
        var r = reported[n];
        if (!r) notes.push('服務鏈「' + c + '」：' + n + ' 這週還沒回報');
        else if (!(parseInt(r.chain, 10) > 0)) notes.push('服務鏈「' + c + '」：' + n + ' 的爆擊填 0 條');
      });
    });

    // 故事：以群組貼文為計分依據 → 比對自報篇數與登記的故事
    var storyCount = {};
    stories.forEach(function (s) {
      String(s.participants || '').split('、').filter(Boolean).forEach(function (n) { storyCount[n] = (storyCount[n] || 0) + 1; });
    });
    var names = uniq(Object.keys(storyCount).concat(reports.map(function (r) { return r.name; })));
    names.forEach(function (n) {
      var self = reported[n] ? parseInt(reported[n].story, 10) || 0 : 0;
      var posted = storyCount[n] || 0;
      if (self !== posted) notes.push(n + '：自報故事 ' + self + ' 篇，登記的故事貼文 ' + posted + ' 篇');
    });

    return { reports: reports, stories: stories, missing: missing, notes: notes };
  }

  /* ── 訊息範本 ───────────────────────────────────────── */
  function weeklyTemplate(week) {
    return [
      '【大信鍊金術師｜' + week + '積分回報】',
      '',
      '姓名：＿＿＿＿',
      '',
      '💟本週外部引薦（+1／件）：＿＿件',
      '',
      '💟本週引薦成功成交（+5／件｜引薦會員拿分）：＿＿件',
      '',
      '💟本週完成引薦故事（參與會員各 +5／篇）：＿＿篇',
      '📌 引薦故事須 Po 商務大群組，並標註合作會員，以群組貼文為計分依據',
      '',
      '本週服務鏈3人以上完成服務爆擊分（參與會員各 +5／條）：＿＿條',
      '',
      '🔆如有三人以上服務鏈爆擊（請列出會員名字）',
      '＿＿ → ＿＿ → ＿＿',
      '',
      '⭐ 本週個人積分合計：＿＿分'
    ].join('\n');
  }

  function storyTemplate() {
    return [
      '引薦人：＿＿｜被引薦：＿＿（標註合作會員）',
      '引薦情境／客戶需求：',
      '如何對接：',
      '最後結果：'
    ].join('\n');
  }

  function battleReport(week, lb, topN) {
    topN = topN || 5;
    var medal = ['🥇', '🥈', '🥉', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
    var lines = ['【大信鍊金術師｜' + week + ' 戰況速報】', ''];
    lines.push('🏆 個人積分前 ' + topN + ' 名');
    lb.individuals.filter(function (p) { return p.total > 0; }).slice(0, topN).forEach(function (p) {
      lines.push((medal[p.rank - 1] || p.rank + '.') + ' ' + p.name + '　' + p.total + ' 分');
    });
    if (lb.groups.length > 1 || (lb.groups[0] && lb.groups[0].group !== '未分組')) {
      lines.push('', '👥 小組團隊積分');
      lb.groups.forEach(function (g, i) { lines.push((i + 1) + '. ' + g.group + '　' + g.total + ' 分'); });
    }
    lines.push('', '引薦 × 連結 × 成交 × 故事 × 爆擊', '活動期間 11/9～12/18，繼續衝！');
    return lines.join('\n');
  }

  return {
    EVENT: EVENT, POINTS: POINTS, FIELDS: FIELDS, WEEKS: WEEKS, STATUS: STATUS,
    normalize: normalize, weekOfDate: weekOfDate, weekFromText: weekFromText, isWeek: isWeek,
    resolveName: resolveName, computeTotal: computeTotal,
    splitBlocks: splitBlocks, parseText: parseText,
    prepareWeekly: prepareWeekly, prepareStory: prepareStory,
    planSubmission: planSubmission, leaderboard: leaderboard, weekCheck: weekCheck,
    weeklyTemplate: weeklyTemplate, storyTemplate: storyTemplate, battleReport: battleReport
  };
});
