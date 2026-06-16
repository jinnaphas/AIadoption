#!/usr/bin/env python3
"""
PCC Group — Manifest ⇄ Dashboard consistency tool.

data/ucs.json is the single source of truth for FACTS (counts, levels, dates,
tools, output summary, insight). The rich modal *prose/layout* stays hand-curated;
this tool keeps the facts in sync and catches drift.

Usage:
  python scripts/sync_manifest.py            # validate (stats, counts, per-UC level/date, index==dashboard)
  python scripts/sync_manifest.py --write    # patch Stats Row + header date from manifest
  python scripts/sync_manifest.py --extract  # pull tools/output/insight/time_saved from curated modals into data/ucs.json
"""
import json, re, sys, html as _html
from pathlib import Path

ROOT      = Path(__file__).resolve().parent.parent
MANIFEST  = ROOT / "data" / "ucs.json"
DASHBOARD = ROOT / "ai_adoption_dashboard.html"
INDEX     = ROOT / "index.html"
ORDER     = ["narawit", "earth", "pattaratida", "manaporn", "jetniphat"]
TH_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."]

STAT = {
    "members": (r'(Team Members</div><div class="stat-val" style="color:var\(--accent\)">)(\d+)(</div>)', "members"),
    "total":   (r'(Total Use Cases</div><div class="stat-val" style="color:var\(--gold\)">)(\d+)(</div>)', "total_ucs"),
    "avg":     (r'(Team Avg Level</div><div class="stat-val" style="color:var\(--purple\)">)([\d.]+)(</div>)', "avg_level"),
}


