// normalize.ts — توحيد أسماء الأصناف لتوليد مفتاح مطابقة موحّد
// الفكرة: "أوجمنتين 1جم"، "Augmentin 1g", "AUGMENTIN 1 GM" => نفس المفتاح

// قاموس الأسماء التجارية عربي -> إنجليزي (الجسر الحاسم للمطابقة عبر اللغتين)
// قابل للتوسعة من قاعدة البيانات لاحقًا (يتعلّم من تأكيدات المخازن)
const BRAND_AR_TO_EN: Record<string, string> = {
  اوجمنتين: "augmentin", بنادول: "panadol", كلاريتين: "claritine",
  كونكور: "concor", ريفو: "rivo", فولتارين: "voltaren", بروفين: "brufen",
  زيثروماكس: "zithromax", فلاجيل: "flagyl", كتافلام: "cataflam",
  اوجمينتين: "augmentin", بنادؤل: "panadol",
};

export function addBrandTranslations(translations: Record<string, string>): void {
  Object.entries(translations).forEach(([arName, enName]) => {
    const normalizedArName = normalizeArabicLetters(arabicDigits(arName.trim().toLowerCase()));
    const normalizedEnName = enName.trim().toLowerCase();
    if (normalizedArName && normalizedEnName) {
      BRAND_AR_TO_EN[normalizedArName] = normalizedEnName;
    }
  });
}

// خريطة تحويل عربي شائع -> إنجليزي للأدوية والوحدات
const AR_TO_LATIN: Record<string, string> = {
  جم: "g", جرام: "g", غ: "g", غرام: "g", مجم: "mg", مج: "mg", ملجم: "mg", مليجرام: "mg",
  مل: "ml", ميكروجرام: "mcg", ميكروغرام: "mcg", وحده: "iu", وحدة: "iu",
  اكسترا: "extra",
  قرص: "tab", اقراص: "tab", أقراص: "tab", كبسوله: "cap", كبسولة: "cap",
  كبسولات: "cap", شراب: "syr", امبول: "amp", أمبول: "amp", حقن: "inj",
  كريم: "cream", مرهم: "oint", قطره: "drops", قطرة: "drops", نقط: "drops",
  لبوس: "supp", بخاخ: "spray", اكياس: "sachet", أكياس: "sachet", كيس: "sachet",
};

// تطبيع الحروف العربية (همزات، تاء مربوطة، تطويل)
function normalizeArabicLetters(s: string): string {
  return s
    .replace(/[\u0623\u0625\u0622\u0671]/g, "ا") // أ إ آ ٱ -> ا
    .replace(/\u0629/g, "ه") // ة -> ه
    .replace(/\u0649/g, "ي") // ى -> ي
    .replace(/\u0640/g, "") // تطويل
    .replace(/[\u064B-\u0652]/g, ""); // تشكيل
}

// تحويل الأرقام العربية -> لاتينية
function arabicDigits(s: string): string {
  const map: Record<string, string> = {
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  };
  return s.replace(/[٠-٩]/g, (d) => map[d]);
}

export interface ParsedName {
  raw: string;
  base: string;        // الاسم بدون تركيز/شكل/عبوة
  strength: string;    // "500mg"
  form: string;        // "tab"
  packSize: string;    // "14"
  normalizedKey: string; // المفتاح النهائي للمطابقة
}

// توحيد الوحدة لوحدة أساسية: g->mg, mcg->mg حتى تتطابق المتكافئات
// 1g => "1000mg", 0.5g => "500mg", 500mcg => "0.5mg"
function canonStrength(numStr: string, unit: string): string {
  const n = parseFloat(numStr);
  if (isNaN(n)) return `${numStr}${unit}`;
  if (unit === "g") return `${n * 1000}mg`;
  if (unit === "mcg") return `${n / 1000}mg`;
  return `${n}${unit}`; // mg, ml, iu, % تبقى كما هي
}

export function parseName(raw: string): ParsedName {
  let s = (raw || "").trim().toLowerCase();
  s = arabicDigits(s);
  s = normalizeArabicLetters(s);

  // استبدال الكلمات العربية بمكافئها اللاتيني (وحدات وأشكال)
  s = s.replace(/[\u0600-\u06FF]+/g, (w) => BRAND_AR_TO_EN[w] ?? AR_TO_LATIN[w] ?? w);

  // توحيد كتابات الوحدات الإنجليزية: gm/gms -> g
  s = s.replace(/\bgms?\b/g, "g");

  // استخراج التركيز: رقم + وحدة (mg/g/ml/mcg/iu) وقد يكون نسبة mg/ml
  let strength = "";
  const strengthRe = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|%)(?:\s*\/\s*(\d+(?:\.\d+)?)\s*(mg|ml))?/g;
  s = s.replace(strengthRe, (_m, n1, u1, n2, u2) => {
    strength = n2 ? `${canonStrength(n1, u1)}/${n2}${u2}` : canonStrength(n1, u1);
    return " ";
  });

  // استخراج الشكل
  let form = "";
  const FORMS = ["tab", "cap", "syr", "amp", "inj", "cream", "oint", "drops", "supp", "spray", "sachet"];
  for (const f of FORMS) {
    const re = new RegExp(`\\b${f}\\b`);
    if (re.test(s)) { form = f; s = s.replace(re, " "); }
  }

  // استخراج حجم العبوة: "14 tab" أو "x14" أو "14's"
  let packSize = "";
  const packRe = /\b(\d+)\s*(?:'s|x|pcs)?\b/;
  // ناخد أول عدد متبقّي كحجم عبوة فقط لو لسه فيه أرقام
  const pm = s.match(packRe);
  if (pm) { packSize = pm[1]; }

  // الاسم الأساسي: شيل كل الرموز والأرقام والمسافات الزيادة
  const base = s
    .replace(/[^a-z\u0600-\u06FF\s]/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const normalizedKey = [base, strength, form].filter(Boolean).join("|");

  return { raw, base, strength, form, packSize, normalizedKey };
}
