/**
 * PCC Group — AI Adoption Dashboard Auto-Updater
 * Google Apps Script — ไม่ต้องสร้าง OAuth credentials เลย
 *
 * ══════════════════════════════════════════════
 * SETUP (ทำครั้งเดียว ~3 นาที)
 * ══════════════════════════════════════════════
 * 1. เปิด script.google.com → New project → วาง code นี้ทั้งหมด
 * 2. Project Settings (ฟันเฟือง) → Script Properties → Add:
 *      ANTHROPIC_API_KEY  =  sk-ant-...
 *      GITHUB_TOKEN       =  ghp_...
 * 3. Run → updateDashboard → Authorize (ยืนยัน Drive access)
 * 4. Triggers (นาฬิกา) → Add Trigger:
 *      Function: updateDashboard
 *      Event: Time-based → Day timer → 9am–10am
 * ══════════════════════════════════════════════
 */

// ── Config ────────────────────────────────────────────────────────────────────
var PROPS        = PropertiesService.getScriptProperties();
var ANTH_KEY     = PROPS.getProperty('ANTHROPIC_API_KEY');
var GH_TOKEN     = PROPS.getProperty('GITHUB_TOKEN');
var GH_REPO      = 'jinnaphas/AIadoption';
var GH_FILE      = 'ai_adoption_dashboard.html';

var USER_FOLDERS = {
  narawit:     { name: 'นราวิช',           folder: '152ze23bdvba32lpKtHtkJwVrCyEf2aoG', role: 'HR Strategy & Org Transformation · PCC Group', av: 'น', c: 'n' },
  earth:       { name: 'Earth (Jinnaphas)', folder: '1MX08bN2eeHKHqGW_3fvKEEWj9LqVErC_', role: 'HR Manager & OD Strategy Lead · PCC / SBP',      av: 'E', c: 'e' },
  pattaratida: { name: 'Pattaratida K.',   folder: '1f1cO05r54YJpgOBswV8WlQnWauw8Hh32', role: 'B2B Sales Intelligence · PCC Group',              av: 'ภ', c: 'p' }
};

var LVL_LABEL = { 1:'ทารก — Basic User', 2:'วัยรุ่น — Prompt Engineer', 3:'วัยรุ่นตอนปลาย — Integrator', 4:'ปล่อยของ — The Builder', 5:'ปล่อยมือ — Task Automator', 6:'ปล่อยจอย — Agentic Operator', 7:'คบเด็กสร้างบ้าน — Architect' };
var LVL_EMO   = { 1:'👶', 2:'📝', 3:'⚡', 4:'🔥', 5:'🚀', 6:'🤖', 7:'🏗️' };
var LVL_COL   = { 1:'#3b82f6', 2:'#0891b2', 3:'#059669', 4:'#d97706', 5:'#ea580c', 6:'#dc2626', 7:'#7c3aed' };
var LVL_BG    = { 1:'#eff6ff', 2:'#ecfeff', 3:'#ecfdf5', 4:'#fffbeb', 5:'#fff7ed', 6:'#fef2f2', 7:'#f5f3ff' };

// ── MAIN ──────────────────────────────────────────────────────────────────────
function updateDashboard() {
  Logger.log('📂 Reading Drive...');
  var files = readDrive();

  Logger.log('🔍 Checking changes...');
  if (!hasChanges(files)) { Logger.log('✅ No changes.'); return; }

  Logger.log('🤖 Calling Anthropic API...');
  var analysis = callAI(files);

  Logger.log('🏗️ Building HTML...');
  var html = buildHtml(analysis);

  Logger.log('🚀 Pushing to GitHub...');
  pushGitHub(html);

  Logger.log('✅ Done!');
}

// ── READ DRIVE ────────────────────────────────────────────────────────────────
function readDrive() {
  var out = {};
  for (var uid in USER_FOLDERS) {
    var info = USER_FOLDERS[uid];
    var iter = DriveApp.getFolderById(info.folder).getFiles();
    var list = [];
    while (iter.hasNext()) {
      var f = iter.next();
      if (/^\d{4}-\d{2}-\d{2}/.test(f.getName()) && f.getName().slice(-3) === '.md') {
        list.push({ id: f.getId(), name: f.getName(),
                    content: f.getBlob().getDataAsString().slice(0, 3000) });
      }
    }
    list.sort(function(a,b){ return b.name.localeCompare(a.name); });
    out[uid] = list;
    Logger.log('  ' + info.name + ': ' + list.length + ' UCs');
  }
  return out;
}

// ── CHANGE DETECTION ──────────────────────────────────────────────────────────
function md5(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s)
    .map(function(b){ return (b<0?b+256:b).toString(16).padStart(2,'0'); }).join('');
}

function hasChanges(files) {
  var old = JSON.parse(PROPS.getProperty('STATE') || '{}');
  var nw  = {};
  var chg = false;
  for (var uid in files) {
    files[uid].forEach(function(f) {
      var h = md5(f.content);
      nw[f.id] = h;
      if (!old[f.id] || old[f.id] !== h) chg = true;
    });
  }
  if (chg) PROPS.setProperty('STATE', JSON.stringify(nw));
  return chg;
}

