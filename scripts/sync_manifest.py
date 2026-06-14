#!/usr/bin/env python3
"""
PCC Group — Manifest ⇄ Dashboard consistency tool.

data/ucs.json is the single source of truth. This script:
  • validates manifest internal consistency (sum of UCs, per-member counts)
  • validates that the dashboard HTML numbers match the manifest
  • (--write) patches the Stats Row numbers + header date in BOTH html files
    from the manifest, and keeps index.html identical to ai_adoption_dashboard.html

Usage:
  python scripts/sync_manifest.py           # validate only (exit 1 on mismatch)
  python scripts/sync_manifest.py --write    # patch Stats Row + date from manifest
"""
import json, re, sys
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


def card_count(html, key):
    i = html.find(f"openModal('{key}')")
    if i < 0:
        return None
    m = re.search(r'<div class="mstat-v"[^>]*>(\d+)</div>', html[i:])
    return int(m.group(1)) if m else None


def validate(man, html, label):
    team = man["team"]
    members = man["members"]
    ok = True

    def check(name, got, want):
        nonlocal ok
        status = "✓" if str(got) == str(want) else "✗"
        if status == "✗":
            ok = False
        print(f"  [{status}] {label} · {name}: got={got} want={want}")

    # manifest internal
    sum_uc = sum(members[k]["uc_count"] for k in members)
    check("Σ member uc_count == team.total_ucs", sum_uc, team["total_ucs"])
    check("member count == team.members", len(members), team["members"])
    for k in members:
        check(f"{k}: len(ucs) == uc_count", len(members[k]["ucs"]), members[k]["uc_count"])

    # html stats row
    for _, (pat, field) in STAT.items():
        m = re.search(pat, html)
        check(f"StatsRow {field}", m.group(2) if m else "NOT FOUND",
              team["members"] if field == "members" else team[field])

    # per-card counts
    for k in ORDER:
        check(f"card[{k}] Use Cases", card_count(html, k), members[k]["uc_count"])

    return ok


def patch(man, html):
    team = man["team"]
    for _, (pat, field) in STAT.items():
        want = team["members"] if field == "members" else team[field]
        html = re.sub(pat, lambda mm, w=want: f"{mm.group(1)}{w}{mm.group(3)}", html)
    stamp = thai_stamp(man["_meta"]["updated"])
    html = re.sub(r'อัปเดต\s+\d{1,2}\s+[^\s<]+\s+25\d{2}', "อัปเดต " + stamp, html)
    return html


def main():
    write = "--write" in sys.argv
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    dash = DASHBOARD.read_text(encoding="utf-8")

    if write:
        dash = patch(man, dash)
        DASHBOARD.write_text(dash, encoding="utf-8")
        INDEX.write_text(dash, encoding="utf-8")  # keep identical
        print("✍️  Patched Stats Row + date from manifest; index.html synced.")

    print("🔎 Validating manifest ⇄ dashboard ...")
    ok = validate(man, DASHBOARD.read_text(encoding="utf-8"), "dashboard")
    identical = DASHBOARD.read_text(encoding="utf-8") == INDEX.read_text(encoding="utf-8")
    print(f"  [{'✓' if identical else '✗'}] index.html == ai_adoption_dashboard.html")
    ok = ok and identical

    print("✅ ALL CONSISTENT" if ok else "❌ MISMATCH — fix manifest or HTML")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
