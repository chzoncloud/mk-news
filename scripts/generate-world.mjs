// generate-world.mjs — GitHub Actions รันทุกเช้า (คู่กับ generate-news.mjs)
// ข่าว "เทรนด์โลก" ภาษาอังกฤษ: coatings / abrasives / automotive-EV / steel-metal
// 1) ดึงข่าวโลกล่าสุดจาก Google News RSS (EN, ฟรี ไม่ต้องคีย์)
// 2) ให้ Gemini คัด+วิเคราะห์เทรนด์+แปลไทย  3) เขียนทับ world.js (window.WORLD_ARCHIVE)
import { readFileSync, writeFileSync, existsSync } from "fs";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("ERROR: no GEMINI_API_KEY secret"); process.exit(1); }
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

function readArchive() {
  try {
    if (existsSync("world.js")) {
      const prev = readFileSync("world.js", "utf8");
      const m = prev.match(/window\.WORLD_ARCHIVE\s*=\s*([\s\S]*?);?\s*$/);
      if (m) return JSON.parse(m[1]);
    }
  } catch (e) { console.error("archive read failed:", e.message); }
  return { days: [] };
}
const existingArchive = readArchive();
if (!Array.isArray(existingArchive.days)) existingArchive.days = [];
const recentTitles = existingArchive.days.slice(0, 5)
  .flatMap(d => (d.items || []).map(i => i.title)).filter(Boolean).slice(0, 40);

// ข่าวโลก ภาษาอังกฤษ — 4 หัวข้อ
const QUERIES = [
  "coatings industry paint technology innovation trends",
  "abrasives sandpaper grinding discs surface finishing market",
  "automotive manufacturing EV production global trend",
  "steel industry metal production prices global",
];

function decodeEnt(s) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