// ── ANTHROPIC API ─────────────────────────────────────────────────────────────
function callAI(files) {
  var lines = [];
  for (var uid in USER_FOLDERS) {
    lines.push('=== ' + USER_FOLDERS[uid].name + ' (' + uid + ') ===');
    (files[uid]||[]).forEach(function(f) {
      lines.push('File: ' + f.name + '\n' + f.content.slice(0, 1200) + '\n---');
    });
  }

  var prompt = 'Analyze AI use cases for PCC Group. Return ONLY compact valid JSON, no markdown.\n\n'
    + lines.join('\n')
    + '\n\nReturn this EXACT JSON structure:\n'
    + '{"team":{"total_ucs":0,"hours_saved":"0+","avg_level":0.0},'
    + '"members":{"narawit":{"level":3,"avg":3.0,"hours":"5+","uc_count":5,'
    + '"tags":["tag1","tag2","tag3","tag4"],'
    + '"analysis":["point1","point2","point3","point4"],'
    + '"next":"recommendation to next level",'
    + '"ucs":[{"title":"UC title","level":3,"date":"2026-05-21","time_saved":"~1 hr","tools":["tool1"],"output":"output desc","insight":"insight text"}]},'
    + '"earth":{"level":4,"avg":4.0,"hours":"27+","uc_count":5,"tags":[],"analysis":[],"next":"","ucs":[]},'
    + '"pattaratida":{"level":3,"avg":3.3,"hours":"28+","uc_count":3,"tags":[],"analysis":[],"next":"","ucs":[]}}}\n'
    + 'Rules: Levels 1-7. Sort ucs by date desc. Fill ALL fields. Return ONLY the JSON object.';

  Logger.log('Calling API with key prefix: ' + (ANTH_KEY ? ANTH_KEY.slice(0,20) + '...' : 'NOT SET'));

  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'x-api-key': ANTH_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    payload: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  var httpCode  = resp.getResponseCode();
  var respText  = resp.getContentText();
  Logger.log('API HTTP status: ' + httpCode);

  if (httpCode !== 200) {
    Logger.log('API Error body: ' + respText.slice(0, 500));
    throw new Error('Anthropic API error ' + httpCode + ': ' + respText.slice(0, 200));
  }

  var respData = JSON.parse(respText);
  if (!respData.content || !respData.content[0] || !respData.content[0].text) {
    Logger.log('Unexpected response: ' + respText.slice(0, 500));
    throw new Error('Unexpected API response — no content[0].text');
  }

  var raw = respData.content[0].text.trim()
    .replace(/^```json?\n?/, '').replace(/\n?```$/, '');

  Logger.log('Raw JSON preview: ' + raw.slice(0, 200));

  try {
    return JSON.parse(raw);
  } catch (e) {
    Logger.log('JSON parse error: ' + e + ' | raw: ' + raw.slice(0, 300));
    throw new Error('Failed to parse AI response as JSON: ' + e);
  }
}

// ── HTML BUILDER ──────────────────────────────────────────────────────────────
function gauge(lv, c) {
  var s = '';
  for (var i=1; i<=7; i++) {
    if (i < lv)      s += '<div class="seg sc-'+c+'"></div>';
    else if (i===lv) s += '<div class="seg sc-'+c+' scg-'+c+'"></div>';
    else             s += '<div class="seg"></div>';
  }
  return s;
}

function ucCard(uc, num, c) {
  var lv    = Math.max(1, Math.min(7, uc.level||3));
  var tools = (uc.tools||[]).slice(0,6).map(function(t){ return '<span class="tool">'+t+'</span>'; }).join('');
  return '<div class="uc">'
    + '<div class="uc-top"><div class="uc-num un-'+c+'">#'+num+'</div>'
    + '<div class="uc-title">'+esc(uc.title||'')+'</div>'
    + '<div class="chip cl'+lv+'">L'+lv+'</div></div>'
    + '<div class="uc-meta"><span>📅 '+esc(uc.date||'')+'</span><span>⏱ '+esc(uc.time_saved||'')+'</span></div>'
    + '<div class="tool-row">'+tools+'</div>'
    + '<div class="uc-output out-'+c+'"><strong>Output:</strong> '+esc(uc.output||'')+'</div>'
    + '<div class="uc-insight">'+esc(uc.insight||'')+'</div></div>';
}

function memberCard(uid, info, m) {
  var lv  = Math.max(1, Math.min(7, (m||{}).level||3));
  var sty = 'background:'+LVL_BG[lv]+';color:'+LVL_COL[lv]+';border:1px solid '+LVL_COL[lv]+'55';
  var tags = ((m||{}).tags||[]).slice(0,4).map(function(t){ return '<span class="tag tag-'+info.c+'">'+esc(t)+'</span>'; }).join('');
  return '<div class="emp-card card-'+info.c+'" onclick="openModal(\''+uid+'\')"> '
    + '<div class="emp-header"><div class="avatar av-'+info.c+'">'+info.av+'</div>'
    + '<div><div class="emp-name">'+esc(info.name)+'</div><div class="emp-role">'+esc(info.role)+'</div></div></div>'
    + '<div class="level-badge" style="'+sty+'">'+LVL_EMO[lv]+' Level '+lv+' — '+LVL_LABEL[lv]+'</div>'
    + '<div class="gauge-wrap"><div class="gauge-labels"><span>L1</span><span>L2</span><span>L3</span><span>L4</span><span>L5</span><span>L6</span><span>L7</span></div>'
    + '<div class="gauge-track">'+gauge(lv, info.c)+'</div></div>'
    + '<div class="mini-stats">'
    + '<div class="mstat"><div class="mstat-v">'+((m||{}).uc_count||0)+'</div><div class="mstat-l">Use Cases</div></div>'
    + '<div class="mstat"><div class="mstat-v">'+((m||{}).avg||0)+'</div><div class="mstat-l">Avg Level</div></div>'
    + '<div class="mstat"><div class="mstat-v">'+esc((m||{}).hours||'?')+'</div><div class="mstat-l">ชม.ประหยัด</div></div>'
    + '</div><div class="tags">'+tags+'</div>'
    + '<button class="drill-btn btn-'+info.c+'" onclick="event.stopPropagation();openModal(\''+uid+'\')">🔍 Drill Down →</button></div>';
}

