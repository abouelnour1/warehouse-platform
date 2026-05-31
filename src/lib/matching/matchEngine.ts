// matchEngine.ts — مطابقة صنف من مخزن مع الكتالوج الموحّد
import { parseName, type ParsedName } from "./normalize";

export interface CatalogProduct {
  id: string;
  normalizedKey: string;
  parsed: ParsedName;
  barcode?: string;
}

export interface MatchInput {
  rawName: string;
  barcode?: string;
}

export type MatchDecision = "auto" | "review" | "new";

export interface MatchResult {
  productId: string | null;
  score: number;       // 0..1
  decision: MatchDecision;
  reason: string;
}

// LCS-based similarity على الاسم الأساسي (نفس روح fuzzySearch)
function lcsLen(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

function tokenSim(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  return inter / Math.max(ta.size, tb.size);
}

function baseSim(a: string, b: string): number {
  if (a === b) return 1;
  const lcs = lcsLen(a, b);
  const lcsScore = lcs / Math.max(a.length, b.length);
  const tok = tokenSim(a, b);
  return Math.max(lcsScore, tok);
}

export function buildCatalogEntry(id: string, rawName: string, barcode?: string): CatalogProduct {
  const parsed = parseName(rawName);
  return { id, normalizedKey: parsed.normalizedKey, parsed, barcode };
}

const AUTO_THRESHOLD = 0.92;   // مرفوعة: حذر أكبر ضد الدمج الخاطئ
const REVIEW_THRESHOLD = 0.5;

export function matchProduct(input: MatchInput, catalog: CatalogProduct[]): MatchResult {
  // T1: مطابقة باركود = يقين تام
  if (input.barcode) {
    const hit = catalog.find((c) => c.barcode && c.barcode === input.barcode);
    if (hit) return { productId: hit.id, score: 1, decision: "auto", reason: "barcode" };
  }

  const q = parseName(input.rawName);

  // T2: مفتاح موحّد مطابق تمامًا (اسم+تركيز+شكل)
  const exactKey = catalog.find((c) => c.normalizedKey === q.normalizedKey && q.normalizedKey);
  if (exactKey) return { productId: exactKey.id, score: 0.98, decision: "auto", reason: "exact_key" };

  // T3+: تقييم تشابه على كل مرشح
  let best: CatalogProduct | null = null;
  let bestScore = 0;
  let bestBaseScore = 0;
  let bestHadCriticalDiff = false; // اختلاف في التركيز/الشكل/العبوة

  for (const c of catalog) {
    const initialScore = baseSim(q.base, c.parsed.base);
    let score = initialScore;
    let criticalDiff = false;

    // التركيز: اختلاف صريح = اختلاف حرج (1g != 500mg => أصناف مختلفة طبيًا)
    if (q.strength && c.parsed.strength) {
      if (q.strength !== c.parsed.strength) { score *= 0.4; criticalDiff = true; }
    } else {
      // طرف بلا وحدة: استخدم الرقم الحر كتركيز محتمل
      const qNum = q.strength ? q.strength.replace(/[^\d.]/g, "") : q.packSize;
      const cNum = c.parsed.strength ? c.parsed.strength.replace(/[^\d.]/g, "") : c.parsed.packSize;
      if (qNum && cNum && qNum !== cNum) { score *= 0.5; criticalDiff = true; }
    }
    // الشكل مختلف = اختلاف حرج (شراب vs أقراص)
    if (q.form && c.parsed.form && q.form !== c.parsed.form) { score *= 0.65; criticalDiff = true; }

    if (score > bestScore) {
      bestScore = score;
      bestBaseScore = initialScore;
      best = c;
      bestHadCriticalDiff = criticalDiff;
    }
  }

  // أمان: أي اختلاف حرج (تركيز/شكل) لا يُسمح له أبدًا بالمطابقة التلقائية
  if (best && bestScore >= AUTO_THRESHOLD && !bestHadCriticalDiff)
    return { productId: best.id, score: bestScore, decision: "auto", reason: "high_similarity" };
  if (best && bestHadCriticalDiff && bestBaseScore >= REVIEW_THRESHOLD)
    return { productId: best.id, score: Math.max(bestScore, REVIEW_THRESHOLD), decision: "review",
             reason: "critical_diff_needs_review" };
  if (best && bestScore >= REVIEW_THRESHOLD)
    return { productId: best.id, score: bestScore, decision: "review",
             reason: bestHadCriticalDiff ? "critical_diff_needs_review" : "needs_confirmation" };

  return { productId: null, score: bestScore, decision: "new", reason: "no_match" };
}
