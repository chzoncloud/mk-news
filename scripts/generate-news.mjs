// generate-news.mjs — GitHub Actions รันทุกเช้า
// 1) ดึงข่าวจริงล่าสุดจาก Google News RSS (ฟรี ไม่ต้องคีย์)
// 2) ให้ Gemini (แบบธรรมดา ฟรี ไม่ใช้ grounding) คัด+วิเคราะห์+แปล 2 ภาษา
// 3) เขียนทับ data.js
import { writeFileSync } from "fs";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("ERROR: no GEMINI_API_KEY secret"); process.exit(1); }
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

const QUERIES = [
  "อุตสาหกรรมยานยนต์ไทย ผลิตรถยนต์ ส่งออก ชิ้นส่วน EV ลงทุน",
  "การบินไทย MRO อู่ตะเภา อุตสาหกรรมการบิน ฝูงบิน",
];

function decodeEnt(s) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

async function fetchRss(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=th&gl=TH&ceid=TH:th`;
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
// dedupe
const seen = new Set();
candidates = candidates.filter(c => { const k = c.title.slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; });
console.log("candidates fetched:", candidates.length);
if (candidates.length < 3) { console.error("too few candidates"); process.exit(1); }

const listText = candidates.map((c, i) => `${i + 1}. [${c.source} | ${c.date}] ${c.title}\n   url: ${c.url}`).join("\n");

const prompt = `คุณคือผู้ช่วยข่าวกรองธุรกิจของผู้บริหารบริษัท MK (ขายวัสดุขัด/กระดาษทราย B2B แบรนด์ mksanding.com)
ทำ "ข่าวเช้า" ${today} วิเคราะห์ความเกี่ยวข้องกับธุรกิจ

บริบทธุรกิจ:
- ขายวัสดุขัด/กระดาษทราย/จานขัด/สายพานขัด ใช้งานเตรียมผิว/ขัดเงา/ลบครีบ/เจียร ตามโรงงาน: ประกอบรถยนต์, ชิ้นส่วนยานยนต์, เหล็ก/โลหะ, ซ่อมบำรุงอากาศยาน (MRO)
- ลูกค้าอุดมคติ = โรงงานทุนต่างชาติ โดยเฉพาะญี่ปุ่น ในไทย
- ขยายตลาด DIY B2C ผ่าน Shopee/TikTok; สนใจตลาดวัสดุขัดเกรดการบิน/MRO ในไทย
- หลักคิด: อะไรทำให้ "โรงงานผลิต/ซ่อมชิ้นงานโลหะมากขึ้น" = โอกาส; "โรงงานลูกค้าหด" = ภัย

ด้านล่างคือพาดหัวข่าวจริงล่าสุดจาก Google News:
${listText}

เลือก 5-7 ข่าวที่เกี่ยวกับอุตสาหกรรมเรามากที่สุด (ยานยนต์/การบิน/โลหะ/โรงงาน) — ข้ามข่าวที่ไม่เกี่ยว (รีวิวรถ ราค่ารถมือสอง โปรโมชั่น ฯลฯ)
ใช้ url/source/date จากรายการข้างบน "ตามจริง" ห้ามแต่ง url เอง

รูปแบบ 2 ภาษา: เขียน title/summary/why/action เป็น "ไทยเป็นหลัก" (≥80%) แต่แทรกศัพท์ธุรกิจ/อุตสาหกรรมภาษาอังกฤษ 3-6 คำต่อข่าว (production, export, investment, demand, supply chain, maintenance, hangar, fleet, components ฯลฯ) แล้วทุกคำอังกฤษที่ใช้ต้องมีคำแปลใน terms ของข่าวนั้น

ตอบกลับเป็น JSON object เดียวเท่านั้น (ไม่มี markdown ไม่มีข้อความอื่น):
{"date":"${today}","summary":"สรุปผู้บริหาร 1-2 ประโยค วันนี้กระทบเราไหม เด่นอะไร","directCount":<จำนวนข่าว rating green>,"terms":{},"items":[{"id":"${today.replace(/-/g, "")}-1","tag":"auto|aero","rating":"green|amber|white","title":"...","source":"...","date":"YYYY-MM-DD","url":"https://...","summary":"1-2 ประโยค","why":"สำคัญกับเรายังไง","action":"ควรทำอะไร 1 บรรทัด","terms":{"english":"คำแปลไทย"}}]}
rating: green=เกี่ยวตรงกับดีมานด์งานขัดของเรา, amber=เกี่ยวทางอ้อม(กระทบลูกค้า/ตลาด), white=แค่รู้ไว้`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4 } };

let resp;
try { resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
catch (e) { console.error("fetch failed:", e.message); process.exit(1); }

const data = await resp.json();
if (!resp.ok) { console.error("Gemini API error:", JSON.stringify(data).slice(0, 600)); process.exit(1); }

let text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
const a = text.indexOf("{"), b = text.lastIndexOf("}");
if (a < 0 || b < 0) { console.error("no JSON in response:", text.slice(0, 300)); process.exit(1); }

let obj;
try { obj = JSON.parse(text.slice(a, b + 1)); }
catch (e) { console.error("JSON parse failed:", e.message, "\n", text.slice(0, 300)); process.exit(1); }
if (!obj.date || !Array.isArray(obj.items) || obj.items.length === 0) { console.error("invalid shape"); process.exit(1); }
obj.date = today;
obj.terms = obj.terms || {};

writeFileSync("data.js", "/* auto-generated ทุกเช้าโดย GitHub Actions — อย่าแก้มือ */\nwindow.TODAY_DATA = " + JSON.stringify(obj, null, 2) + ";\n");
console.log(`OK: wrote data.js — ${obj.items.length} items, directCount=${obj.directCount}`);