function memberModal(uid, info, m) {
  var lv  = Math.max(1, Math.min(7, (m||{}).level||3));
  var pts = ((m||{}).analysis||[]).map(function(p){ return '<li>'+esc(p)+'</li>'; }).join('');
  var ucs = ((m||{}).ucs||[]).map(function(u,i){ return ucCard(u, i+1, info.c); }).join('');
  return '<div class="overlay" id="ov-'+uid+'">'
    + '<div class="modal"><div class="modal-head">'
    + '<div><h2>🔍 Use Cases — '+esc(info.name)+'</h2>'
    + '<p>'+esc(info.role)+' · Level '+lv+' — '+LVL_LABEL[lv]+' · '+((m||{}).uc_count||0)+' UCs · Avg '+((m||{}).avg||0)+'</p></div>'
    + '<button class="close-btn" onclick="closeModal(\''+uid+'\')">✕</button></div>'
    + '<div class="modal-body">'
    + '<div class="abox abox-'+info.c+'"><h3>📊 การวิเคราะห์ภาพรวม</h3><ul>'+pts+'</ul>'
    + '<p style="font-size:.72rem;color:var(--text3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">🎯 สู่ Level ถัดไป: '+esc((m||{}).next||'')+'</p></div>'
    + ucs + '</div></div></div>';
}

