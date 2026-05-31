// columnDetect.ts — يتعرّف على أعمدة أي ملف Excel مهما كان ترتيبها أو لغتها
// يرجّع mapping: أي عمود هو الاسم/السعر/الكمية/الباركود...

export type FieldKey =
  | "name" | "price" | "stock" | "barcode"
  | "strength" | "form" | "packSize" | "discount" | "expiry" | "company";

// مرادفات كل حقل بالعربي والإنجليزي (lowercase)
const SYNONYMS: Record<FieldKey, string[]> = {
  name: ["اسم الصنف", "الصنف", "اسم", "name", "item", "product", "description", "drug", "صنف", "المنتج", "البيان"],
  price: ["السعر", "سعر", "price", "unit price", "cost", "السعر للوحده", "سعر البيع", "ثمن"],
  stock: ["الكميه المتاحه", "الكميه", "كميه", "qty", "quantity", "stock", "balance", "الرصيد", "رصيد", "متاح", "available"],
  barcode: ["الباركود", "باركود", "barcode", "ean", "upc", "gtin", "كود"],
  strength: ["التركيز", "تركيز", "strength", "dose", "dosage", "conc"],
  form: ["الشكل", "شكل", "form", "type", "dosage form", "شكل صيدلي"],
  packSize: ["حجم العبوه", "العبوه", "pack", "pack size", "package", "عبوه"],
  discount: ["نسبه الخصم", "الخصم", "خصم", "discount", "disc", "offer", "عرض"],
  expiry: ["تاريخ الصلاحيه", "الصلاحيه", "expiry", "exp", "expiration", "صلاحيه"],
  company: ["الشركه المنتجه", "الشركه", "شركه", "company", "manufacturer", "vendor", "agent", "الوكيل"],
};

function norm(s: string): string {
  return (s || "")
    .toString().trim().toLowerCase()
    .replace(/[\u0623\u0625\u0622]/g, "ا")
    .replace(/\u0629/g, "ه")
    .replace(/\u0649/g, "ي")
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/\s+/g, " ");
}

// تشابه بسيط: هل أحدهما يحتوي الآخر
function headerMatches(header: string, syn: string): boolean {
  const h = norm(header), s = norm(syn);
  if (!h) return false;
  return h === s || h.includes(s) || s.includes(h);
}

export interface DetectResult {
  mapping: Partial<Record<FieldKey, number>>; // الحقل -> رقم العمود
  confidence: Record<string, number>;
  unmapped: number[];
}

export function detectColumns(headerRow: string[]): DetectResult {
  const mapping: Partial<Record<FieldKey, number>> = {};
  const confidence: Record<string, number> = {};
  const used = new Set<number>();

  // مرّ على كل حقل وادوّر على أنسب عمود
  (Object.keys(SYNONYMS) as FieldKey[]).forEach((field) => {
    let best = -1, bestScore = 0;
    headerRow.forEach((h, idx) => {
      if (used.has(idx)) return;
      for (const syn of SYNONYMS[field]) {
        if (headerMatches(h, syn)) {
          const score = norm(h) === norm(syn) ? 1 : 0.7;
          if (score > bestScore) { bestScore = score; best = idx; }
        }
      }
    });
    if (best >= 0) {
      mapping[field] = best;
      confidence[field] = bestScore;
      used.add(best);
    }
  });

  const unmapped = headerRow.map((_, i) => i).filter((i) => !used.has(i));
  return { mapping, confidence, unmapped };
}
