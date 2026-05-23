/**
 * PCC Group — AI Adoption Dashboard Auto-Updater + Weekly Report
 * v4 — No AI API needed (100% Free)
 *
 * SETUP:
 * 1. script.google.com → วาง code นี้ → Save
 * 2. Script Properties: GITHUB_TOKEN = ghp_...
 * 3. Run → updateDashboard → Authorize
 * 4. Triggers ⏰:
 *    ① updateDashboard  → Day timer  → 9am–10am
 *    ② weeklyReport     → Week timer → Monday 9am
 */

// ── Config ────────────────────────────────────────────────────────
var PROPS     = PropertiesService.getScriptProperties();
var GH_TOKEN  = PROPS.getProperty('GITHUB_TOKEN');
var GH_REPO   = 'jinnaphas/AIadoption';
var GH_FILE   = 'ai_adoption_dashboard.html';

var REPORT_EMAILS = [
  'jinnaphas.phas@gmail.com',
  'jinnaphas.p@precise.co.th',
  'nicha.n@precise.co.th'
];

var USER_FOLDERS = {
  narawit:     { name: 'นราวิช (Nick)',     folder: '152ze23bdvba32lpKtHtkJwVrCyEf2aoG', role: 'Agentic Transformation PCC Group',            av: 'น', c: 'n', level: 5, color: '#0077cc' },
  earth:       { name: 'Earth (Jinnaphas)', folder: '1MX08bN2eeHKHqGW_3fvKEEWj9LqVErC_', role: 'HR Manager & OD Strategy Lead · PCC',          av: 'E', c: 'e', level: 4, color: '#d97706' },
  pattaratida: { name: 'Pattaratida K.',   folder: '1f1cO05r54YJpgOBswV8WlQnWauw8Hh32', role: 'B2B Sales Intelligence · PCC Group',            av: 'ภ', c: 'p', level: 3, color: '#db2777' },
  manaporn:    { name: 'มนพร (Belle)',      folder: '1_qUjDQKbTGbXKZorTFod84tIS5Op8dzL', role: 'Business Development · Switchgear · PCC Group', av: 'ม', c: 'm', level: 4, color: '#0d9488' }
};

// ═══════════════════════════════════════════════════════════════════
// PART 1 — DASHBOARD STATS UPDATE (ทุกวัน 09:00)
// ═══════════════════════════════════════════════════════════════════

function updateDashboard() {
  Logger.log('📂 Reading Drive...');
  var files = readDrive();

  Logger.log('🔍 Checking changes...');
  if (!hasChanges(files)) { Logger.log('✅ No changes.'); return; }

  Logger.log('📊 Updating stats in dashboard...');
  updateStats(files);
  Logger.log('✅ Done!');
}

function updateStats(files) {
  var hdrs = { 'Authorization':'token '+GH_TOKEN, 'Content-Type':'application/json', 'User-Agent':'PCC-Apps-Script' };
  var url  = 'https://api.github.com/repos/'+GH_REPO+'/contents/'+GH_FILE;

  // ดึง HTML ปัจจุบัน
  var get  = UrlFetchApp.fetch(url, { headers: hdrs, muteHttpExceptions: true });
  if (get.getResponseCode() !== 200) throw new Error('Fetch failed: ' + get.getResponseCode());

  var ghData = JSON.parse(get.getContentText());
  var html   = Utilities.newBlob(Utilities.base64Decode(ghData.content.replace(/\n/g,''))).getDataAsString();
  var sha    = ghData.sha;

  // นับ UCs
  var totalUCs = 0;
  for (var uid in USER_FOLDERS) {
    var count = (files[uid] || []).length;
    totalUCs += count;
    Logger.log('  ' + USER_FOLDERS[uid].name + ': ' + count + ' UCs');
  }
  Logger.log('Total UCs: ' + totalUCs);

  // อัปเดต Total UCs
  html = html.replace(
    /(<div class="stat-val" style="color:var\(--gold\)">)\d+(<\/div>)/,
    '$1' + totalUCs + '$2'
  );

  // อัปเดตวันที่
  var now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd MMM yyyy');
  html = html.replace(/อัปเดต \d+ [^\<]+2569/, 'อัปเดต ' + now + ' 2569');
  html = html.replace(/อัปเดต \d+ [A-Za-z]+ \d{4}/, 'อัปเดต ' + now);

  // Push
  var nowFull = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm');
  var payload = {
    message: '🤖 Auto-update — ' + nowFull + ' (' + totalUCs + ' UCs)',
    content: Utilities.base64Encode(html, Utilities.Charset.UTF_8),
    sha: sha
  };
  var put  = UrlFetchApp.fetch(url, { method:'put', headers:hdrs, payload:JSON.stringify(payload), muteHttpExceptions:true });
  var code = put.getResponseCode();
  if (code===200||code===201) Logger.log('✅ GitHub updated! Total UCs: '+totalUCs);
  else throw new Error('Push failed '+code+': '+put.getContentText().slice(0,200));
}

// ═══════════════════════════════════════════════════════════════════
// SHARED: Read Drive + Change Detection
// ═══════════════════════════════════════════════════════════════════