function lvlMap(members) {
  var rows = '';
  for (var lv = 1; lv <= 7; lv++) {
    var avs = '';
    for (var uid in USER_FOLDERS) {
      if ((members[uid]||{}).level === lv)
        avs += '<div class="mav mav-'+USER_FOLDERS[uid].c+'">'+USER_FOLDERS[uid].av+'</div>';
    }
    rows += '<div class="lvl-row'+(avs?' cur':'')+'"><div class="lvl-num" style="background:'+LVL_BG[lv]+';color:'+LVL_COL[lv]+'">'+lv+'</div>'
      + '<div class="lvl-info"><div class="lvl-name">'+LVL_LABEL[lv]+'</div></div>'
      + (avs ? '<div class="mini-avs">'+avs+'</div>' : '') + '</div>';
  }
  return rows;
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function buildHtml(data) {
  var team    = data.team || {};
  var members = data.members || {};
  var now     = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd MMM yyyy HH:mm') + ' (Bangkok)';

  var cards  = Object.keys(USER_FOLDERS).map(function(uid){ return memberCard(uid, USER_FOLDERS[uid], members[uid]); }).join('');
  var modals = Object.keys(USER_FOLDERS).map(function(uid){ return memberModal(uid, USER_FOLDERS[uid], members[uid]); }).join('');
  var lvmap  = lvlMap(members);

  return '<!DOCTYPE html><html lang="th"><head>'
    + '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">'
    + '<title>AI Adoption Dashboard — PCC Group</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">'
    + '<style>'
    + ':root{--bg:#f0f4f9;--surface:#fff;--surface2:#f5f8fc;--surface3:#eaf0f8;--border:#dae3ef;--border2:#c5d3e2;--text:#1a2b3c;--text2:#4a6278;--text3:#8aa0b4;--accent:#0077cc;--accent-bg:#e8f3ff;--gold:#d97706;--gold-bg:#fef9ec;--green:#16a34a;--green-bg:#edfaf3;--purple:#7c3aed;--purple-bg:#f3eeff;--rose:#db2777;--rose-bg:#fdf2f8}'
    + '*{margin:0;padding:0;box-sizing:border-box}body{font-family:\'Outfit\',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}'
    + 'body::before{content:\'\';position:fixed;inset:0;background-image:radial-gradient(circle,#b8cfe0 1px,transparent 1px);background-size:28px 28px;opacity:.4;pointer-events:none;z-index:0}'
    + '.container{max-width:1200px;margin:0 auto;padding:28px 24px;position:relative;z-index:1}'
    + '.header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:14px}'
    + '.header h1{font-size:1.85rem;font-weight:800;letter-spacing:-.5px;color:var(--text)}.header h1 span{color:var(--accent)}.header p{color:var(--text2);font-size:.84rem;margin-top:5px}'
    + '.live-badge{display:flex;align-items:center;gap:8px;background:var(--green-bg);border:1px solid #bbf7d0;border-radius:20px;padding:7px 16px;font-size:.73rem;color:var(--green);font-family:\'JetBrains Mono\',monospace;white-space:nowrap;font-weight:600}'
    + '.dot{width:7px;height:7px;background:var(--green);border-radius:50%;animation:blink 2s infinite}@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}'
    + '.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}'
    + '.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.06);display:flex;align-items:center;gap:14px}'
    + '.stat-icon{width:44px;height:44px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0}.si1{background:var(--accent-bg)}.si2{background:var(--gold-bg)}.si3{background:var(--green-bg)}.si4{background:var(--purple-bg)}'
    + '.stat-label{font-size:.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px}.stat-val{font-size:1.7rem;font-weight:800;line-height:1}.stat-sub{font-size:.68rem;color:var(--text3);margin-top:3px}'
    + '.cards-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px}'
    + '.emp-card{background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:22px;cursor:pointer;transition:all .22s ease;box-shadow:0 2px 8px rgba(0,0,0,.06);position:relative;overflow:hidden}'
    + '.emp-card::before{content:\'\';position:absolute;top:0;left:0;right:0;height:3px;border-radius:18px 18px 0 0}'
    + '.card-n::before{background:linear-gradient(90deg,var(--accent),#60b4ff)}.card-e::before{background:linear-gradient(90deg,var(--gold),#fbbf24)}.card-p::before{background:linear-gradient(90deg,var(--rose),#f472b6)}'
    + '.card-n:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,119,204,.12)}.card-e:hover{border-color:var(--gold);transform:translateY(-2px);box-shadow:0 8px 28px rgba(217,119,6,.12)}.card-p:hover{border-color:var(--rose);transform:translateY(-2px);box-shadow:0 8px 28px rgba(219,39,119,.12)}'
    + '.emp-header{display:flex;align-items:center;gap:12px;margin-bottom:16px}'
    + '.avatar{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.15rem;font-weight:800;color:#fff;flex-shrink:0}'
    + '.av-n{background:linear-gradient(135deg,#0ea5e9,#0369a1)}.av-e{background:linear-gradient(135deg,#f59e0b,#b45309)}.av-p{background:linear-gradient(135deg,#ec4899,#be185d)}'
    + '.emp-name{font-size:1rem;font-weight:700}.emp-role{font-size:.7rem;color:var(--text2);margin-top:2px;line-height:1.4}'
    + '.level-badge{display:inline-flex;align-items:center;gap:5px;border-radius:8px;padding:4px 10px;font-size:.74rem;font-weight:600;margin-bottom:14px}'
    + '.gauge-wrap{margin-bottom:14px}.gauge-labels{display:flex;justify-content:space-between;font-size:.62rem;color:var(--text3);margin-bottom:6px;font-family:\'JetBrains Mono\',monospace}'
    + '.gauge-track{display:flex;gap:3px;height:7px}.seg{flex:1;border-radius:3px;background:var(--surface3)}'
    + '.sc-n{background:var(--accent)}.scg-n{box-shadow:0 0 7px rgba(0,119,204,.6)}.sc-e{background:var(--gold)}.scg-e{box-shadow:0 0 7px rgba(217,119,6,.6)}.sc-p{background:var(--rose)}.scg-p{box-shadow:0 0 7px rgba(219,39,119,.6)}'
    + '.mini-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:13px}'
    + '.mstat{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center}.mstat-v{font-size:1rem;font-weight:700}.mstat-l{font-size:.6rem;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;font-weight:600}'
    + '.tags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:13px}.tag{font-size:.65rem;padding:3px 8px;border-radius:20px;font-weight:500}'
    + '.tag-n{background:var(--accent-bg);border:1px solid #bfdbfe;color:var(--accent)}.tag-e{background:var(--gold-bg);border:1px solid #fde68a;color:var(--gold)}.tag-p{background:var(--rose-bg);border:1px solid #fbcfe8;color:var(--rose)}'
    + '.drill-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:9px;border-radius:10px;border:1.5px solid var(--border2);background:var(--surface2);font-size:.78rem;font-weight:600;cursor:pointer;transition:all .18s;font-family:\'Outfit\',sans-serif}'
    + '.btn-n{color:var(--accent)}.btn-n:hover{background:var(--accent-bg);border-color:var(--accent)}.btn-e{color:var(--gold)}.btn-e:hover{background:var(--gold-bg);border-color:var(--gold)}.btn-p{color:var(--rose)}.btn-p:hover{background:var(--rose-bg);border-color:var(--rose)}'
    + '.bottom-grid{display:grid;grid-template-columns:1fr 1.4fr;gap:18px}'
    + '.panel{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px;box-shadow:0 1px 4px rgba(0,0,0,.05)}'
    + '.section-title{font-size:.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:16px}'
    + '.lvl-row{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:8px;margin-bottom:3px}.lvl-row.cur{background:var(--surface2);border:1px solid var(--border)}'
    + '.lvl-num{width:27px;height:27px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;flex-shrink:0;font-family:\'JetBrains Mono\',monospace}'
    + '.lvl-info{flex:1}.lvl-name{font-size:.8rem;font-weight:600}.mini-avs{display:flex;gap:4px}'
    + '.mav{width:22px;height:22px;border-radius:5px;font-size:.58rem;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:center}'
    + '.mav-n{background:linear-gradient(135deg,#0ea5e9,#0369a1)}.mav-e{background:linear-gradient(135deg,#f59e0b,#b45309)}.mav-p{background:linear-gradient(135deg,#ec4899,#be185d)}'
    + '.overlay{position:fixed;inset:0;background:rgba(15,30,50,.48);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .22s}'
    + '.overlay.open{opacity:1;pointer-events:all}'
    + '.modal{background:var(--surface);border:1px solid var(--border);border-radius:20px;width:100%;max-width:740px;max-height:88vh;overflow-y:auto;transform:translateY(20px) scale(.97);transition:transform .22s ease;box-shadow:0 20px 60px rgba(0,0,0,.18)}'
    + '.overlay.open .modal{transform:translateY(0) scale(1)}'
    + '.modal-head{display:flex;align-items:center;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface);border-radius:20px 20px 0 0;z-index:2}'
    + '.modal-head h2{font-size:1rem;font-weight:700}.modal-head p{font-size:.72rem;color:var(--text2);margin-top:2px}'
    + '.close-btn{width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text2);font-size:.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}'
    + '.close-btn:hover{background:var(--surface3);color:var(--text)}'
    + '.modal-body{padding:20px 24px 26px}'
    + '.abox{border-radius:11px;padding:14px 16px;margin-bottom:16px}'
    + '.abox-n{background:var(--accent-bg);border:1px solid #bfdbfe}.abox-e{background:var(--gold-bg);border:1px solid #fde68a}.abox-p{background:var(--rose-bg);border:1px solid #fbcfe8}'
    + '.abox h3{font-size:.77rem;font-weight:700;margin-bottom:9px}.abox-n h3{color:var(--accent)}.abox-e h3{color:var(--gold)}.abox-p h3{color:var(--rose)}'
    + '.abox ul{list-style:none}.abox li{font-size:.73rem;color:var(--text2);padding:2px 0 2px 14px;position:relative;line-height:1.55}'
    + '.abox li::before{content:"→";position:absolute;left:0;font-size:.68rem;font-weight:700}.abox-n li::before{color:var(--accent)}.abox-e li::before{color:var(--gold)}.abox-p li::before{color:var(--rose)}'
    + '.uc{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px;transition:box-shadow .18s,border-color .18s}'
    + '.uc:hover{border-color:var(--border2);box-shadow:0 2px 10px rgba(0,0,0,.07)}'
    + '.uc-top{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px}'
    + '.uc-num{width:25px;height:25px;border-radius:6px;font-size:.67rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:\'JetBrains Mono\',monospace}'
    + '.un-n{background:var(--accent-bg);border:1px solid #bfdbfe;color:var(--accent)}.un-e{background:var(--gold-bg);border:1px solid #fde68a;color:var(--gold)}.un-p{background:var(--rose-bg);border:1px solid #fbcfe8;color:var(--rose)}'
    + '.uc-title{font-size:.87rem;font-weight:600;flex:1;line-height:1.4}'
    + '.chip{font-size:.67rem;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;font-family:\'JetBrains Mono\',monospace}'
    + '.cl1,.cl2{background:#eff6ff;color:#3b82f6}.cl3{background:#ecfdf5;color:#059669}.cl4{background:#fffbeb;color:#d97706}.cl5{background:#fff7ed;color:#ea580c}.cl6{background:#fef2f2;color:#dc2626}.cl7{background:#f5f3ff;color:#7c3aed}'
    + '.uc-meta{display:flex;gap:14px;margin-bottom:9px;flex-wrap:wrap}.uc-meta span{font-size:.7rem;color:var(--text2)}'
    + '.tool-row{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px}'
    + '.tool{font-size:.63rem;padding:3px 8px;border-radius:4px;background:var(--surface);border:1px solid var(--border2);color:var(--text2);font-family:\'JetBrains Mono\',monospace}'
    + '.uc-output{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:.73rem;color:var(--text2);line-height:1.65;margin-bottom:9px}'
    + '.out-n{border-left:3px solid var(--accent)}.out-e{border-left:3px solid var(--gold)}.out-p{border-left:3px solid var(--rose)}'
    + '.uc-insight{font-size:.72rem;color:var(--text3);font-style:italic;line-height:1.6;padding-top:8px;border-top:1px solid var(--border)}'
    + '</style></head><body>'
    + '<div class="container">'
    + '<div class="header"><div><h1>AI Adoption <span>Dashboard</span></h1><p>PCC Group · AI-Knowledge-Vault · อัปเดต '+now+'</p></div>'
    + '<div class="live-badge"><div class="dot"></div>AUTO · Apps Script</div></div>'
    + '<div class="stats-row">'
    + '<div class="stat-card"><div class="stat-icon si1">👥</div><div><div class="stat-label">Team Members</div><div class="stat-val" style="color:var(--accent)">3</div><div class="stat-sub">บันทึก Use Case แล้ว</div></div></div>'
    + '<div class="stat-card"><div class="stat-icon si2">📋</div><div><div class="stat-label">Total Use Cases</div><div class="stat-val" style="color:var(--gold)">'+(team.total_ucs||'?')+'</div><div class="stat-sub">ใน Knowledge Base</div></div></div>'
    + '<div class="stat-card"><div class="stat-icon si3">⏱</div><div><div class="stat-label">เวลาประหยัดรวม</div><div class="stat-val" style="color:var(--green)">'+(team.hours_saved||'?')+'</div><div class="stat-sub">ชั่วโมง (ประมาณ)</div></div></div>'
    + '<div class="stat-card"><div class="stat-icon si4">📊</div><div><div class="stat-label">Team Avg Level</div><div class="stat-val" style="color:var(--purple)">'+(team.avg_level||'?')+'</div><div class="stat-sub">/ 7 · เป้า Q3: 5</div></div></div>'
    + '</div>'
    + '<div class="cards-grid">'+cards+'</div>'
    + '<div class="bottom-grid">'
    + '<div class="panel"><div class="section-title">AI Level Framework — ทีมอยู่ที่ไหน</div>'+lvmap+'</div>'
    + '<div class="panel"><div class="section-title">ระบบอัตโนมัติ — Google Apps Script</div>'
    + '<div style="font-size:.8rem;color:var(--text2);line-height:2.1">'
    + '✅ อ่านจาก <strong>Google Drive</strong> โดยตรง (ไม่ต้อง credentials)<br>'
    + '✅ วิเคราะห์ด้วย <strong>Claude Sonnet 4</strong><br>'
    + '✅ Push ขึ้น <strong>GitHub Pages</strong> อัตโนมัติ<br>'
    + '🕘 รันทุกวันทำการ <strong>09:00 น.</strong> (Bangkok)<br>'
    + '<br><span style="font-size:.72rem;color:var(--text3)">อัปเดตล่าสุด: <strong>'+now+'</strong></span>'
    + '</div></div>'
    + '</div></div>'
    + modals
    + '<script>'
    + 'function openModal(id){document.getElementById("ov-"+id).classList.add("open");document.body.style.overflow="hidden";}'
    + 'function closeModal(id){document.getElementById("ov-"+id).classList.remove("open");document.body.style.overflow="";}'
    + 'document.querySelectorAll(".overlay").forEach(function(el){el.addEventListener("click",function(e){if(e.target===el){el.classList.remove("open");document.body.style.overflow="";}});});'
    + '</script></body></html>';
}

// ── PUSH TO GITHUB ────────────────────────────────────────────────────────────
function pushGitHub(html) {
  var url  = 'https://api.github.com/repos/'+GH_REPO+'/contents/'+GH_FILE;
  var hdrs = { 'Authorization':'token '+GH_TOKEN, 'Content-Type':'application/json', 'User-Agent':'PCC-Apps-Script' };

  var sha  = null;
  var get  = UrlFetchApp.fetch(url, { headers: hdrs, muteHttpExceptions: true });
  if (get.getResponseCode() === 200) sha = JSON.parse(get.getContentText()).sha;

  var now     = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm') + ' Bangkok';
  var payload = { message: '🤖 Auto-update — '+now, content: Utilities.base64Encode(html, Utilities.Charset.UTF_8) };
  if (sha) payload.sha = sha;

  var put = UrlFetchApp.fetch(url, { method:'put', headers: hdrs, payload: JSON.stringify(payload), muteHttpExceptions: true });
  var code = put.getResponseCode();
  if (code === 200 || code === 201) Logger.log('✅ GitHub Pages updated!');
  else throw new Error('GitHub push failed: ' + put.getContentText());
}

// ═══════════════════════════════════════════════════════════════════
// PHASE 3 — AGENTIC WEEKLY REPORT
// ═══════════════════════════════════════════════════════════════════
// Setup trigger (ทำครั้งเดียว):
//   Triggers → Add Trigger → weeklyReport
//   Time-based → Week timer → Every Monday → 9am–10am
// ═══════════════════════════════════════════════════════════════════

var REPORT_EMAILS = [
  'jinnaphas.phas@gmail.com',
  'jinnaphas.p@precise.co.th',
  'nicha.n@precise.co.th'
];

// ── Entry point สำหรับ Weekly Report ──────────────────────────────
function weeklyReport() {
  Logger.log('📧 Starting Weekly AI Adoption Report...');

  var files  = readDrive();
  var report = buildWeeklyReport(files);
  var html   = renderReportEmail(report);
  sendReportEmail(html, report);

  Logger.log('✅ Weekly report sent to: ' + REPORT_EMAILS.join(', '));
}

// ── วิเคราะห์ข้อมูลสำหรับ Report ──────────────────────────────────
function buildWeeklyReport(files) {
  var client   = ANTH_KEY;
  var lines    = [];
  var ucCounts = {};
  var today    = new Date();
  var cutoff   = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000); // 14 วัน

  for (var uid in USER_FOLDERS) {
    var info   = USER_FOLDERS[uid];
    var ucs    = files[uid] || [];
    ucCounts[uid] = ucs.length;
    lines.push('=== ' + info.name + ' (' + uid + ') — ' + ucs.length + ' UCs ===');
    ucs.forEach(function(f) {
      lines.push('File: ' + f.name + '\n' + f.content.slice(0, 800) + '\n---');
    });
  }

  var prompt = 'You are an AI Adoption Coach analyzing a team\'s weekly progress. Analyze these use cases and return ONLY valid JSON.\n\n'
    + lines.join('\n')
    + '\n\nReturn this exact JSON:\n'
    + '{"week_summary":"<2-3 sentences Thai about team progress this week>",'
    + '"highlights":[{"person":"<name>","achievement":"<Thai>","level":<int>,"emoji":"<emoji>"}],'
    + '"concerns":[{"person":"<name>","issue":"<Thai>","action":"<Thai>"}],'
    + '"team_level_avg":<float>,'
    + '"top_roi":{"person":"<name>","uc":"<title>","hours":<int>,"baht":<int>},'
    + '"next_actions":[{"person":"<name>","action":"<Thai>","priority":"high|medium","target_level":<int>}],'
    + '"coach_message":"<2-3 sentences Thai motivational message for the team>"}\n'
    + 'Return ONLY JSON.';

  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    headers: {
      'x-api-key': ANTH_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    payload: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  });

  var httpCode = resp.getResponseCode();
  if (httpCode !== 200) throw new Error('API error ' + httpCode);

  var raw = JSON.parse(resp.getContentText()).content[0].text.trim()
    .replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  var analysis = JSON.parse(raw);
  analysis.ucCounts  = ucCounts;
  analysis.generated = Utilities.formatDate(today, 'Asia/Bangkok', 'd MMM yyyy HH:mm');
  return analysis;
}

