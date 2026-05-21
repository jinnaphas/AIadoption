#!/usr/bin/env python3
"""
PCC Group — AI Adoption Dashboard Auto-Updater
Triggered by GitHub Actions when new use cases are added to Google Drive.
"""

import os, json, re, hashlib, sys
from pathlib import Path
from datetime import datetime, timezone

import anthropic
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ── Config ───────────────────────────────────────────────────────────────────
USER_FOLDERS = {
    "narawit": {
        "name": "นราวิช", "folder": "152ze23bdvba32lpKtHtkJwVrCyEf2aoG",
        "role": "HR Strategy & Org Transformation · PCC Group",
        "avatar": "น", "color": "n",
    },
    "earth": {
        "name": "Earth (Jinnaphas)", "folder": "1MX08bN2eeHKHqGW_3fvKEEWj9LqVErC_",
        "role": "HR Manager & OD Strategy Lead · PCC / SBP",
        "avatar": "E", "color": "e",
    },
    "pattaratida": {
        "name": "Pattaratida K.", "folder": "1f1cO05r54YJpgOBswV8WlQnWauw8Hh32",
        "role": "B2B Sales Intelligence · PCC Group",
        "avatar": "ภ", "color": "p",
    },
}
LEVEL_LABELS = {
    1:"ทารก — Basic User", 2:"วัยรุ่น — Prompt Engineer",
    3:"วัยรุ่นตอนปลาย — Integrator", 4:"ปล่อยของ — The Builder",
    5:"ปล่อยมือ — Task Automator", 6:"ปล่อยจอย — Agentic Operator",
    7:"คบเด็กสร้างบ้าน — Architect",
}
LEVEL_EMOJI = {1:"👶",2:"📝",3:"⚡",4:"🔥",5:"🚀",6:"🤖",7:"🏗️"}
LEVEL_COLOR = {
    1:"#3b82f6",2:"#0891b2",3:"#059669",4:"#d97706",
    5:"#ea580c",6:"#dc2626",7:"#7c3aed",
}
LEVEL_BG = {
    1:"#eff6ff",2:"#ecfeff",3:"#ecfdf5",4:"#fffbeb",
    5:"#fff7ed",6:"#fef2f2",7:"#f5f3ff",
}
STATE_FILE  = Path("scripts/.state.json")
DASHBOARD   = Path("ai_adoption_dashboard.html")