async function fetchRss(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error("rss http " + r.status);
  const xml = await r.text();
  const out = [];
  for (const b of xml.split("<item>").slice(1)) {
    const t = (b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";
    const link = (b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const pub = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "";
    const src = (b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || "";
    let title = decodeEnt(t);
    const source = decodeEnt(src) || "Google News";
    if (title.endsWith(" - " + source)) title = title.slice(0, -(" - " + source).length).trim();
    let date = today;
    if (pub) { const d = new Date(pub); if (!isNaN(d)) date = d.toISOString().slice(0, 10); }
    if (title && link) out.push({ title, url: link.trim(), source, date });
  }
  return out.slice(0, 10);
}

let candidates = [];
for (const q of QUERIES) {
  try { candidates = candidates.concat(await fetchRss(q)); }
  catch (e) { console.error("RSS fail:", q, e.message); }
}
const seen = new Set();
candidates = candidates.filter(c => { const k = c.title.slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; });
console.log("world candidates fetched:", candidates.length);
if (candidates.length < 3) { console.error("too few candidates"); process.exit(1); }

const listText = candidates.map((c, i) => `${i + 1}. [${c.source} | ${c.date}] ${c.title}\n   url: ${c.url}`).join("\n");

const prompt = `You are a world-trend intelligence assistant for the owner of MK, a Thai B2B company selling abrasives / sandpaper / grinding & sanding products (brand mksanding.com).
Build today's "World Trends" briefing for ${today}. The goal is NOT to find Thai customers — it is to help the owner READ GLOBAL TRENDS ahead of the local market (new coatings, new abrasive materials & tech, where global automotive/EV and steel are heading) and to practice business English.

Business lens:
- We sell abrasives used for surface prep / polishing / deburring / grinding in metal, automotive, and wood industries.
- What matters: new abrasive/coating materials & technology, big moves by global abrasive makers (3M, Mirka, Saint-Gobain, Bosch, Klingspor), automotive/EV production shifts, steel & metal demand — anything that signals where our industry is going.

Below are real latest world headlines from Google News (English):
${listText}

Pick the 5-6 most trend-worthy / insightful stories for us — prefer real industry/technology/market signals over generic corporate PR or stock-price noise. Skip irrelevant items.
tag each: coating=paint/coatings, abrasive=abrasives/grinding/surface finishing, auto=automotive/EV manufacturing, steel=steel/metal.
Use url/source/date from the list above EXACTLY as given — never invent a url.
${recentTitles.length ? `\nAlready covered in the last 5 days (do NOT repeat unless there is a genuinely new update):\n- ${recentTitles.join("\n- ")}\nPick only NEW stories. If today is thin, pick fewer (2-3) and say so in the summary.\n` : ""}

Language: write title/summary/why/action in clear business English (intermediate-learner friendly, concise). Then put a natural Thai translation of every field in the "th" object. Keep it tight: summary/why/action 1-2 sentences each.
"why" = why this trend matters to an abrasives business. "action" = one practical takeaway (e.g. "watch this material", "consider stocking X", "expect demand shift").

Reply with ONE JSON object only (no markdown, no other text):
{"date":"${today}","summary":"<English 1-2 sentence executive summary of today's global signals>","directCount":<green count>,"th":{"summary":"<Thai translation>"},"items":[{"id":"${today.replace(/-/g, "")}-w1","tag":"coating|abrasive|auto|steel","rating":"green|amber|white","source":"...","date":"YYYY-MM-DD","url":"https://...","title":"<English headline>","summary":"<English 1-2 sentences>","why":"<English: why it matters to our abrasives business>","action":"<English: 1-line takeaway>","th":{"title":"<Thai>","summary":"<Thai>","why":"<Thai>","action":"<Thai>"}}]}
rating: green=directly relevant to our abrasive/surface-finishing business, amber=adjacent industry trend, white=general FYI`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
const body = {
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { temperature: 0.4, maxOutputTokens: 16384, responseMimeType: "application/json" },
};

async function callGemini() {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (r.ok) return d;
      const retryable = [429, 500, 502, 503].includes(r.status);
      console.error(`Gemini attempt ${attempt}/4 failed: ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
      if (!retryable) process.exit(1);
    } catch (e) { console.error(`attempt ${attempt}/4 network error: ${e.message}`); }
    if (attempt < 4) { const wait = attempt * 20000; console.error(`retrying in ${wait / 1000}s...`); await new Promise((res) => setTimeout(res, wait)); }
  }
  console.error("Gemini failed after 4 attempts — no world update today"); process.exit(1);
}

const data = await callGemini();

let text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
const a = text.indexOf("{");
if (a < 0) { console.error("no JSON in response:", text.slice(0, 300)); process.exit(1); }
const jsonStr = text.slice(a);

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function salvage(s) {
  const suffixes = ["]}", "}]}", "}}]}", "\"}]}", "\"}}]}"];
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i] !== "}") continue;
    const head = s.slice(0, i + 1);
    for (const suf of suffixes) { const o = safeParse(head + suf); if (o && Array.isArray(o.items) && o.items.length) return o; }
  }
  return null;
}

let obj = safeParse(jsonStr);
if (!obj) { obj = salvage(jsonStr); if (obj) console.error("NOTE: JSON was truncated — salvaged " + obj.items.length + " items"); }
if (!obj) { console.error("JSON parse failed even after salvage:", jsonStr.slice(0, 300)); process.exit(1); }
if (!obj.date || !Array.isArray(obj.items) || obj.items.length === 0) { console.error("invalid shape"); process.exit(1); }
obj.date = today;

const archive = existingArchive;
archive.days = archive.days.filter(d => d && d.date && d.date !== today);
archive.days.unshift(obj);
archive.days.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
archive.days = archive.days.filter(d => (Date.now() - new Date(d.date + "T00:00:00Z").getTime()) / 86400000 <= 14).slice(0, 14);
archive.updated = today;

writeFileSync("world.js", "/* auto-generated ทุกเช้าโดย GitHub Actions — ข่าวเทรนด์โลก เก็บย้อนหลัง 14 วัน อย่าแก้มือ */\nwindow.WORLD_ARCHIVE = " + JSON.stringify(archive, null, 2) + ";\n");
console.log(`OK: world archive has ${archive.days.length} day(s); today=${obj.items.length} items, directCount=${obj.directCount}`);
