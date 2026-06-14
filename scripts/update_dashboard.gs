/**
 * PCC Group — AI Adoption Dashboard Watchdog + Weekly Report
 * v6 — Manifest-driven stats (data/ucs.json) + new-UC alert
 *
 * Architecture (agreed): "Light auto + Deep on-demand"
 *  - Daily 08:00 → dailyCheck():
 *      • เขียนเลขทางการ (Members / Total UCs / Avg) จาก data/ucs.json → Live ทั้ง 2 ไฟล์
 *      • รีเฟรชวันที่ "อัปเดต <วันนี้>"
 *      • ตรวจจับไฟล์ UC ใหม่ใน Drive (ขึ้นต้น YYYY-MM-DD-, ตัดซ้ำ, ข้าม context)
 *      • อีเมลแจ้งเมื่อพบไฟล์ใหม่ หรือ Drive-detected ไม่ตรงกับ manifest total
 *  - Deep analysis (Modal/Synergy/Insight/6-section) = Claude ทำ on-demand แล้ว push main
 *  - Weekly Mon 08:00 → weeklyReport(): สรุปรายสัปดาห์เป็นอีเมล HTML
 *
 * SETUP:
 *  1) script.google.com → วาง code นี้ → Save
 *  2) Project Settings → Script Properties: GITHUB_TOKEN = ghp_... (ใช้ token ตัวใหม่หลัง revoke ของเก่า)
 *  3) Run dailyCheck ครั้งแรก → Authorize (Drive + Gmail)
 *  4) Triggers ⏰ (ตั้ง Timezone โปรเจกต์เป็น Asia/Bangkok ก่อน):
 *       dailyCheck   → Time-driven → Day timer  → 8am to 9am
 *       weeklyReport → Time-driven → Week timer → Monday 8am to 9am
 */

// ── Config ────────────────────────────────────────────────────────
var PROPS    = PropertiesService.getScriptProperties();
var GH_TOKEN = PROPS.getProperty('GITHUB_TOKEN');
var GH_REPO  = 'jinnaphas/AIadoption';
var GH_FILES = ['index.html', 'ai_adoption_dashboard.html']; // ต้องเหมือนกันเสมอ — อัปเดตทั้งคู่

var REPORT_EMAILS = [
  'jinnaphas.phas@gmail.com',
  'jinnaphas.p@precise.co.th',
  'nicha.n@precise.co.th'
];

var USER_FOLDERS = {
  narawit:     { name: 'นราวิช (Nick)',     folder: '152ze23bdvba32lpKtHtkJwVrCyEf2aoG', role: 'Agentic Transformation PCC Group',            av: 'น', c: 'n', level: 6, color: '#0077cc' },
  earth:       { name: 'Earth (Jinnaphas)', folder: '1MX08bN2eeHKHqGW_3fvKEEWj9LqVErC_', role: 'HR Manager & OD Strategy Lead · PCC',          av: 'E', c: 'e', level: 5, color: '#d97706' },
  pattaratida: { name: 'Pattaratida K.',   folder: '1f1cO05r54YJpgOBswV8WlQnWauw8Hh32', role: 'B2B Sales Intelligence · PCC Group',            av: 'ภ', c: 'p', level: 4, color: '#db2777' },
  manaporn:    { name: 'มนพร (Belle)',      folder: '1_qUjDQKbTGbXKZorTFod84tIS5Op8dzL', role: 'Business Development · Switchgear · PCC Group', av: 'ม', c: 'm', level: 5, color: '#0d9488' },
  jetniphat:   { name: 'Jetniphat',         folder: '11nDqpsgeni3OJuVHnkZ_7mxDe9fzB1pW', role: 'Digital Organization · PCC Group',             av: 'J', c: 'j', level: 3, color: '#f97316' }
};

var TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