# ── Google Drive ──────────────────────────────────────────────────────────────
def get_drive():
    t = json.loads(os.environ["GDRIVE_TOKEN_JSON"])
    creds = Credentials(
        token=t.get("token"), refresh_token=t["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=t["client_id"], client_secret=t["client_secret"],
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_md(drive, folder_id):
    r = drive.files().list(
        q=f"'{folder_id}' in parents and trashed=false and name contains '.md'",
        fields="files(id,name,modifiedTime)"
    ).execute()
    return r.get("files", [])


def read_file(drive, fid):
    return drive.files().get_media(fileId=fid).execute().decode("utf-8", errors="replace")


# ── MD Parsing ────────────────────────────────────────────────────────────────
def parse_md(content, filename):
    d = {"filename": filename, "raw": content[:3000]}
    # YAML frontmatter
    m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if m:
        for line in m.group(1).splitlines():
            if "title:" in line:      d["title"] = line.split(":",1)[1].strip().strip('"\'')
            elif "ai_level:" in line:
                n = re.search(r'\d+', line)
                if n: d["level"] = int(n.group())
            elif "date:" in line:     d["date"] = line.split(":",1)[1].strip()
            elif "time_saved_min:" in line:
                n = re.search(r'\d+', line)
                if n: d["time_min"] = int(n.group())

    # Body fallbacks
    if "level" not in d:
        n = re.search(r'AI Level[^\d]*(\d)', content)
        if n: d["level"] = int(n.group(1))
    if "date" not in d:
        n = re.search(r'(\d{4}-\d{2}-\d{2})', filename + content)
        if n: d["date"] = n.group(1)
    if "title" not in d:
        n = re.search(r'#\s+(.+)', content)
        d["title"] = n.group(1).strip() if n else filename.replace(".md","")

    # Output section
    n = re.search(r'(?:ผลลัพธ์|Output)[^\n]*\n+(.*?)(?=\n##|\Z)', content, re.DOTALL)
    if n: d["output"] = re.sub(r'\*+', '', n.group(1).strip())[:400]

    # Tools (backtick items)
    d["tools"] = list(dict.fromkeys(re.findall(r'`([^`\n]{3,40})`', content)))[:7]

    # Insight (คำแนะนำ section)
    n = re.search(r'(?:💡|คำแนะนำ)[^\n]*\n+(.*?)(?=\n##|\Z)', content, re.DOTALL)
    if n: d["insight"] = n.group(1).strip()[:300]

    # Time saved string
    n = re.search(r'ประหยัด[^\n]*?(\~?[\d–\-]+[\+]?\s*(?:ชม|ชั่วโมง|นาที|min|hr)[^\n]*)', content)
    if n: d["time_saved"] = n.group(1).strip()[:60]
    elif "time_min" in d:
        h = d["time_min"] // 60
        m2 = d["time_min"] % 60
        d["time_saved"] = f"~{h} ชม." if h else f"~{m2} นาที"

    return d


# ── State ─────────────────────────────────────────────────────────────────────
def load_state():
    return json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {"h": {}}

def save_state(hashes):
    STATE_FILE.parent.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps({
        "h": hashes,
        "updated": datetime.now(timezone.utc).isoformat()
    }, indent=2))

def file_hash(content):
    return hashlib.md5(content.encode()).hexdigest()

def has_changes(files_data, old):
    for uid, files in files_data.items():
        for f in files:
            h = file_hash(f["raw"])
            if f["id"] not in old or old[f["id"]] != h:
                return True
    return False

def make_hashes(files_data):
    return {f["id"]: file_hash(f["raw"])
            for files in files_data.values() for f in files}


# ── Anthropic Analysis ────────────────────────────────────────────────────────
def analyze(files_data):
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    blocks = []
    for uid, files in files_data.items():
        uname = USER_FOLDERS[uid]["name"]
        blocks.append(f"\n=== {uname} ({uid}) ===")
        for f in sorted(files, key=lambda x: x.get("date","0")):
            blocks.append(
                f"File: {f['filename']} | Level: {f.get('level','?')} | Date: {f.get('date','?')}\n"
                f"Title: {f.get('title','')}\nOutput: {f.get('output','')[:300]}\n"
                f"Insight: {f.get('insight','')[:200]}\n---"
            )

    prompt = (
        "Analyze AI use cases for PCC Group. Return ONLY valid compact JSON (no markdown).\n\n"
        + "\n".join(blocks) +
        """

Return this structure exactly:
{
  "team": {"total_ucs": <int>, "hours_saved": "<X+>", "avg_level": <float 1dp>},
  "members": {
    "narawit":     {"level": <int>, "avg": <float>, "hours": "<X+>", "uc_count": <int>,
                    "tags": ["<tag1>","<tag2>","<tag3>","<tag4>"],
                    "analysis": ["<pt1>","<pt2>","<pt3>","<pt4>"],
                    "next": "<1-sentence action to reach next level>",
                    "ucs": [{"title":"<>","level":<int>,"date":"<YYYY-MM-DD>",
                             "time_saved":"<>","tools":["<>"],"output":"<>","insight":"💡 <>"}]},
    "earth":       {<same>},
    "pattaratida": {<same>}
  }
}
Level definitions: 1=Basic User 2=Prompt Engineer 3=Integrator 4=Builder 5=Task Automator 6=Agentic 7=Architect
Sort each member's ucs by date descending. Return ONLY JSON."""
    )

    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = msg.content[0].text.strip()
    raw = re.sub(r'^```json?\n?', '', raw)
    raw = re.sub(r'\n?```$', '', raw)
    return json.loads(raw)


# ── HTML Builder ──────────────────────────────────────────────────────────────
def gauge(level, color):
    segs = []
    for i in range(1, 8):
        if i < level:  segs.append(f'<div class="seg sc-{color}"></div>')
        elif i == level: segs.append(f'<div class="seg sc-{color} scg-{color}"></div>')
        else: segs.append('<div class="seg"></div>')
    return "".join(segs)


def uc_card(uc, num, color):
    lv = uc.get("level", 3)
    lv = max(1, min(7, lv))
    tools = "".join(f'<span class="tool">{t}</span>' for t in (uc.get("tools") or [])[:6])
    return f"""
      <div class="uc">
        <div class="uc-top">
          <div class="uc-num un-{color}">#{num}</div>
          <div class="uc-title">{uc.get('title','')}</div>
          <div class="chip cl{lv}">L{lv}</div>
        </div>
        <div class="uc-meta">
          <span>📅 {uc.get('date','')}</span>
          <span>⏱ {uc.get('time_saved','')}</span>
        </div>
        <div class="tool-row">{tools}</div>
        <div class="uc-output out-{color}"><strong>Output:</strong> {uc.get('output','')}</div>
        <div class="uc-insight">{uc.get('insight','')}</div>
      </div>"""


def member_card(uid, info, mdata):
    c = info["color"]
    lv = max(1, min(7, mdata.get("level", 3)))
    lvstyle = f"background:{LEVEL_BG[lv]};color:{LEVEL_COLOR[lv]};border:1px solid {LEVEL_COLOR[lv]}55"
    tags = "".join(f'<span class="tag tag-{c}">{t}</span>' for t in mdata.get("tags", [])[:4])
    return f"""
    <div class="emp-card card-{c}" onclick="openModal('{uid}')">
      <div class="emp-header">
        <div class="avatar av-{c}">{info['avatar']}</div>
        <div><div class="emp-name">{info['name']}</div>
             <div class="emp-role">{info['role']}</div></div>
      </div>
      <div class="level-badge" style="{lvstyle}">{LEVEL_EMOJI[lv]} Level {lv} — {LEVEL_LABELS[lv]}</div>
      <div class="gauge-wrap">
        <div class="gauge-labels"><span>L1</span><span>L2</span><span>L3</span><span>L4</span><span>L5</span><span>L6</span><span>L7</span></div>
        <div class="gauge-track">{gauge(lv, c)}</div>
      </div>
      <div class="mini-stats">
        <div class="mstat"><div class="mstat-v">{mdata.get('uc_count',0)}</div><div class="mstat-l">Use Cases</div></div>
        <div class="mstat"><div class="mstat-v">{mdata.get('avg',0)}</div><div class="mstat-l">Avg Level</div></div>
        <div class="mstat"><div class="mstat-v">{mdata.get('hours','?')}</div><div class="mstat-l">ชม.ประหยัด</div></div>
      </div>
      <div class="tags">{tags}</div>
      <button class="drill-btn btn-{c}" onclick="event.stopPropagation();openModal('{uid}')">🔍 Drill Down →</button>
    </div>"""


def member_modal(uid, info, mdata):
    c = info["color"]
    lv = max(1, min(7, mdata.get("level", 3)))
    analysis = "".join(f"<li>{p}</li>" for p in mdata.get("analysis", []))
    ucs_html = "".join(uc_card(uc, i+1, c) for i, uc in enumerate(mdata.get("ucs", [])))
    return f"""
<div class="overlay" id="ov-{uid}">
  <div class="modal">
    <div class="modal-head">
      <div><h2>🔍 Use Cases — {info['name']}</h2>
      <p>{info['role']} · Level {lv} — {LEVEL_LABELS[lv]} · {mdata.get('uc_count',0)} UCs · Avg {mdata.get('avg',0)}</p></div>
      <button class="close-btn" onclick="closeModal('{uid}')">✕</button>
    </div>
    <div class="modal-body">
      <div class="abox abox-{c}">
        <h3>📊 การวิเคราะห์ภาพรวม</h3>
        <ul>{analysis}</ul>
        <p style="font-size:.72rem;color:var(--text3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
          🎯 สู่ Level ถัดไป: {mdata.get('next','')}
        </p>
      </div>
      {ucs_html}
    </div>
  </div>
</div>"""


def level_map(members):
    rows = []
    for lv in range(1, 8):
        avs = []
        for uid, info in USER_FOLDERS.items():
            if members.get(uid, {}).get("level") == lv:
                avs.append(f'<div class="mav mav-{info["color"]}">{info["avatar"]}</div>')
        cur = ' cur' if avs else ''
        avs_html = f'<div class="mini-avs">{"".join(avs)}</div>' if avs else ""
        rows.append(f"""
      <div class="lvl-row{cur}">
        <div class="lvl-num" style="background:{LEVEL_BG[lv]};color:{LEVEL_COLOR[lv]}">{lv}</div>
        <div class="lvl-info"><div class="lvl-name">{LEVEL_LABELS[lv]}</div></div>
        {avs_html}
      </div>""")
    return "".join(rows)


def build_html(analysis, now_str):
    team  = analysis.get("team", {})
    mdata = analysis.get("members", {})

    cards  = "\n".join(member_card(uid, info, mdata.get(uid, {})) for uid, info in USER_FOLDERS.items())
    modals = "\n".join(member_modal(uid, info, mdata.get(uid, {})) for uid, info in USER_FOLDERS.items())
    lvmap  = level_map(mdata)

    total_ucs  = team.get("total_ucs", "?")
    hours      = team.get("hours_saved", "?")
    avg_lvl    = team.get("avg_level", "?")

    return f"""<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Adoption Dashboard — PCC Group</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{{
    --bg:#f0f4f9;--surface:#fff;--surface2:#f5f8fc;--surface3:#eaf0f8;
    --border:#dae3ef;--border2:#c5d3e2;
    --text:#1a2b3c;--text2:#4a6278;--text3:#8aa0b4;
    --accent:#0077cc;--accent-bg:#e8f3ff;
    --gold:#d97706;--gold-bg:#fef9ec;
    --green:#16a34a;--green-bg:#edfaf3;
    --purple:#7c3aed;--purple-bg:#f3eeff;
    --rose:#db2777;--rose-bg:#fdf2f8;
  }}
  *{{margin:0;padding:0;box-sizing:border-box;}}
  body{{font-family:'Outfit',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;}}
  body::before{{content:'';position:fixed;inset:0;background-image:radial-gradient(circle,#b8cfe0 1px,transparent 1px);background-size:28px 28px;opacity:.4;pointer-events:none;z-index:0;}}
  .container{{max-width:1200px;margin:0 auto;padding:28px 24px;position:relative;z-index:1;}}
  /* Header */
  .header{{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:14px;}}
  .header h1{{font-size:1.85rem;font-weight:800;letter-spacing:-.5px;color:var(--text);}}
  .header h1 span{{color:var(--accent);}}
  .header p{{color:var(--text2);font-size:.84rem;margin-top:5px;}}
  .live-badge{{display:flex;align-items:center;gap:8px;background:var(--green-bg);border:1px solid #bbf7d0;border-radius:20px;padding:7px 16px;font-size:.73rem;color:var(--green);font-family:'JetBrains Mono',monospace;white-space:nowrap;font-weight:600;}}
  .dot{{width:7px;height:7px;background:var(--green);border-radius:50%;animation:blink 2s infinite;}}
  @keyframes blink{{0%,100%{{opacity:1}}50%{{opacity:.3}}}}
  /* Stats */
  .stats-row{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;}}
  .stat-card{{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.06);display:flex;align-items:center;gap:14px;}}
  .stat-icon{{width:44px;height:44px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;}}
  .si1{{background:var(--accent-bg)}}.si2{{background:var(--gold-bg)}}.si3{{background:var(--green-bg)}}.si4{{background:var(--purple-bg)}}
  .stat-label{{font-size:.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px;}}
  .stat-val{{font-size:1.7rem;font-weight:800;line-height:1;}}
  .stat-sub{{font-size:.68rem;color:var(--text3);margin-top:3px;}}
  /* Cards */
  .cards-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;}}
  .emp-card{{background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:22px;cursor:pointer;transition:all .22s ease;box-shadow:0 2px 8px rgba(0,0,0,.06);position:relative;overflow:hidden;}}
  .emp-card::before{{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:18px 18px 0 0;}}
  .card-n::before{{background:linear-gradient(90deg,var(--accent),#60b4ff);}}.card-e::before{{background:linear-gradient(90deg,var(--gold),#fbbf24);}}.card-p::before{{background:linear-gradient(90deg,var(--rose),#f472b6);}}
  .card-n:hover{{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,119,204,.12);}}.card-e:hover{{border-color:var(--gold);transform:translateY(-2px);box-shadow:0 8px 28px rgba(217,119,6,.12);}}.card-p:hover{{border-color:var(--rose);transform:translateY(-2px);box-shadow:0 8px 28px rgba(219,39,119,.12);}}
  .emp-header{{display:flex;align-items:center;gap:12px;margin-bottom:16px;}}
  .avatar{{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.15rem;font-weight:800;color:#fff;flex-shrink:0;}}
  .av-n{{background:linear-gradient(135deg,#0ea5e9,#0369a1);}}.av-e{{background:linear-gradient(135deg,#f59e0b,#b45309);}}.av-p{{background:linear-gradient(135deg,#ec4899,#be185d);}}
  .emp-name{{font-size:1rem;font-weight:700;}}.emp-role{{font-size:.7rem;color:var(--text2);margin-top:2px;line-height:1.4;}}
  .level-badge{{display:inline-flex;align-items:center;gap:5px;border-radius:8px;padding:4px 10px;font-size:.74rem;font-weight:600;margin-bottom:14px;}}
  /* Gauge */
  .gauge-wrap{{margin-bottom:14px;}}
  .gauge-labels{{display:flex;justify-content:space-between;font-size:.62rem;color:var(--text3);margin-bottom:6px;font-family:'JetBrains Mono',monospace;}}
  .gauge-track{{display:flex;gap:3px;height:7px;}}
  .seg{{flex:1;border-radius:3px;background:var(--surface3);}}
  .sc-n{{background:var(--accent)}}.scg-n{{box-shadow:0 0 7px rgba(0,119,204,.6);}}
  .sc-e{{background:var(--gold)}}.scg-e{{box-shadow:0 0 7px rgba(217,119,6,.6);}}
  .sc-p{{background:var(--rose)}}.scg-p{{box-shadow:0 0 7px rgba(219,39,119,.6);}}
  /* Mini stats */
  .mini-stats{{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:13px;}}
  .mstat{{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center;}}
  .mstat-v{{font-size:1rem;font-weight:700;}}.mstat-l{{font-size:.6rem;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-top:2px;font-weight:600;}}
  .tags{{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:13px;}}
  .tag{{font-size:.65rem;padding:3px 8px;border-radius:20px;font-weight:500;}}
  .tag-n{{background:var(--accent-bg);border:1px solid #bfdbfe;color:var(--accent);}}.tag-e{{background:var(--gold-bg);border:1px solid #fde68a;color:var(--gold);}}.tag-p{{background:var(--rose-bg);border:1px solid #fbcfe8;color:var(--rose);}}
  .drill-btn{{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:9px;border-radius:10px;border:1.5px solid var(--border2);background:var(--surface2);font-size:.78rem;font-weight:600;cursor:pointer;transition:all .18s;font-family:'Outfit',sans-serif;}}
  .btn-n{{color:var(--accent)}}.btn-n:hover{{background:var(--accent-bg);border-color:var(--accent);}}.btn-e{{color:var(--gold)}}.btn-e:hover{{background:var(--gold-bg);border-color:var(--gold);}}.btn-p{{color:var(--rose)}}.btn-p:hover{{background:var(--rose-bg);border-color:var(--rose);}}
  /* Bottom */
  .bottom-grid{{display:grid;grid-template-columns:1fr 1.4fr;gap:18px;}}
  .panel{{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px;box-shadow:0 1px 4px rgba(0,0,0,.05);}}
  .section-title{{font-size:.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:16px;}}
  .lvl-row{{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:8px;margin-bottom:3px;}}
  .lvl-row.cur{{background:var(--surface2);border:1px solid var(--border);}}
  .lvl-num{{width:27px;height:27px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;flex-shrink:0;font-family:'JetBrains Mono',monospace;}}
  .lvl-info{{flex:1;}}.lvl-name{{font-size:.8rem;font-weight:600;}}
  .mini-avs{{display:flex;gap:4px;}}
  .mav{{width:22px;height:22px;border-radius:5px;font-size:.58rem;font-weight:800;color:#fff;display:flex;align-items:center;justify-content:center;}}
  .mav-n{{background:linear-gradient(135deg,#0ea5e9,#0369a1);}}.mav-e{{background:linear-gradient(135deg,#f59e0b,#b45309);}}.mav-p{{background:linear-gradient(135deg,#ec4899,#be185d);}}
  /* Activity Panel */
  .act-item{{display:flex;gap:10px;padding:10px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;}}
  .act-dot{{width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0;}}
  .act-n{{background:var(--accent)}}.act-e{{background:var(--gold)}}.act-p{{background:var(--rose)}}
  .act-content p{{font-size:.78rem;font-weight:600;color:var(--text);line-height:1.3;}}
  .act-content span{{font-size:.68rem;color:var(--text3);}}
  /* Modal */
  .overlay{{position:fixed;inset:0;background:rgba(15,30,50,.48);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .22s;}}
  .overlay.open{{opacity:1;pointer-events:all;}}
  .modal{{background:var(--surface);border:1px solid var(--border);border-radius:20px;width:100%;max-width:740px;max-height:88vh;overflow-y:auto;transform:translateY(20px) scale(.97);transition:transform .22s ease;box-shadow:0 20px 60px rgba(0,0,0,.18);}}
  .overlay.open .modal{{transform:translateY(0) scale(1);}}
  .modal-head{{display:flex;align-items:center;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface);border-radius:20px 20px 0 0;z-index:2;}}
  .modal-head h2{{font-size:1rem;font-weight:700;}}.modal-head p{{font-size:.72rem;color:var(--text2);margin-top:2px;}}
  .close-btn{{width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text2);font-size:.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;}}
  .close-btn:hover{{background:var(--surface3);color:var(--text);}}
  .modal-body{{padding:20px 24px 26px;}}
  .abox{{border-radius:11px;padding:14px 16px;margin-bottom:16px;}}
  .abox-n{{background:var(--accent-bg);border:1px solid #bfdbfe;}}.abox-e{{background:var(--gold-bg);border:1px solid #fde68a;}}.abox-p{{background:var(--rose-bg);border:1px solid #fbcfe8;}}
  .abox h3{{font-size:.77rem;font-weight:700;margin-bottom:9px;}}.abox-n h3{{color:var(--accent)}}.abox-e h3{{color:var(--gold)}}.abox-p h3{{color:var(--rose)}}
  .abox ul{{list-style:none;}}.abox li{{font-size:.73rem;color:var(--text2);padding:2px 0 2px 14px;position:relative;line-height:1.55;}}
  .abox li::before{{content:'→';position:absolute;left:0;font-size:.68rem;font-weight:700;}}.abox-n li::before{{color:var(--accent)}}.abox-e li::before{{color:var(--gold)}}.abox-p li::before{{color:var(--rose)}}
  .uc{{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px;transition:box-shadow .18s,border-color .18s;}}
  .uc:hover{{border-color:var(--border2);box-shadow:0 2px 10px rgba(0,0,0,.07);}}
  .uc-top{{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;}}
  .uc-num{{width:25px;height:25px;border-radius:6px;font-size:.67rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'JetBrains Mono',monospace;}}
  .un-n{{background:var(--accent-bg);border:1px solid #bfdbfe;color:var(--accent);}}.un-e{{background:var(--gold-bg);border:1px solid #fde68a;color:var(--gold);}}.un-p{{background:var(--rose-bg);border:1px solid #fbcfe8;color:var(--rose);}}
  .uc-title{{font-size:.87rem;font-weight:600;flex:1;line-height:1.4;}}
  .chip{{font-size:.67rem;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap;flex-shrink:0;font-family:'JetBrains Mono',monospace;}}
  .cl1,.cl2{{background:#eff6ff;color:#3b82f6}}.cl3{{background:#ecfdf5;color:#059669}}.cl4{{background:#fffbeb;color:#d97706}}.cl5{{background:#fff7ed;color:#ea580c}}.cl6{{background:#fef2f2;color:#dc2626}}.cl7{{background:#f5f3ff;color:#7c3aed}}
  .uc-meta{{display:flex;gap:14px;margin-bottom:9px;flex-wrap:wrap;}}.uc-meta span{{font-size:.7rem;color:var(--text2);}}
  .tool-row{{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px;}}
  .tool{{font-size:.63rem;padding:3px 8px;border-radius:4px;background:var(--surface);border:1px solid var(--border2);color:var(--text2);font-family:'JetBrains Mono',monospace;}}
  .uc-output{{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:.73rem;color:var(--text2);line-height:1.65;margin-bottom:9px;}}
  .out-n{{border-left:3px solid var(--accent);}}.out-e{{border-left:3px solid var(--gold);}}.out-p{{border-left:3px solid var(--rose);}}
  .uc-insight{{font-size:.72rem;color:var(--text3);font-style:italic;line-height:1.6;padding-top:8px;border-top:1px solid var(--border);}}
  ::-webkit-scrollbar{{width:4px;}}.col::-webkit-scrollbar-thumb{{background:var(--border2);border-radius:2px;}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div><h1>AI Adoption <span>Dashboard</span></h1>
    <p>PCC Group · AI-Knowledge-Vault · อัปเดต {now_str}</p></div>
    <div class="live-badge"><div class="dot"></div>AUTO · GitHub Actions</div>
  </div>
  <div class="stats-row">
    <div class="stat-card"><div class="stat-icon si1">👥</div><div><div class="stat-label">Team Members</div><div class="stat-val" style="color:var(--accent)">3</div><div class="stat-sub">บันทึก Use Case แล้ว</div></div></div>
    <div class="stat-card"><div class="stat-icon si2">📋</div><div><div class="stat-label">Total Use Cases</div><div class="stat-val" style="color:var(--gold)">{total_ucs}</div><div class="stat-sub">ใน Knowledge Base</div></div></div>
    <div class="stat-card"><div class="stat-icon si3">⏱</div><div><div class="stat-label">เวลาประหยัดรวม</div><div class="stat-val" style="color:var(--green)">{hours}</div><div class="stat-sub">ชั่วโมง (ประมาณ)</div></div></div>
    <div class="stat-card"><div class="stat-icon si4">📊</div><div><div class="stat-label">Team Avg Level</div><div class="stat-val" style="color:var(--purple)">{avg_lvl}</div><div class="stat-sub">/ 7 · เป้า Q3: 5</div></div></div>
  </div>
  <div class="cards-grid">{cards}</div>
  <div class="bottom-grid">
    <div class="panel">
      <div class="section-title">AI Level Framework — ทีมอยู่ที่ไหน</div>
      {lvmap}
    </div>
    <div class="panel">
      <div class="section-title">ระบบอัตโนมัติ — GitHub Actions</div>
      <div class="act-item"><div class="act-dot" style="background:var(--green)"></div>
        <div class="act-content"><p>Auto-detect use cases จาก Google Drive</p><span>ตรวจสอบทุกวันทำการ 09:00 น. (Bangkok)</span></div></div>
      <div class="act-item"><div class="act-dot" style="background:var(--accent)"></div>
        <div class="act-content"><p>วิเคราะห์และประเมิน Level โดย Anthropic API</p><span>Claude Sonnet 4 — อัปเดตเมื่อพบ Use Case ใหม่</span></div></div>
      <div class="act-item"><div class="act-dot" style="background:var(--purple)"></div>
        <div class="act-content"><p>Push ขึ้น GitHub Pages อัตโนมัติ</p><span>Dashboard live ภายใน ~1 นาทีหลัง commit</span></div></div>
      <div style="margin-top:14px;padding:12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
        <p style="font-size:.72rem;color:var(--text3)">อัปเดตล่าสุด: <strong style="color:var(--text2)">{now_str}</strong></p>
        <p style="font-size:.72rem;color:var(--text3);margin-top:4px">Source: <strong style="color:var(--text2)">Google Drive · AI-Knowledge-Vault</strong></p>
      </div>
    </div>
  </div>
</div>
{modals}
<script>
  function openModal(id){{document.getElementById('ov-'+id).classList.add('open');document.body.style.overflow='hidden';}}
  function closeModal(id){{document.getElementById('ov-'+id).classList.remove('open');document.body.style.overflow='';}}
  document.querySelectorAll('.overlay').forEach(function(el){{
    el.addEventListener('click',function(e){{if(e.target===el){{el.classList.remove('open');document.body.style.overflow='';}}}});
  }});
</script>
</body>
</html>"""


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("🔍 Connecting to Google Drive...")
    drive = get_drive()

    print("📂 Reading use case files...")
    files_data = {}
    for uid, info in USER_FOLDERS.items():
        raw = list_md(drive, info["folder"])
        parsed = []
        for f in raw:
            # Only process date-prefixed use case files
            if re.match(r'\d{4}-\d{2}-\d{2}', f["name"]):
                content = read_file(drive, f["id"])
                entry = {"id": f["id"], "filename": f["name"], "raw": content}
                entry.update(parse_md(content, f["name"]))
                parsed.append(entry)
        files_data[uid] = parsed
        print(f"  {info['name']}: {len(parsed)} use cases")

    state = load_state()
    if not has_changes(files_data, state.get("h", {})):
        print("✅ No changes detected — skipping update.")
        sys.exit(0)

    print("🤖 Calling Anthropic API for analysis...")
    analysis = analyze(files_data)

    print("🏗️  Building dashboard HTML...")
    now_str = datetime.now(timezone.utc).strftime("%-d %b %Y %H:%M UTC")
    html = build_html(analysis, now_str)
    DASHBOARD.write_text(html, encoding="utf-8")
    print(f"✅ Dashboard saved ({len(html):,} chars)")

    save_state(make_hashes(files_data))
    print("💾 State saved — done!")


if __name__ == "__main__":
    main()