def thai_stamp(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{d} {TH_MONTHS[m-1]} {y + 543}"


def strip_tags(s):
    s = re.sub(r'<br\s*/?>', ' · ', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = _html.unescape(s)
    return re.sub(r'\s+', ' ', s).strip(' ·\n\t')


def modal_region(html, key):
    m = re.search(r'id="ov-' + key + r'"', html)
    if not m:
        return ""
    start = m.start()
    nxt = re.search(r'id="ov-|<script>', html[start + 6:])
    return html[start: start + 6 + nxt.start()] if nxt else html[start:]


def parse_cards(region):
    """Parse UC cards keyed by #num (robust to the modals' messy/varied markup)."""
    idxs = [m.start() for m in re.finditer(r'class="uc-num', region)]
    out = {}
    for i, s in enumerate(idxs):
        seg = region[s: idxs[i + 1] if i + 1 < len(idxs) else len(region)]
        num = re.search(r'>#(\d+)<', seg)
        if not num:
            continue
        c = {"num": int(num.group(1))}
        if (t := re.search(r'class="uc-title">(.*?)</div>', seg, re.S)):  c["title"] = strip_tags(t.group(1))
        lv = re.search(r'class="chip c[l]?(\d)"', seg) or re.search(r'>L([1-7])<', seg)
        if lv:                                                            c["level"] = int(lv.group(1))
        if (d := re.search(r'📅\s*([0-9]{4}-[0-9]{2}-[0-9]{2})', seg)):    c["date"] = d.group(1)
        if (x := re.search(r'⏱\s*([^<]+)', seg)):                         c["time_saved"] = x.group(1).strip()
        tools = [strip_tags(z) for z in re.findall(r'class="tool">(.*?)</span>', seg, re.S)]
        if tools:                                                         c["tools"] = tools
        if (o := re.search(r'class="uc-output[^"]*"[^>]*>(.*?)</div>', seg, re.S)): c["output"] = strip_tags(o.group(1))
        ins = re.search(r'class="uc-insight">(.*?)</div>', seg, re.S) or re.search(r'(💡[^<]+)', seg)
        if ins:                                                           c["insight"] = strip_tags(ins.group(1))
        out[c["num"]] = c
    return out


def card_count(html, key):
    i = html.find(f"openModal('{key}')")
    if i < 0:
        return None
    m = re.search(r'<div class="mstat-v"[^>]*>(\d+)</div>', html[i:])
    return int(m.group(1)) if m else None


def extract(man, html):
    changed = 0
    for key in ORDER:
        cards = parse_cards(modal_region(html, key))
        for uc in man["members"][key]["ucs"]:
            if uc.get("enriched"):            # keep hand-enriched (from Drive) intact
                continue
            c = cards.get(uc["num"])
            if not c:
                print(f"  ⚠️  {key} #{uc['num']}: no card found in modal — skipped")
                continue
            for f in ("time_saved", "tools", "output", "insight"):
                if c.get(f) and not uc.get(f):
                    uc[f] = c[f]
            uc["enriched"] = "from-html"
            changed += 1
    return changed


def validate(man, html, label):
    team, members = man["team"], man["members"]
    ok = True

    def check(name, got, want, hard=True):
        nonlocal ok
        good = str(got) == str(want)
        if not good and hard:
            ok = False
        print(f"  [{'✓' if good else ('✗' if hard else '⚠')}] {label} · {name}: got={got} want={want}")

    check("Σ member uc_count == team.total_ucs", sum(members[k]["uc_count"] for k in members), team["total_ucs"])
    check("member count == team.members", len(members), team["members"])
    for k in members:
        check(f"{k}: len(ucs) == uc_count", len(members[k]["ucs"]), members[k]["uc_count"])

    for _, (pat, field) in STAT.items():
        m = re.search(pat, html)
        check(f"StatsRow {field}", m.group(2) if m else "NOT FOUND",
              team["members"] if field == "members" else team[field])

    for k in ORDER:
        check(f"card[{k}] Use Cases", card_count(html, k), members[k]["uc_count"])

    # per-UC level/date in modals must match manifest (drift guard)
    for k in ORDER:
        cards = parse_cards(modal_region(html, k))
        for uc in members[k]["ucs"]:
            c = cards.get(uc["num"])
            if not c:
                check(f"modal[{k}] #{uc['num']} present", "missing", "present", hard=False)
                continue
            if c.get("level") != uc["level"]:
                check(f"modal[{k}] #{uc['num']} level", c.get("level"), uc["level"])
            if c.get("date") != uc["date"]:
                check(f"modal[{k}] #{uc['num']} date", c.get("date"), uc["date"])
    return ok


def patch(man, html):
    team = man["team"]
    for _, (pat, field) in STAT.items():
        want = team["members"] if field == "members" else team[field]
        html = re.sub(pat, lambda mm, w=want: f"{mm.group(1)}{w}{mm.group(3)}", html)
    html = re.sub(r'อัปเดต\s+\d{1,2}\s+[^\s<]+\s+25\d{2}', "อัปเดต " + thai_stamp(man["_meta"]["updated"]), html)
    return html


def main():
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    dash = DASHBOARD.read_text(encoding="utf-8")

    if "--extract" in sys.argv:
        n = extract(man, dash)
        MANIFEST.write_text(json.dumps(man, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"📥 Enriched {n} UCs from curated modals → data/ucs.json")
        return

    if "--write" in sys.argv:
        dash = patch(man, dash)
        DASHBOARD.write_text(dash, encoding="utf-8")
        INDEX.write_text(dash, encoding="utf-8")
        print("✍️  Patched Stats Row + date from manifest; index.html synced.")

    print("🔎 Validating manifest ⇄ dashboard ...")
    ok = validate(man, DASHBOARD.read_text(encoding="utf-8"), "dashboard")
    identical = DASHBOARD.read_text(encoding="utf-8") == INDEX.read_text(encoding="utf-8")
    print(f"  [{'✓' if identical else '✗'}] index.html == ai_adoption_dashboard.html")
    print("✅ ALL CONSISTENT" if (ok and identical) else "❌ MISMATCH — fix manifest or HTML")
    sys.exit(0 if (ok and identical) else 1)


if __name__ == "__main__":
    main()