// ═══════════════════════════════════════════════════════════════════
// SHARED — เก็บไฟล์ UC (ขึ้นต้นด้วยวันที่ + ตัดซ้ำ + ข้าม context)
// ═══════════════════════════════════════════════════════════════════
function collectUCs() {
  var out = {};
  for (var uid in USER_FOLDERS) {
    var iter = DriveApp.getFolderById(USER_FOLDERS[uid].folder).getFiles();
    var seen = {}, list = [];
    while (iter.hasNext()) {
      var f = iter.next();
      var name = f.getName();
      var m = name.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!m) continue;                                  // ข้ามไฟล์ context (glossary.md ฯลฯ)
      var key = name.toLowerCase()
                    .replace(/\.(md|gdoc|txt)$/, '')
                    .replace(/\s*\(\d+\)\s*$/, '').trim(); // normalize เพื่อตัดไฟล์ซ้ำ
      if (seen[key]) continue;
      seen[key] = true;
      list.push({ id: f.getId(), name: name, date: m[1] });
    }
    list.sort(function(a, b){ return a.date < b.date ? 1 : -1; }); // ล่าสุดก่อน
    out[uid] = list;
  }
  return out;
}

function thaiStamp(d) {
  var tz   = 'Asia/Bangkok';
  var day  = Number(Utilities.formatDate(d, tz, 'd'));
  var mon  = Number(Utilities.formatDate(d, tz, 'M')) - 1;
  var year = Number(Utilities.formatDate(d, tz, 'yyyy')) + 543;
  return day + ' ' + TH_MONTHS[mon] + ' ' + year;
}