function readDrive() {
  var out = {};
  for (var uid in USER_FOLDERS) {
    var info = USER_FOLDERS[uid];
    var iter = DriveApp.getFolderById(info.folder).getFiles();
    var list = [];
    while (iter.hasNext()) {
      var f = iter.next();
      if (f.getName().slice(-3) === '.md') {
        list.push({ id: f.getId(), name: f.getName() });
      }
    }
    out[uid] = list;
    Logger.log('  ' + info.name + ': ' + list.length + ' UCs');
  }
  return out;
}

function md5(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
    .map(function(b){ return (b<0?b+256:b).toString(16).padStart(2,'0'); }).join('');
}

function hasChanges(files) {
  var old = JSON.parse(PROPS.getProperty('STATE') || '{}');
  var nw  = {}, chg = false;
  for (var uid in files) {
    files[uid].forEach(function(f) {
      var h = md5(f.id + f.name);
      nw[f.id] = h;
      if (!old[f.id] || old[f.id] !== h) chg = true;
    });
  }
  if (chg) PROPS.setProperty('STATE', JSON.stringify(nw));
  return chg;
}

// ═══════════════════════════════════════════════════════════════════
// PART 2 — WEEKLY REPORT (ทุกจันทร์ 09:00)
// ═══════════════════════════════════════════════════════════════════

function weeklyReport() {
  Logger.log('📧 Building Weekly Report...');
  var files = readDrive();
  var html  = buildReport(files);
  sendEmail(html);
  Logger.log('✅ Report sent!');
}

