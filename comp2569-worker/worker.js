/**
 * Digital & AI Talent 2569 — Competition scoring sync worker
 *
 * ตัวกลางระหว่างหน้าเว็บให้คะแนนกับ GitHub: ถือ GITHUB_TOKEN ไว้ฝั่ง server เท่านั้น
 * กรรมการยืนยันตัวด้วย "รหัสผ่านกรรมการ" (รหัสเดียวใช้ร่วมกันได้ทุกท่าน เพราะแต่ละท่าน
 * เขียนคนละไฟล์อยู่แล้ว — ไม่มีทางบันทึกทับกันข้ามกรรมการ) ผู้ดูแลใช้ "รหัสผ่านผู้ดูแล"
 * แยกต่างหากสำหรับแก้รายชื่อทีม
 *
 * Endpoints:
 *   GET  /load-scores?judge=<slug>        → { scores, sha }         (คะแนนของกรรมการ 1 ท่าน)
 *   POST /save-scores                     → body { judge, passcode, scores, sha, editor }
 *                                            200 { sha } | 401 รหัสผิด | 409 มีคนบันทึกตัดหน้า
 *   GET  /load-all-scores                 → { all: { [judge]: scores } }   (รวมทุกกรรมการ — หน้าสรุปผล)
 *   GET  /load-teams                      → { teams, sha }
 *   POST /save-teams                      → body { passcode, teams, sha }  (ต้องรหัสผู้ดูแล)
 *
 * ตัวแปรที่ต้องตั้งค่า (Settings → Variables and Secrets):
 *   GITHUB_TOKEN     (secret)  fine-grained PAT สิทธิ์ Contents R/W เฉพาะ repo นี้
 *   PASSCODE_JUDGE   (secret)  รหัสผ่านกรรมการ (รหัสเดียวแจกทุกท่าน) เช่น "TALENT-2569-J"
 *   PASSCODE_ADMIN   (secret)  รหัสผ่านผู้ดูแล (สำหรับตั้งค่ารายชื่อทีม) เช่น "TALENT-2569-ADMIN"
 *   GITHUB_REPO      (var)     "jinnaphas/AIadoption"
 *   GITHUB_BRANCH    (var)     "main"
 *   DATA_DIR         (var)     "data/comp2569"
 */

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });

    const repo = env.GITHUB_REPO;
    const branch = env.GITHUB_BRANCH || "main";
    const dir = env.DATA_DIR || "data/comp2569";

    const gh = (path, init = {}) =>
      fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        ...init,
        headers: {
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "digital-ai-talent-2569-sync",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.headers || {}),
        },
      });

    function slugify(s) {
      return String(s || "")
        .trim()
        .replace(/[\\/?#%<>"|:*]/g, "")
        .slice(0, 60) || "unnamed";
    }

    async function getFile(path) {
      const r = await gh(`${path}?ref=${branch}`);
      if (r.status === 404) return { data: null, sha: null };
      if (!r.ok) throw new Error("GitHub " + r.status);
      const j = await r.json();
      let text;
      if (j.encoding === "base64" && j.content) {
        text = b64dec(j.content);
      } else {
        const raw = await gh(`${path}?ref=${branch}`, {
          headers: { "Accept": "application/vnd.github.raw" },
        });
        if (!raw.ok) throw new Error("GitHub raw " + raw.status);
        text = await raw.text();
      }
      return { data: JSON.parse(text), sha: j.sha };
    }

    async function putFile(path, dataObj, sha, message) {
      const payload = JSON.stringify(dataObj, null, 2);
      if (payload.length > 900_000) {
        return { error: "ข้อมูลใหญ่เกินไป", status: 413 };
      }
      const put = await gh(path, {
        method: "PUT",
        body: JSON.stringify({
          message,
          content: b64enc(payload),
          branch,
          ...(sha ? { sha } : {}),
        }),
      });
      if (put.status === 409 || put.status === 422) {
        const latest = await getFile(path);
        return { conflict: true, latest };
      }
      if (!put.ok) return { error: "GitHub " + put.status, status: 502 };
      const pj = await put.json();
      return { sha: pj.content.sha };
    }

    const url = new URL(req.url);
    try {
      /* ── Scores: 1 ไฟล์ต่อกรรมการ 1 ท่าน ── */
      if (url.pathname === "/load-scores" && req.method === "GET") {
        const judge = slugify(url.searchParams.get("judge"));
        const r = await getFile(`${dir}/scores/${judge}.json`);
        return json({ scores: r.data || {}, sha: r.sha });
      }

      if (url.pathname === "/save-scores" && req.method === "POST") {
        const body = await req.json().catch(() => null);
        const { judge, passcode, scores, sha, editor } = body || {};
        if (!judge) return json({ error: "missing judge" }, 400);
        if (!passcode || passcode !== env.PASSCODE_JUDGE) {
          return json({ error: "bad passcode" }, 401);
        }
        if (!scores || typeof scores !== "object") return json({ error: "invalid scores" }, 400);

        const slug = slugify(judge);
        const who = String(editor || judge).slice(0, 60).replace(/[\r\n]/g, " ");
        const result = await putFile(
          `${dir}/scores/${slug}.json`,
          scores,
          sha,
          `scores: update ${slug} by ${who}`
        );
        if (result.conflict) return json(result.latest, 409);
        if (result.error) return json({ error: result.error }, result.status);
        return json({ sha: result.sha });
      }

      /* ── รวมคะแนนทุกกรรมการ (สำหรับหน้าสรุปผล) ── */
      if (url.pathname === "/load-all-scores" && req.method === "GET") {
        const listRes = await gh(`${dir}/scores?ref=${branch}`);
        if (listRes.status === 404) return json({ all: {} });
        if (!listRes.ok) return json({ error: "GitHub " + listRes.status }, 502);
        const files = await listRes.json();
        const all = {};
        await Promise.all(
          (Array.isArray(files) ? files : [])
            .filter((f) => f.type === "file" && f.name.endsWith(".json"))
            .map(async (f) => {
              const judgeSlug = f.name.replace(/\.json$/, "");
              try {
                const r = await getFile(`${dir}/scores/${f.name}`);
                if (r.data) all[judgeSlug] = r.data;
              } catch (e) {
                /* ข้ามไฟล์เสีย ไม่ให้ล้มทั้งคำขอ */
              }
            })
        );
        return json({ all });
      }

      /* ── รายชื่อทีม (ไฟล์เดียวใช้ร่วมกัน) ── */
      if (url.pathname === "/load-teams" && req.method === "GET") {
        const r = await getFile(`${dir}/teams.json`);
        return json({ teams: r.data, sha: r.sha });
      }

      if (url.pathname === "/save-teams" && req.method === "POST") {
        const body = await req.json().catch(() => null);
        const { passcode, teams, sha } = body || {};
        if (!passcode || passcode !== env.PASSCODE_ADMIN) {
          return json({ error: "bad admin passcode" }, 401);
        }
        if (!teams || typeof teams !== "object") return json({ error: "invalid teams" }, 400);
        const result = await putFile(`${dir}/teams.json`, teams, sha, "teams: update roster");
        if (result.conflict) return json(result.latest, 409);
        if (result.error) return json({ error: result.error }, result.status);
        return json({ sha: result.sha });
      }

      return json({ ok: true, service: "digital-ai-talent-2569-sync" });
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};

function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64dec(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