// ── GitHub Contents API helpers ────────────────────────────────────
function ghHeaders() {
  return { 'Authorization': 'token ' + GH_TOKEN, 'User-Agent': 'PCC-Apps-Script' };
}
function ghGet(path) {
  var url = 'https://api.github.com/repos/' + GH_REPO + '/contents/' + path;
  var r = UrlFetchApp.fetch(url, { headers: ghHeaders(), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('GET ' + path + ' -> ' + r.getResponseCode());
  var j = JSON.parse(r.getContentText());
  return {
    sha: j.sha,
    html: Utilities.newBlob(Utilities.base64Decode(j.content.replace(/\n/g, ''))).getDataAsString()
  };
}
function ghPut(path, html, sha, msg) {
  var url = 'https://api.github.com/repos/' + GH_REPO + '/contents/' + path;
  var payload = { message: msg, content: Utilities.base64Encode(html, Utilities.Charset.UTF_8), sha: sha };
  var r = UrlFetchApp.fetch(url, {
    method: 'put', headers: ghHeaders(), contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var c = r.getResponseCode();
  if (c !== 200 && c !== 201) throw new Error('PUT ' + path + ' -> ' + c + ': ' + r.getContentText().slice(0, 200));
}

// ═══════════════════════════════════════════════════════════════════
// DAILY 08:00 — Watchdog + Freshness stamp (ไม่ใช้ AI)
// ═══════════════════════════════════════════════════════════════════
function fetchManifest() {
  var url = 'https://raw.githubusercontent.com/' + GH_REPO + '/main/data/ucs.json';
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) { Logger.log('⚠️ manifest fetch ' + r.getResponseCode()); return null; }
  return JSON.parse(r.getContentText());
}

function dailyCheck() {
  Logger.log('📂 Collecting UC files from Drive...');
  var ucs = collectUCs();

  // 1) หาไฟล์ใหม่เทียบกับ SEEN state เดิม
  var old = JSON.parse(PROPS.getProperty('SEEN') || '{}');
  var seen = {}, newFiles = [], totalDetected = 0;
  for (var uid in ucs) {
    ucs[uid].forEach(function(f) {
      seen[f.id] = 1; totalDetected++;
      if (!old[f.id]) newFiles.push({ uid: uid, name: f.name, date: f.date });
    });
  }
  PROPS.setProperty('SEEN', JSON.stringify(seen));
  Logger.log('  detected=' + totalDetected + ' new=' + newFiles.length);

  // 2) เขียนเลขทางการจาก manifest + รีเฟรชวันที่ บน Live ทั้ง 2 ไฟล์ (idempotent)
  var man   = fetchManifest();
  var stamp = thaiStamp(new Date());
  GH_FILES.forEach(function(path) {
    var g = ghGet(path);
    var html = g.html;
    if (man && man.team) {
      html = html.replace(/(Team Members<\/div><div class="stat-val" style="color:var\(--accent\)">)\d+(<\/div>)/,      '$1' + man.team.members   + '$2');
      html = html.replace(/(Total Use Cases<\/div><div class="stat-val" style="color:var\(--gold\)">)\d+(<\/div>)/,     '$1' + man.team.total_ucs + '$2');
      html = html.replace(/(Team Avg Level<\/div><div class="stat-val" style="color:var\(--purple\)">)[\d.]+(<\/div>)/,  '$1' + man.team.avg_level + '$2');
    }
    html = html.replace(/อัปเดต\s+\d{1,2}\s+[^\s<]+\s+25\d{2}/, 'อัปเดต ' + stamp);
    if (html !== g.html) ghPut(path, html, g.sha, '🤖 Daily refresh — ' + stamp);
  });

  // 3) แจ้งเตือนถ้ามีไฟล์ใหม่ หรือ Drive-detected ไม่ตรงกับ manifest total
  var manifestTotal = (man && man.team) ? man.team.total_ucs : null;
  var mismatch = (manifestTotal !== null && manifestTotal !== totalDetected);
  if (newFiles.length || mismatch) {
    sendAlert(newFiles, totalDetected, manifestTotal, stamp);
    Logger.log('📧 Alert sent.');
  } else {
    Logger.log('✅ No new UCs, counts match manifest. Stamp = ' + stamp);
  }
}

function sendAlert(newFiles, totalDetected, curatedTotal, stamp) {
  var rows = newFiles.map(function(f) {
    var nm = USER_FOLDERS[f.uid] ? USER_FOLDERS[f.uid].name : f.uid;
    return '<tr>'
      + '<td style="padding:7px 12px;border-bottom:1px solid #eaf0f8">' + nm + '</td>'
      + '<td style="padding:7px 12px;border-bottom:1px solid #eaf0f8">' + f.name + '</td>'
      + '<td style="padding:7px 12px;border-bottom:1px solid #eaf0f8;color:#8aa0b4">' + f.date + '</td>'
      + '</tr>';
  }).join('');

  var mismatchBox = (curatedTotal !== null && curatedTotal !== totalDetected)
    ? '<p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;color:#92400e;font-size:.85rem">'
      + '⚠️ Drive ตรวจพบไฟล์ UC ลงวันที่ <b>' + totalDetected + '</b> ไฟล์ แต่ manifest (data/ucs.json) = <b>' + curatedTotal + '</b> — '
      + 'อาจมี UC ใหม่ที่ยังไม่ได้วิเคราะห์ / ไฟล์ที่ยังไม่ตั้งชื่อด้วยวันที่ / ไฟล์ซ้ำ<br>'
      + 'สั่ง Claude: “วิเคราะห์ UC ใหม่ แล้วอัปเดต Dashboard 6 sections + push main”</p>'
    : '';

  var body = '<div style="font-family:Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#1a2b3c">'
    + '<h2 style="color:#0077cc;margin-bottom:6px">🔔 AI Adoption — ตรวจพบความเคลื่อนไหวใน Drive</h2>'
    + '<p style="color:#4a6278;font-size:.88rem">รีเฟรชวันที่บน Live เป็น <b>' + stamp + '</b> เรียบร้อย</p>'
    + mismatchBox
    + (newFiles.length
        ? '<h3 style="margin-top:18px">ไฟล์ UC ใหม่ (' + newFiles.length + ')</h3>'
          + '<table style="width:100%;border-collapse:collapse;font-size:.85rem">'
          + '<tr style="background:#f5f8fc"><th style="padding:7px 12px;text-align:left">คน</th>'
          + '<th style="padding:7px 12px;text-align:left">ไฟล์</th>'
          + '<th style="padding:7px 12px;text-align:left">วันที่</th></tr>' + rows + '</table>'
        : '')
    + '<p style="margin-top:18px;font-size:.82rem;color:#8aa0b4">'
    + 'ขั้นถัดไป: ให้ Claude อ่านไฟล์เหล่านี้ → ทำ deep update (Employee Card · Modal · 6 sections · Synergy · Insight) → push main</p>'
    + '<p><a href="https://jinnaphas.github.io/AIadoption/" style="color:#0077cc">เปิด Live Dashboard →</a></p></div>';

  REPORT_EMAILS.forEach(function(e) {
    MailApp.sendEmail({ to: e, subject: '🔔 AI Adoption — ตรวจสอบ UC (' + stamp + ')', htmlBody: body, name: 'PCC AI Adoption 🤖' });
  });
}

// ═══════════════════════════════════════════════════════════════════
// WEEKLY MON 08:00 — Email summary
// ═══════════════════════════════════════════════════════════════════
function weeklyReport() {
  Logger.log('📧 Building weekly report...');
  var ucs  = collectUCs();
  var html = buildReport(ucs);
  var subject = '📊 AI Adoption Weekly — ' + thaiStamp(new Date()) + ' · PCC Group';
  REPORT_EMAILS.forEach(function(e) {
    MailApp.sendEmail({ to: e, subject: subject, htmlBody: html, name: 'PCC AI Adoption 🤖' });
    Logger.log('  Sent → ' + e);
  });
  Logger.log('✅ Report sent!');
}

function buildReport(ucs) {
  var now    = thaiStamp(new Date());
  var cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  var levelColors = { 1:'#3b82f6',2:'#0891b2',3:'#059669',4:'#d97706',5:'#ea580c',6:'#dc2626',7:'#7c3aed' };
  var levelNames  = { 1:'Basic',2:'Prompt',3:'Integrator',4:'Builder',5:'Automator',6:'Agentic',7:'Architect' };

  var totalUCs = 0, levelSum = 0, memberCount = 0, memberRows = '', newUCRows = '';

  for (var uid in USER_FOLDERS) {
    var info = USER_FOLDERS[uid];
    var list = ucs[uid] || [];
    var lv   = info.level;
    var lcol = levelColors[lv] || '#059669';

    totalUCs += list.length; levelSum += lv; memberCount++;

    memberRows += '<tr>'
      + '<td style="padding:12px 16px;border-bottom:1px solid #eaf0f8"><div style="display:flex;align-items:center;gap:10px">'
      + '<div style="width:34px;height:34px;border-radius:8px;background:' + info.color + ';color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center">' + info.av + '</div>'
      + '<div><div style="font-weight:700;font-size:.85rem">' + info.name + '</div>'
      + '<div style="font-size:.7rem;color:#8aa0b4">' + info.role + '</div></div></div></td>'
      + '<td style="padding:12px 16px;border-bottom:1px solid #eaf0f8;text-align:center"><span style="font-size:1.4rem;font-weight:800;color:' + info.color + '">' + list.length + '</span></td>'
      + '<td style="padding:12px 16px;border-bottom:1px solid #eaf0f8;text-align:center"><span style="background:' + lcol + '18;color:' + lcol + ';border:1px solid ' + lcol + '44;border-radius:12px;padding:3px 12px;font-size:.75rem;font-weight:700">L' + lv + ' ' + levelNames[lv] + '</span></td>'
      + '</tr>';

    list.forEach(function(f) {
      if (new Date(f.date) >= cutoff) {
        var title = f.name.replace(/^\d{4}-\d{2}-\d{2}-?/, '').replace(/\.(md|txt)$/, '').replace(/-/g, ' ');
        newUCRows += '<tr>'
          + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8"><div style="width:8px;height:8px;border-radius:50%;background:' + info.color + ';display:inline-block;margin-right:8px"></div><strong style="font-size:.82rem">' + info.name + '</strong></td>'
          + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;color:#4a6278;font-size:.8rem">' + title + '</td>'
          + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;color:#8aa0b4;font-size:.76rem">' + f.date + '</td></tr>';
      }
    });
  }

  var avgLevel = (levelSum / memberCount).toFixed(1);

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    + '<body style="margin:0;padding:0;background:#f0f4f9;font-family:Segoe UI,sans-serif">'
    + '<div style="max-width:660px;margin:0 auto;padding:24px 16px">'
    + '<div style="background:linear-gradient(135deg,#0077cc,#0ea5e9);border-radius:16px;padding:26px 30px;margin-bottom:14px;color:#fff">'
    + '<div style="font-size:.72rem;opacity:.8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px">📊 PCC Group · AI Adoption Weekly</div>'
    + '<div style="font-size:1.55rem;font-weight:800;margin-bottom:5px">สรุปประจำสัปดาห์</div>'
    + '<div style="font-size:.82rem;opacity:.85">' + now + ' · Auto-generated (no AI API)</div></div>'
    + '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px">'
    + '<div style="background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid #dae3ef"><div style="font-size:2rem;font-weight:800;color:#0077cc">' + totalUCs + '</div><div style="font-size:.7rem;color:#8aa0b4;margin-top:4px">UC ลงวันที่ (detected)</div></div>'
    + '<div style="background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid #dae3ef"><div style="font-size:2rem;font-weight:800;color:#d97706">' + avgLevel + '</div><div style="font-size:.7rem;color:#8aa0b4;margin-top:4px">Team Avg Level</div></div></div>'
    + '<div style="background:#fff;border-radius:12px;border:1px solid #dae3ef;margin-bottom:14px;overflow:hidden">'
    + '<div style="padding:14px 20px;font-size:.68rem;color:#8aa0b4;text-transform:uppercase;letter-spacing:1px;font-weight:700">👥 สถานะรายคน</div>'
    + '<table style="width:100%;border-collapse:collapse"><tr style="background:#f5f8fc">'
    + '<th style="padding:8px 16px;text-align:left;font-size:.66rem;color:#8aa0b4">Member</th>'
    + '<th style="padding:8px 16px;text-align:center;font-size:.66rem;color:#8aa0b4">UCs</th>'
    + '<th style="padding:8px 16px;text-align:center;font-size:.66rem;color:#8aa0b4">Level</th></tr>'
    + memberRows + '</table></div>'
    + (newUCRows
        ? '<div style="background:#fff;border-radius:12px;border:1px solid #dae3ef;margin-bottom:14px;overflow:hidden">'
          + '<div style="padding:14px 20px;font-size:.68rem;color:#16a34a;text-transform:uppercase;letter-spacing:1px;font-weight:700">✨ ไฟล์ UC ใหม่ (14 วัน)</div>'
          + '<table style="width:100%;border-collapse:collapse"><tr style="background:#f5f8fc">'
          + '<th style="padding:8px 14px;text-align:left;font-size:.66rem;color:#8aa0b4">คน</th>'
          + '<th style="padding:8px 14px;text-align:left;font-size:.66rem;color:#8aa0b4">Use Case</th>'
          + '<th style="padding:8px 14px;text-align:left;font-size:.66rem;color:#8aa0b4">วันที่</th></tr>'
          + newUCRows + '</table></div>'
        : '<div style="background:#edfaf3;border:1px solid #86efac;border-radius:12px;padding:14px 20px;margin-bottom:14px;color:#16a34a;font-size:.84rem">✅ ไม่มีไฟล์ UC ใหม่ใน 14 วัน</div>')
    + '<div style="text-align:center;padding:14px;font-size:.68rem;color:#8aa0b4">'
    + '🤖 Google Apps Script · PCC Group · ตัวเลขเป็น "detected" จากชื่อไฟล์ — เลขทางการดูที่ Live<br>'
    + '<a href="https://jinnaphas.github.io/AIadoption/" style="color:#0077cc">ดู Live Dashboard →</a></div>'
    + '</div></body></html>';
}

// ── Test helpers ───────────────────────────────────────────────────
function testDailyCheck()   { PROPS.deleteProperty('SEEN'); dailyCheck(); } // force: เคลียร์ state แล้วรัน
function testWeeklyReport() { weeklyReport(); }
function listDetectedUCs()  { var u = collectUCs(); for (var k in u) Logger.log(k + ': ' + u[k].length + ' → ' + u[k].map(function(x){return x.name;}).join(', ')); }
