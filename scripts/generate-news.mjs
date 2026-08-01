// generate-news.mjs — GitHub Actions รันทุกเช้า: หาข่าวจริงผ่าน Gemini(+Google Search)
// แล้วเขียนทับ data.js เป็นข่าววันนี้ (ไทยหลัก + ศัพท์อังกฤษแตะแปล)
import { writeFileSync } from "fs";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("ERROR: no GEMINI_API_KEY secret"); process.exit(1); }

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }); // YYYY-MM-DD

const prompt = `คุณคือผู้ช่วยข่าวกรองธุรกิจของผู้บริหารบริษัท MK (ขายวัสดุขัด/กระดาษทราย B2B แบรนด์ mksanding.com)
ทำ "ข่าวเช้า" ${today} สำหรับผู้บริหารอ่านบนมือถือ วิเคราะห์ความเกี่ยวข้องกับธุรกิจ

บริบทธุรกิจ (ใช้ตัดสินว่าข่าวไหนสำคัญ):
- ขายวัสดุขัด/กระดาษทราย/จานขัด/สายพานขัด ใช้งานเตรียมผิว/ขัดเงา/ลบครีบ/เจียร ตามโรงงาน: ประกอบรถยนต์, ชิ้นส่วนยานยนต์, เหล็ก/โลหะ, ซ่อมบำรุงอากาศยาน (MRO)
- ลูกค้าอุดมคติ = โรงงานทุนต่างชาติ โดยเฉพาะญี่ปุ่น ในไทย
- ขยายตลาด DIY B2C ผ่าน Shopee/TikTok; สนใจตลาดวัสดุขัดเกรดการบิน/MRO ในไทย
- หลักคิด: อะไรทำให้ "โรงงานผลิต/ซ่อมชิ้นงานโลหะมากขึ้น" = โอกาส; "โรงงานลูกค้าหด" = ภัย

งาน: ใช้ Google Search หาข่าวจริง "ล่าสุด" (เน้น 1-2 วันล่าสุด) 2 กลุ่ม: (ก) อุตสาหกรรมยานยนต์ไทย ผลิต/ส่งออก/EV/ลงทุน/ชิ้นส่วน/โรงงานญี่ปุ่น (ข) อุตสาหกรรมการบินไทย การบินไทย/MRO อู่ตะเภา/ฝูงบิน/aerospace. เอาข่าวจริงอ้างอิงแหล่งได้เท่านั้น ห้ามแต่งข่าว คัด 5-7 ข่าวเด่น

รูปแบบ 2 ภาษา: เขียน title/summary/why/action เป็น "ไทยเป็นหลัก" (≥80% เป็นไทย) แต่แทรกศัพท์ธุรกิจ/อุตสาหกรรมภาษาอังกฤษ 3-6 คำต่อข่าว (เช่น production, export, investment, demand, supply chain, maintenance, hangar, fleet, components) เน้นศัพท์ที่เจอซ้ำๆ ใช้ทำงานจริง แล้วทุกคำอังกฤษที่ใช้ต้องมีคำแปลใน terms ของข่าวนั้น

ตอบกลับเป็น JSON object เดียวเท่านั้น (ไม่มีข้อความอื่น ไม่มี markdown) รูปแบบ:
{"date":"${today}","summary":"สรุปผู้บริหาร 1-2 ประโยค วันนี้กระทบเราไหม เด่นอะไร","directCount":<จำนวนข่าว rating green>,"terms":{},"items":[{"id":"${today.replace(/-/g,"")}-1","tag":"auto|aero","rating":"green|amber|white","title":"...","source":"...","date":"YYYY-MM-DD","url":"https://...","summary":"1-2 ประโยค","why":"สำคัญกับเรายังไง","action":"ควรทำอะไร 1 บรรทัด","terms":{"english":"คำแปลไทย"}}]}
โดย rating: green=เกี่ยวตรงกับดีมานด์งานขัดของเรา, amber=เกี่ยวทางอ้อม(กระทบลูกค้า/ตลาด), white=แค่รู้ไว้`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
const body = {
  contents: [{ parts: [{ text: prompt }] }],
  tools: [{ google_search: {} }],
  generationConfig: { temperature: 0.4 },
};

let resp;
try {
  resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
} catch (e) { console.error("fetch failed:", e.message); process.exit(1); }

const data = await resp.json();
if (!resp.ok) { console.error("Gemini API error:", JSON.stringify(data).slice(0, 600)); process.exit(1); }

let text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
const a = text.indexOf("{"), b = text.lastIndexOf("}");
if (a < 0 || b < 0) { console.error("no JSON found in response:", text.slice(0, 300)); process.exit(1); }

let obj;
try { obj = JSON.parse(text.slice(a, b + 1)); }
catch (e) { console.error("JSON parse failed:", e.message, "\n", text.slice(0, 300)); process.exit(1); }

if (!obj.date || !Array.isArray(obj.items) || obj.items.length === 0) {
  console.error("invalid data shape:", JSON.stringify(obj).slice(0, 300)); process.exit(1);
}
obj.date = today; // บังคับวันที่ให้ตรงวันนี้
obj.terms = obj.terms || {};

const out = "/* auto-generated ทุกเช้าโดย GitHub Actions — อย่าแก้มือ */\nwindow.TODAY_DATA = " + JSON.stringify(obj, null, 2) + ";\n";
writeFileSync("data.js", out);
console.log(`OK: wrote data.js — ${obj.items.length} items, directCount=${obj.directCount}`);
