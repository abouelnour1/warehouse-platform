// productCode.ts — توليد كود وصفي ثابت يقرأه الإنسان لكل صنف
// مثال: "Augmentin 1g tab" => "AUG-1G-TAB"
// ملاحظة مهمة: الكود ده للعرض والقراءة فقط. المطابقة الفعلية تعتمد على
// normalized_key و product.id، مش على الكود الوصفي (لتجنّب التصادمات).
import type { ParsedName } from "./normalize";

// اختصار اسم الصنف: أول 3-4 حروف لاتينية بحروف كبيرة
function abbrevBase(base: string): string {
  // ناخد أول كلمة (الاسم التجاري) ونحوّلها لاتيني لو لزم
  const firstWord = base.split(" ").filter(Boolean)[0] ?? "";
  // أخذ أول 3 حروف لاتينية فقط (نتجاهل العربي لو موجود — يفترض base متطبّع للاتيني)
  const latin = firstWord.replace(/[^a-z]/g, "");
  if (latin.length >= 3) return latin.slice(0, 3).toUpperCase();
  if (latin.length > 0) return latin.toUpperCase();
  return "X"; // احتياطي
}

// تبسيط التركيز للعرض: "1000mg" => "1G" لو قابل، وإلا كما هو
function shortStrength(strength: string): string {
  if (!strength) return "";
  // التركيز عندنا متطبّع لـ mg. نرجّعه لصيغة قصيرة للعرض.
  const m = strength.match(/^(\d+(?:\.\d+)?)mg$/);
  if (m) {
    const n = parseFloat(m[1]);
    if (n >= 1000 && n % 1000 === 0) return `${n / 1000}G`;
    return `${n}MG`;
  }
  // نسب أو وحدات أخرى: شيل الرموز
  return strength.replace(/[^a-z0-9.]/gi, "").toUpperCase();
}

function shortForm(form: string): string {
  return form ? form.toUpperCase() : "";
}

// توليد الكود الأساسي (قبل فحص التصادم)
export function generateProductCode(parsed: ParsedName): string {
  const parts = [abbrevBase(parsed.base), shortStrength(parsed.strength), shortForm(parsed.form)];
  return parts.filter(Boolean).join("-");
}

// ضمان التفرّد: لو الكود مستخدم لمنتج مختلف، أضف لاحقة رقمية
// existingCodes: مجموعة الأكواد الموجودة فعلًا في قاعدة البيانات
export function ensureUniqueCode(baseCode: string, existingCodes: Set<string>): string {
  if (!existingCodes.has(baseCode)) return baseCode;
  let i = 2;
  while (existingCodes.has(`${baseCode}-${i}`)) i++;
  return `${baseCode}-${i}`;
}