// ── สร้าง HTML Email ───────────────────────────────────────────────
function renderReportEmail(r) {
  var levelColors = { 1:'#3b82f6',2:'#0891b2',3:'#059669',4:'#d97706',5:'#ea580c',6:'#dc2626',7:'#7c3aed' };
  var levelNames  = { 1:'Basic',2:'Prompt',3:'Integrator',4:'Builder',5:'Automator',6:'Agentic',7:'Architect' };

  // Highlights
  var hlRows = (r.highlights || []).map(function(h) {
    var lv  = h.level || 3;
    var col = levelColors[lv] || '#059669';
    return '<tr><td style="padding:10px 14px;border-bottom:1px solid #eaf0f8">'
      + '<span style="font-size:1.2rem">' + h.emoji + '</span></td>'
      + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;font-weight:600;color:#1a2b3c">' + h.person + '</td>'
      + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;color:#4a6278">' + h.achievement + '</td>'
      + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;text-align:center">'
      + '<span style="background:' + col + '18;color:' + col + ';border:1px solid ' + col + '44;border-radius:12px;padding:2px 10px;font-size:.75rem;font-weight:700">L' + lv + ' ' + (levelNames[lv]||'') + '</span>'
      + '</td></tr>';
  }).join('');

  // Concerns
  var cnRows = (r.concerns || []).map(function(c) {
    return '<tr><td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;font-weight:600;color:#1a2b3c">' + c.person + '</td>'
      + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;color:#dc2626">' + c.issue + '</td>'
      + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;color:#0077cc">' + c.action + '</td></tr>';
  }).join('');

  // Next Actions
  var naRows = (r.next_actions || []).map(function(a) {
    var pri   = a.priority === 'high' ? '#dc2626' : '#d97706';
    var priBg = a.priority === 'high' ? '#fef2f2' : '#fffbeb';
    var lv    = a.target_level || 4;
    var col   = levelColors[lv] || '#d97706';
    return '<tr><td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;font-weight:600;color:#1a2b3c">' + a.person + '</td>'
      + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;color:#4a6278">' + a.action + '</td>'
      + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;text-align:center">'
      + '<span style="background:' + priBg + ';color:' + pri + ';border-radius:12px;padding:2px 10px;font-size:.72rem;font-weight:700">' + (a.priority === 'high' ? '🔴 สำคัญมาก' : '🟡 ควรทำ') + '</span></td>'
      + '<td style="padding:10px 14px;border-bottom:1px solid #eaf0f8;text-align:center">'
      + '<span style="background:' + col + '18;color:' + col + ';border-radius:12px;padding:2px 10px;font-size:.72rem;font-weight:700">→ L' + lv + '</span></td></tr>';
  }).join('');

  // UC count row
  var ucRow = Object.keys(USER_FOLDERS).map(function(uid) {
    var info = USER_FOLDERS[uid];
    var col  = uid==='narawit'?'#0077cc':uid==='earth'?'#d97706':uid==='pattaratida'?'#db2777':'#0d9488';
    return '<td style="text-align:center;padding:14px">'
      + '<div style="width:40px;height:40px;border-radius:10px;background:' + col + ';color:#fff;font-weight:800;font-size:1rem;display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px">' + info.av + '</div>'
      + '<div style="font-size:.78rem;font-weight:700;color:#1a2b3c">' + info.name + '</div>'
      + '<div style="font-size:1.5rem;font-weight:800;color:' + col + ';margin:4px 0">' + (r.ucCounts[uid]||0) + '</div>'
      + '<div style="font-size:.68rem;color:#8aa0b4">Use Cases</div>'
      + '</td>';
  }).join('');

  var topRoi = r.top_roi || {};

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f0f4f9;font-family:\'Segoe UI\',sans-serif">'
    + '<div style="max-width:680px;margin:0 auto;padding:24px 16px">'

    // Header
    + '<div style="background:linear-gradient(135deg,#0077cc,#0ea5e9);border-radius:16px;padding:28px 32px;margin-bottom:16px;color:#fff">'
    + '<div style="font-size:.75rem;opacity:.8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">📊 PCC Group · AI Adoption Weekly Report</div>'
    + '<div style="font-size:1.6rem;font-weight:800;margin-bottom:6px">สรุปประจำสัปดาห์</div>'
    + '<div style="font-size:.85rem;opacity:.85">' + r.generated + ' · อัปเดตอัตโนมัติโดย Google Apps Script</div>'
    + '</div>'

    // Week Summary
    + '<div style="background:#fff;border-radius:12px;padding:20px 24px;margin-bottom:14px;border:1px solid #dae3ef;box-shadow:0 1px 4px rgba(0,0,0,.05)">'
    + '<div style="font-size:.68rem;color:#8aa0b4;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px">🗓️ สรุปภาพรวมสัปดาห์นี้</div>'
    + '<div style="font-size:.9rem;color:#1a2b3c;line-height:1.7">' + (r.week_summary||'') + '</div>'
    + '</div>'

    // Team UC Count
    + '<div style="background:#fff;border-radius:12px;border:1px solid #dae3ef;box-shadow:0 1px 4px rgba(0,0,0,.05);margin-bottom:14px;overflow:hidden">'
    + '<div style="padding:16px 24px 0;font-size:.68rem;color:#8aa0b4;text-transform:uppercase;letter-spacing:1px;font-weight:700">👥 Use Cases ต่อคน</div>'
    + '<table style="width:100%;border-collapse:collapse"><tr>' + ucRow + '</tr></table>'
    + '<div style="padding:12px 24px;background:#f5f8fc;border-top:1px solid #dae3ef;display:flex;justify-content:space-between">'
    + '<span style="font-size:.78rem;color:#4a6278"><strong>Team Avg Level:</strong> ' + (r.team_level_avg||0) + ' / 7</span>'
    + '<span style="font-size:.78rem;color:#16a34a;font-weight:700">เป้า Q3: 5.0 → ' + Math.round((r.team_level_avg||0)/5*100) + '% ✓</span>'
    + '</div></div>'

    // Highlights
    + '<div style="background:#fff;border-radius:12px;border:1px solid #dae3ef;box-shadow:0 1px 4px rgba(0,0,0,.05);margin-bottom:14px;overflow:hidden">'
    + '<div style="padding:16px 24px;font-size:.68rem;color:#8aa0b4;text-transform:uppercase;letter-spacing:1px;font-weight:700">🏆 Highlights สัปดาห์นี้</div>'
    + '<table style="width:100%;border-collapse:collapse">' + (hlRows || '<tr><td colspan="4" style="padding:14px 24px;color:#8aa0b4;font-size:.8rem">ยังไม่มีข้อมูล</td></tr>') + '</table>'
    + '</div>'

    // Top ROI
    + '<div style="background:linear-gradient(135deg,#edfaf3,#f0fdfa);border:1px solid #86efac;border-radius:12px;padding:18px 24px;margin-bottom:14px">'
    + '<div style="font-size:.68rem;color:#16a34a;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px">🔥 Highest ROI ของสัปดาห์</div>'
    + '<div style="font-size:.9rem;font-weight:700;color:#1a2b3c">' + (topRoi.person||'') + ' — ' + (topRoi.uc||'') + '</div>'
    + '<div style="font-size:.8rem;color:#4a6278;margin-top:4px">ประหยัด <strong>' + (topRoi.hours||0) + ' ชม.</strong> มูลค่า <strong>~' + ((topRoi.baht||0)).toLocaleString() + ' บาท</strong></div>'
    + '</div>'

    // Concerns
    + (cnRows ? '<div style="background:#fff;border-radius:12px;border:1px solid #dae3ef;box-shadow:0 1px 4px rgba(0,0,0,.05);margin-bottom:14px;overflow:hidden">'
    + '<div style="padding:16px 24px;font-size:.68rem;color:#dc2626;text-transform:uppercase;letter-spacing:1px;font-weight:700">⚠️ จุดที่ต้องพัฒนา</div>'
    + '<table style="width:100%;border-collapse:collapse"><tr style="background:#f5f8fc"><th style="padding:8px 14px;text-align:left;font-size:.68rem;color:#8aa0b4">คน</th><th style="padding:8px 14px;text-align:left;font-size:.68rem;color:#8aa0b4">ปัญหา</th><th style="padding:8px 14px;text-align:left;font-size:.68rem;color:#8aa0b4">คำแนะนำ</th></tr>'
    + cnRows + '</table></div>' : '')

    // Next Actions
    + '<div style="background:#fff;border-radius:12px;border:1px solid #dae3ef;box-shadow:0 1px 4px rgba(0,0,0,.05);margin-bottom:14px;overflow:hidden">'
    + '<div style="padding:16px 24px;font-size:.68rem;color:#8aa0b4;text-transform:uppercase;letter-spacing:1px;font-weight:700">🎯 Action Items สัปดาห์หน้า</div>'
    + '<table style="width:100%;border-collapse:collapse"><tr style="background:#f5f8fc">'
    + '<th style="padding:8px 14px;text-align:left;font-size:.68rem;color:#8aa0b4">คน</th>'
    + '<th style="padding:8px 14px;text-align:left;font-size:.68rem;color:#8aa0b4">สิ่งที่ต้องทำ</th>'
    + '<th style="padding:8px 14px;text-align:center;font-size:.68rem;color:#8aa0b4">Priority</th>'
    + '<th style="padding:8px 14px;text-align:center;font-size:.68rem;color:#8aa0b4">เป้าหมาย</th>'
    + '</tr>' + naRows + '</table>'
    + '</div>'

    // Coach Message
    + '<div style="background:linear-gradient(135deg,#f3eeff,#e8f3ff);border:1px solid #c4b5fd;border-radius:12px;padding:18px 24px;margin-bottom:14px">'
    + '<div style="font-size:.68rem;color:#7c3aed;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px">💬 AI Coach Message</div>'
    + '<div style="font-size:.88rem;color:#1a2b3c;line-height:1.7;font-style:italic">"' + (r.coach_message||'') + '"</div>'
    + '</div>'

    // Footer
    + '<div style="text-align:center;padding:16px;font-size:.7rem;color:#8aa0b4">'
    + '🤖 Generated automatically by PCC AI Adoption System · Google Apps Script + Claude Sonnet 4<br>'
    + '<a href="https://jinnaphas.github.io/AIadoption/" style="color:#0077cc">ดู Dashboard แบบ Interactive →</a>'
    + '</div>'

    + '</div></body></html>';
}

// ── ส่ง Email ─────────────────────────────────────────────────────
function sendReportEmail(htmlBody, r) {
  var subject = '📊 AI Adoption Weekly Report — '
    + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'd MMM yyyy')
    + ' · Team Avg L' + (r.team_level_avg||0);

  REPORT_EMAILS.forEach(function(email) {
    MailApp.sendEmail({
      to: email,
      subject: subject,
      htmlBody: htmlBody,
      name: 'PCC AI Adoption System 🤖'
    });
    Logger.log('  Sent to: ' + email);
  });
}

// ── Test: รัน Report ทันทีโดยไม่ต้องรอ Monday ─────────────────────
function testWeeklyReport() {
  Logger.log('🧪 Testing weekly report...');
  weeklyReport();
}
