# AI Knowledge Vault — Naming Convention & Cleanup Checklist

> เป้าหมาย: ให้ "นับ UC อัตโนมัติ" เชื่อถือได้ 100% — แก้ 4 Data Hygiene issues ที่ Jetniphat UC#1 พบ
> Source of truth = [`data/ucs.json`](data/ucs.json) · Live ดึงเลขจากที่นี่

## 📐 Convention (ทุก UC ใหม่ต้องทำตาม)

1. **1 ไฟล์ = 1 UC** — ห้ามซ้ำ ห้ามแตกหลายไฟล์ต่อ 1 UC
2. **ชื่อไฟล์:** `YYYY-MM-DD-<slug>.md` (วันที่ขึ้นต้นเสมอ, slug เป็น a-z0-9 คั่นด้วย -)
   - ✅ `2026-05-25-epc-scope-pea-battery.md`
   - ❌ `use-case_2026-05-25-...` · ❌ `hc-dashboard.md` · ❌ `...(2).md`
3. **mimeType = Markdown (`.md`) จริง** — ไม่ใช่ Google Doc (Doc parse/นับยาก ต้อง export)
4. **ไฟล์ที่ไม่ใช่ UC** (context, assessment, glossary) → เก็บนอกโฟลเดอร์ use-case:
   - context ของ Claude Project → `_context/`
   - ผลประเมิน → `assessments/` (มีอยู่แล้ว)
5. ทุก UC ใหม่ → อัปเดต `data/ucs.json` ด้วย (num, title, level, date, domain, drive_file_id) แล้ว run `python scripts/sync_manifest.py --write`

## 🧹 Cleanup Checklist (ทำมือใน Google Drive)

> ⚠️ ผม (Claude) **execute ให้ไม่ได้** — Google Drive MCP ที่ต่อไว้มีแค่ read/copy/create **ไม่มีคำสั่ง move / rename / delete**
> ทำเองตามนี้ หรือเปิดสิทธิ์ tool ที่ move/rename ได้ แล้วผมจะทำให้

### Earth (`1MX08bN2eeHKHqGW_3fvKEEWj9LqVErC_`)
- [ ] ลบไฟล์ซ้ำ `2026-05-21-ai-adoption-dashboard-automation.md` เหลือ 1 (เก็บ id `1MXdPr6...`, ลบ `1KknSev...`, `1QX59ml...`)
- [ ] rename `job-role-architecture.md` → `2026-05-20-job-role-architecture.md`
- [ ] rename `hc-dashboard.md` → `2026-05-21-hc-analytics-portal.md`
- [ ] rename `nrc-app.md` → `2026-05-21-nrc-management-system.md` (รวม/ย้าย `nrc.md` ไป `_context/`)
- [ ] ย้ายไป `_context/`: `glossary.md`, `pcc-group.md`, `pcc-organization.md`
- [ ] ตรวจ `2026-05-27-apply-ai-training-psl.md`, `2026-05-26-tcs-precall-planning.md` ว่าเป็น UC หรือ note (ถ้า note → `_context/`)

### Pattaratida (`1f1cO05r54YJpgOBswV8WlQnWauw8Hh32`)
- [ ] rename `use-case_2026-05-25-epc-scope-pea-battery.md` → `2026-05-25-epc-scope-pea-battery.md`
- [ ] ย้าย `assessment_PAK.md` → `assessments/`

### Belle (`1_qUjDQKbTGbXKZorTFod84tIS5Op8dzL`)
- [ ] rename `2026-05-21-switchgear-ai-use-cases (2).md` → `2026-05-21-switchgear-ai-use-cases.md`

### Nick (`152ze23bdvba32lpKtHtkJwVrCyEf2aoG`)
- [ ] export 2 Google Doc เป็น Markdown แล้ว re-upload เป็น `.md` จริง:
  - `2026-05-27-pea-hackathon-aws-bedrock-ems-agents.md`
  - `2026-06-05-pea-hackathon-pitch-video-veo-canva.md`

### Jetniphat (`11nDqpsgeni3OJuVHnkZ_7mxDe9fzB1pW`)
- [x] สะอาดอยู่แล้ว (1 ไฟล์ = 1 UC, ตั้งชื่อถูก)

## ✅ หลังเคลียร์เสร็จ
เมื่อทุกไฟล์เป็น `YYYY-MM-DD-<slug>.md` และ 1 ไฟล์ = 1 UC แล้ว → `collectUCs()` ใน Apps Script จะนับตรงกับ `data/ucs.json` เป๊ะ และ daily job จะเขียนเลขอัตโนมัติได้อย่างมั่นใจ (ไม่ต้องพึ่ง manual count อีก)