function buildReport(files) {
  var now    = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd MMM yyyy HH:mm');
  var cutoff = new Date(Date.now() - 14*24*60*60*1000);

  var levelColors = { 1:'#3b82f6',2:'#0891b2',3:'#059669',4:'#d97706',5:'#ea580c',6:'#dc2626',7:'#7c3aed' };
  var levelNames  = { 1:'Basic',2:'Prompt',3:'Integrator',4:'Builder',5:'Automator',6:'Agentic',7:'Architect' };

  var totalUCs = 0, levelSum = 0, memberCount = 0;
  var memberRows = '', newUCRows = '';

  for (var uid in USER_FOLDERS) {
    var info  = USER_FOLDERS[uid];
    var ucs   = files[uid] || [];
    var lv    = info.level;
    var col   = info.color;
    var lcol  = levelColors[lv] || '#059669';

    totalUCs  += ucs.length;
    levelSum  += lv;
    memberCount++;

    // Member row
    memberRows += '<tr>'
      + '<td style="padding:12px 16px;border-bottom:1px solid #eaf0f8">'
      + '<div style="display:flex;align-items:center;gap:10px">'
      + '<div style="width:34px;height:34px;border-radius:8px;background:'+col+';color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center">'+info.av+'</div>'
      + '<div><div style="font-weight:700;color:#1a2b3c;font-size:.85rem">'+info.name+'</div>'
      + '<div style="font-size:.7rem;color:#8aa0b4">'+info.role+'</div></div></div></td>'
      + '<td style="padding:12px 16px;border-bottom:1px solid #eaf0f8;text-align:center"><span style="font-size:1.4rem;font-weight:800;color:'+col+'">'+ucs.length+'</span></td>'
      + '<td style="padding:12px 16px;border-bottom:1px solid #eaf0f8;text-align:center"><span style="background:'+lcol+'18;color:'+lcol+';border:1px solid '+lcol+'44;border-radius:12px;padding:3px 12px;font-size:.75rem;font-weight:700">L'+lv+' '+levelNames[lv]+'</span></td>'
      + '</tr>';

    // New UCs (last 14 days)
    ucs.forEach(function(f) {
      var m = f.name.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m && new Date(m[1]) >= cutoff) {
        var title = f.name.replace(/^\d{4}-\d{2}-\d{2}-?/, '').replace(/-/g,' ').replace('.md','');
        newUCRows += '<tr>'
          + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8"><div style="width:8px;height:8px;border-radius:50%;background:'+col+';display:inline-block;margin-right:8px"></div><strong style="color:#1a2b3c;font-size:.82rem">'+info.name+'</strong></td>'
          + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;color:#4a6278;font-size:.8rem">'+title+'</td>'
          + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;color:#8aa0b4;font-size:.76rem">'+m[1]+'</td>'
          + '</tr>';
      }
    });
  }

  var avgLevel = (levelSum/memberCount).toFixed(1);
  var q3Pct   = Math.round((avgLevel/5)*100);

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    + '<body style="margin:0;padding:0;background:#f0f4f9;font-family:Segoe UI,sans-serif">'
    + '<div style="max-width:660px;margin:0 auto;padding:24px 16px">'

    + '<div style="background:linear-gradient(135deg,#0077cc,#0ea5e9);border-radius:16px;padding:26px 30px;margin-bottom:14px;color:#fff">'
    + '<div style="font-size:.72rem;opacity:.8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px">📊 PCC Group · AI Adoption Weekly Report</div>'
    + '<div style="font-size:1.55rem;font-weight:800;margin-bottom:5px">สรุปประจำสัปดาห์</div>'
    + '<div style="font-size:.82rem;opacity:.85">'+now+' · Auto-generated · No AI API (Free)</div>'
    + '</div>'

    + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">'
    + '<div style="background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid #dae3ef"><div style="font-size:2rem;font-weight:800;color:#0077cc">'+totalUCs+'</div><div style="font-size:.7rem;color:#8aa0b4;margin-top:4px">Total Use Cases</div></div>'
    + '<div style="background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid #dae3ef"><div style="font-size:2rem;font-weight:800;color:#d97706">'+avgLevel+'</div><div style="font-size:.7rem;color:#8aa0b4;margin-top:4px">Team Avg Level</div></div>'
    + '<div style="background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid #dae3ef"><div style="font-size:2rem;font-weight:800;color:#16a34a">'+q3Pct+'%</div><div style="font-size:.7rem;color:#8aa0b4;margin-top:4px">Q3 Progress → L5</div></div>'
    + '</div>'

    + '<div style="background:#fff;border-radius:12px;border:1px solid #dae3ef;margin-bottom:14px;overflow:hidden">'
    + '<div style="padding:14px 20px;font-size:.68rem;color:#8aa0b4;text-transform:uppercase;letter-spacing:1px;font-weight:700">👥 สถานะรายคน</div>'
    + '<table style="width:100%;border-collapse:collapse"><tr style="background:#f5f8fc">'
    + '<th style="padding:8px 16px;text-align:left;font-size:.66rem;color:#8aa0b4">Member</th>'
    + '<th style="padding:8px 16px;text-align:center;font-size:.66rem;color:#8aa0b4">UCs</th>'
    + '<th style="padding:8px 16px;text-align:center;font-size:.66rem;color:#8aa0b4">Level</th></tr>'
    + memberRows + '</table></div>'

    + (newUCRows
      ? '<div style="background:#fff;border-radius:12px;border:1px solid #dae3ef;margin-bottom:14px;overflow:hidden">'
        + '<div style="padding:14px 20px;font-size:.68rem;color:#16a34a;text-transform:uppercase;letter-spacing:1px;font-weight:700">✨ Use Cases ใหม่ (14 วันที่ผ่านมา)</div>'
        + '<table style="width:100%;border-collapse:collapse"><tr style="background:#f5f8fc">'
        + '<th style="padding:8px 14px;text-align:left;font-size:.66rem;color:#8aa0b4">คน</th>'
        + '<th style="padding:8px 14px;text-align:left;font-size:.66rem;color:#8aa0b4">Use Case</th>'
        + '<th style="padding:8px 14px;text-align:left;font-size:.66rem;color:#8aa0b4">วันที่</th></tr>'
        + newUCRows + '</table></div>'
      : '<div style="background:#edfaf3;border:1px solid #86efac;border-radius:12px;padding:14px 20px;margin-bottom:14px;color:#16a34a;font-size:.84rem">✅ ไม่มี Use Case ใหม่ใน 14 วันที่ผ่านมา</div>')

    + '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-bottom:14px">'
    + '<div style="font-size:.68rem;color:#d97706;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:10px">🎯 Roadmap Q3/2026</div>'
    + '<div style="font-size:.82rem;color:#1a2b3c;line-height:2.1">'
    + '🚀 <strong>Nick → L6:</strong> Proactive Notification เมื่อทีมไม่มี UC ใหม่เกิน 2 สัปดาห์<br>'
    + '⚡ <strong>Earth → L5:</strong> Setup Apps Script ให้ครบ + HC Dashboard auto-trigger<br>'
    + '🏭 <strong>Belle → L5:</strong> Python Script auto-update Forecast เมื่อ Excel เปลี่ยน<br>'
    + '📈 <strong>Pattaratida → L4:</strong> แปลง Sales Intelligence เป็น Script อิสระ'
    + '</div></div>'

    + '<div style="text-align:center;padding:14px;font-size:.68rem;color:#8aa0b4">'
    + '🤖 Auto-generated · Google Apps Script · PCC Group · 100% Free (no AI API)<br>'
    + '<a href="https://jinnaphas.github.io/AIadoption/" style="color:#0077cc">ดู Live Dashboard →</a>'
    + '</div></div></body></html>';
}

function sendEmail(htmlBody) {
  var subject = '📊 AI Adoption Weekly — '
    + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd MMM yyyy')
    + ' · PCC Group';
  REPORT_EMAILS.forEach(function(email) {
    MailApp.sendEmail({ to: email, subject: subject, htmlBody: htmlBody, name: 'PCC AI Adoption 🤖' });
    Logger.log('  Sent → ' + email);
  });
}

// ── Test functions ─────────────────────────────────────────────────
function testWeeklyReport() {
  Logger.log('🧪 Test weekly report...');
  weeklyReport();
}

function testDashboardUpdate() {
  Logger.log('🧪 Test dashboard update...');
  // Force update by clearing state
  PROPS.deleteProperty('STATE');
  updateDashboard();
}
