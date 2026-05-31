import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

type FieldKey =
  | "name"
  | "price"
  | "stock"
  | "barcode"
  | "strength"
  | "form"
  | "packSize"
  | "discount"
  | "expiry"
  | "company";

interface ParsedName {
  raw: string;
  base: string;
  strength: string;
  form: string;
  packSize: string;
  normalizedKey: string;
}

interface CatalogProduct {
  id: string;
  normalizedKey: string;
  parsed: ParsedName;
  barcode?: string;
}

type MatchDecision = "auto" | "review" | "new";

interface MatchResult {
  productId: string | null;
  score: number;
  decision: MatchDecision;
  reason: string;
}

interface ImportSummary {
  autoCount: number;
  reviewCount: number;
  newCount: number;
  skippedCount: number;
  importBatchId: string;
}

interface ProductRow {
  id: string;
  product_code: string;
  canonical_name: string;
  normalized_key: string;
  barcode: string | null;
}

interface ReviewRow {
  id: string;
  warehouse_id: string;
  raw_name: string;
  raw_price: number | null;
  raw_stock: number | null;
  suggested_product_id: string | null;
  match_score: number | null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BRAND_AR_TO_EN: Record<string, string> = {
  اوجمنتين: "augmentin",
  اوجمينتين: "augmentin",
  بنادول: "panadol",
  بنادؤل: "panadol",
  كلاريتين: "claritine",
  كونكور: "concor",
  ريفو: "rivo",
  فولتارين: "voltaren",
  بروفين: "brufen",
  زيثروماكس: "zithromax",
  فلاجيل: "flagyl",
  كتافلام: "cataflam",
};

const AR_TO_LATIN: Record<string, string> = {
  جم: "g",
  جرام: "g",
  غ: "g",
  غرام: "g",
  مجم: "mg",
  مج: "mg",
  ملجم: "mg",
  مليجرام: "mg",
  مل: "ml",
  ميكروجرام: "mcg",
  ميكروغرام: "mcg",
  وحده: "iu",
  وحدة: "iu",
  اكسترا: "extra",
  قرص: "tab",
  اقراص: "tab",
  أقراص: "tab",
  كبسوله: "cap",
  كبسولة: "cap",
  كبسولات: "cap",
  شراب: "syr",
  امبول: "amp",
  أمبول: "amp",
  حقن: "inj",
  كريم: "cream",
  مرهم: "oint",
  قطره: "drops",
  قطرة: "drops",
  نقط: "drops",
  لبوس: "supp",
  بخاخ: "spray",
  اكياس: "sachet",
  أكياس: "sachet",
  كيس: "sachet",
};

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(error: string, message: string, status = 400): Response {
  return jsonResponse({ error, message }, status);
}

function normalizeArabicLetters(s: string): string {
  return s
    .replace(/[\u0623\u0625\u0622\u0671]/g, "ا")
    .replace(/\u0629/g, "ه")
    .replace(/\u0649/g, "ي")
    .replace(/\u0640/g, "")
    .replace(/[\u064B-\u0652]/g, "");
}

function arabicDigits(s: string): string {
  const map: Record<string, string> = {
    "٠": "0",
    "١": "1",
    "٢": "2",
    "٣": "3",
    "٤": "4",
    "٥": "5",
    "٦": "6",
    "٧": "7",
    "٨": "8",
    "٩": "9",
  };
  return s.replace(/[٠-٩]/g, (d) => map[d]);
}

function canonStrength(numStr: string, unit: string): string {
  const n = parseFloat(numStr);
  if (Number.isNaN(n)) return `${numStr}${unit}`;
  if (unit === "g") return `${n * 1000}mg`;
  if (unit === "mcg") return `${n / 1000}mg`;
  return `${n}${unit}`;
}

function parseName(raw: string): ParsedName {
  let s = (raw || "").trim().toLowerCase();
  s = arabicDigits(s);
  s = normalizeArabicLetters(s);
  s = s.replace(/[\u0600-\u06FF]+/g, (w) => BRAND_AR_TO_EN[w] ?? AR_TO_LATIN[w] ?? w);
  s = s.replace(/\bgms?\b/g, "g");

  let strength = "";
  const strengthRe = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|%)(?:\s*\/\s*(\d+(?:\.\d+)?)\s*(mg|ml))?/g;
  s = s.replace(strengthRe, (_m, n1, u1, n2, u2) => {
    strength = n2 ? `${canonStrength(n1, u1)}/${n2}${u2}` : canonStrength(n1, u1);
    return " ";
  });

  let form = "";
  const forms = ["tab", "cap", "syr", "amp", "inj", "cream", "oint", "drops", "supp", "spray", "sachet"];
  for (const f of forms) {
    const re = new RegExp(`\\b${f}\\b`);
    if (re.test(s)) {
      form = f;
      s = s.replace(re, " ");
    }
  }

  let packSize = "";
  const packMatch = s.match(/\b(\d+)\s*(?:'s|x|pcs)?\b/);
  if (packMatch) packSize = packMatch[1];

  const base = s
    .replace(/[^a-z\u0600-\u06FF\s]/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const normalizedKey = [base, strength, form].filter(Boolean).join("|");
  return { raw, base, strength, form, packSize, normalizedKey };
}

function normHeader(s: string): string {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\u0623\u0625\u0622]/g, "ا")
    .replace(/\u0629/g, "ه")
    .replace(/\u0649/g, "ي")
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/\s+/g, " ");
}

function detectColumns(headerRow: string[]) {
  const mapping: Partial<Record<FieldKey, number>> = {};
  const confidence: Record<string, number> = {};
  const used = new Set<number>();

  (Object.keys(SYNONYMS) as FieldKey[]).forEach((field) => {
    let best = -1;
    let bestScore = 0;
    headerRow.forEach((h, idx) => {
      if (used.has(idx)) return;
      for (const syn of SYNONYMS[field]) {
        const header = normHeader(h);
        const synonym = normHeader(syn);
        if (header && (header === synonym || header.includes(synonym) || synonym.includes(header))) {
          const score = header === synonym ? 1 : 0.7;
          if (score > bestScore) {
            bestScore = score;
            best = idx;
          }
        }
      }
    });
    if (best >= 0) {
      mapping[field] = best;
      confidence[field] = bestScore;
      used.add(best);
    }
  });

  return { mapping, confidence, unmapped: headerRow.map((_, i) => i).filter((i) => !used.has(i)) };
}

function lcsLen(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1).fill(0);
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
  ta.forEach((t) => {
    if (tb.has(t)) inter++;
  });
  return inter / Math.max(ta.size, tb.size);
}

function baseSim(a: string, b: string): number {
  if (a === b) return 1;
  const lcs = lcsLen(a, b);
  return Math.max(lcs / Math.max(a.length, b.length), tokenSim(a, b));
}

function matchProduct(input: { rawName: string; barcode?: string }, catalog: CatalogProduct[]): MatchResult {
  if (input.barcode) {
    const hit = catalog.find((c) => c.barcode && c.barcode === input.barcode);
    if (hit) return { productId: hit.id, score: 1, decision: "auto", reason: "barcode" };
  }

  const q = parseName(input.rawName);
  const exactKey = catalog.find((c) => c.normalizedKey === q.normalizedKey && q.normalizedKey);
  if (exactKey) return { productId: exactKey.id, score: 0.98, decision: "auto", reason: "exact_key" };

  let best: CatalogProduct | null = null;
  let bestScore = 0;
  let bestBaseScore = 0;
  let bestHadCriticalDiff = false;

  for (const c of catalog) {
    const initialScore = baseSim(q.base, c.parsed.base);
    let score = initialScore;
    let criticalDiff = false;

    if (q.strength && c.parsed.strength) {
      if (q.strength !== c.parsed.strength) {
        score *= 0.4;
        criticalDiff = true;
      }
    } else {
      const qNum = q.strength ? q.strength.replace(/[^\d.]/g, "") : q.packSize;
      const cNum = c.parsed.strength ? c.parsed.strength.replace(/[^\d.]/g, "") : c.parsed.packSize;
      if (qNum && cNum && qNum !== cNum) {
        score *= 0.5;
        criticalDiff = true;
      }
    }

    if (q.form && c.parsed.form && q.form !== c.parsed.form) {
      score *= 0.65;
      criticalDiff = true;
    }

    if (score > bestScore) {
      bestScore = score;
      bestBaseScore = initialScore;
      best = c;
      bestHadCriticalDiff = criticalDiff;
    }
  }

  if (best && bestScore >= 0.92 && !bestHadCriticalDiff) {
    return { productId: best.id, score: bestScore, decision: "auto", reason: "high_similarity" };
  }
  if (best && bestHadCriticalDiff && bestBaseScore >= 0.5) {
    return { productId: best.id, score: Math.max(bestScore, 0.5), decision: "review", reason: "critical_diff_needs_review" };
  }
  if (best && bestScore >= 0.5) {
    return {
      productId: best.id,
      score: bestScore,
      decision: "review",
      reason: bestHadCriticalDiff ? "critical_diff_needs_review" : "needs_confirmation",
    };
  }

  return { productId: null, score: bestScore, decision: "new", reason: "no_match" };
}

function generateProductCode(parsed: ParsedName): string {
  const firstWord = parsed.base.split(" ").filter(Boolean)[0] ?? "";
  const latin = firstWord.replace(/[^a-z]/g, "");
  const base = latin.length >= 3 ? latin.slice(0, 3).toUpperCase() : latin.toUpperCase() || "X";
  const strength = shortStrength(parsed.strength);
  const form = parsed.form ? parsed.form.toUpperCase() : "";
  return [base, strength, form].filter(Boolean).join("-");
}

function shortStrength(strength: string): string {
  if (!strength) return "";
  const match = strength.match(/^(\d+(?:\.\d+)?)mg$/);
  if (match) {
    const n = parseFloat(match[1]);
    if (n >= 1000 && n % 1000 === 0) return `${n / 1000}G`;
    return `${n}MG`;
  }
  return strength.replace(/[^a-z0-9.]/gi, "").toUpperCase();
}

function ensureUniqueCode(baseCode: string, existingCodes: Set<string>): string {
  if (!existingCodes.has(baseCode)) return baseCode;
  let i = 2;
  while (existingCodes.has(`${baseCode}-${i}`)) i++;
  return `${baseCode}-${i}`;
}

function toText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = parseFloat(toText(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rowValue(row: unknown[], index: number | undefined): unknown {
  return index === undefined ? undefined : row[index];
}

function buildCatalog(products: ProductRow[]): CatalogProduct[] {
  return products.map((product) => ({
    id: product.id,
    normalizedKey: product.normalized_key,
    parsed: parseName(product.canonical_name),
    barcode: product.barcode ?? undefined,
  }));
}

async function getWarehouseId(client: ReturnType<typeof createClient>, authHeader: string | null): Promise<string> {
  if (!authHeader) throw new Error("Missing authorization header.");

  const jwt = authHeader.replace("Bearer ", "");
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) throw new Error("Invalid user session.");

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (profileError) throw profileError;
  if (profile.role !== "warehouse") throw new Error("Only warehouse users can import prices.");

  const { data: warehouse, error: warehouseError } = await client
    .from("warehouses")
    .select("id,status,is_deleted")
    .eq("id", data.user.id)
    .single();

  if (warehouseError) throw warehouseError;
  if (warehouse.status !== "active" || warehouse.is_deleted) throw new Error("Warehouse account is not active.");

  return data.user.id;
}

async function upsertOffer(
  client: ReturnType<typeof createClient>,
  warehouseId: string,
  productId: string,
  rawName: string,
  price: number,
  stock: number,
  discountPct: number,
) {
  const { error } = await client.from("offers").upsert(
    {
      warehouse_id: warehouseId,
      product_id: productId,
      warehouse_raw_name: rawName,
      price,
      discount_pct: discountPct,
      stock,
      is_available: stock > 0,
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
    },
    { onConflict: "warehouse_id,product_id" },
  );
  if (error) throw error;
}

async function mapRawName(
  client: ReturnType<typeof createClient>,
  warehouseId: string,
  rawName: string,
  productId: string,
  confirmed: boolean,
) {
  const { error } = await client.from("warehouse_product_map").upsert(
    {
      warehouse_id: warehouseId,
      raw_name: rawName,
      product_id: productId,
      confirmed,
    },
    { onConflict: "warehouse_id,raw_name" },
  );
  if (error) throw error;
}

async function createProduct(
  client: ReturnType<typeof createClient>,
  warehouseId: string,
  rawName: string,
  barcode: string,
  existingCodes: Set<string>,
): Promise<ProductRow> {
  const parsed = parseName(rawName);
  const normalizedKey = parsed.normalizedKey || `unparsed|${crypto.randomUUID()}`;
  const baseCode = generateProductCode(parsed);
  const productCode = ensureUniqueCode(baseCode, existingCodes);

  const { data, error } = await client
    .from("products")
    .insert({
      product_code: productCode,
      canonical_name: rawName,
      normalized_key: normalizedKey,
      strength: parsed.strength || null,
      form: parsed.form || null,
      pack_size: parsed.packSize || null,
      barcode: barcode || null,
      created_from_warehouse: warehouseId,
    })
    .select("id,product_code,canonical_name,normalized_key,barcode")
    .single();

  if (error) {
    const { data: existing, error: lookupError } = await client
      .from("products")
      .select("id,product_code,canonical_name,normalized_key,barcode")
      .eq("normalized_key", normalizedKey)
      .single();
    if (lookupError) throw error;
    return existing;
  }

  existingCodes.add(productCode);
  return data;
}

async function importPrices(req: Request, client: ReturnType<typeof createClient>, warehouseId: string): Promise<Response> {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return errorResponse("MISSING_FILE", "Expected file field named 'file'");

  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return errorResponse("EMPTY_WORKBOOK", "Workbook has no sheets.");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) => row.some((cell) => toText(cell)));
  if (headerIndex < 0) return errorResponse("MISSING_HEADER_ROW", "No header row found.");

  const header = rows[headerIndex].map((cell) => toText(cell));
  const { mapping } = detectColumns(header);
  if (mapping.name === undefined || mapping.price === undefined) {
    return jsonResponse({ error: "MISSING_REQUIRED_COLUMNS", message: "Could not detect required name and price columns.", mapping }, 400);
  }

  const { data: products, error: productError } = await client
    .from("products")
    .select("id,product_code,canonical_name,normalized_key,barcode")
    .eq("is_deleted", false);
  if (productError) throw productError;

  const { data: maps, error: mapError } = await client
    .from("warehouse_product_map")
    .select("raw_name,product_id")
    .eq("warehouse_id", warehouseId);
  if (mapError) throw mapError;

  const rawNameMap = new Map<string, string>((maps ?? []).map((row) => [row.raw_name, row.product_id]));
  const catalog = buildCatalog(products ?? []);
  const existingCodes = new Set((products ?? []).map((product) => product.product_code));
  const importBatchId = crypto.randomUUID();
  const summary: ImportSummary = { autoCount: 0, reviewCount: 0, newCount: 0, skippedCount: 0, importBatchId };

  for (const row of rows.slice(headerIndex + 1)) {
    const rawName = toText(rowValue(row, mapping.name));
    if (!rawName) {
      summary.skippedCount++;
      continue;
    }

    const price = toNumber(rowValue(row, mapping.price));
    const stock = toNumber(rowValue(row, mapping.stock), 0);
    const discountPct = toNumber(rowValue(row, mapping.discount), 0);
    const barcode = toText(rowValue(row, mapping.barcode));

    const mappedProductId = rawNameMap.get(rawName);
    if (mappedProductId) {
      await upsertOffer(client, warehouseId, mappedProductId, rawName, price, stock, discountPct);
      summary.autoCount++;
      continue;
    }

    const match = matchProduct({ rawName, barcode }, catalog);

    if (match.decision === "auto" && match.productId) {
      await upsertOffer(client, warehouseId, match.productId, rawName, price, stock, discountPct);
      await mapRawName(client, warehouseId, rawName, match.productId, true);
      rawNameMap.set(rawName, match.productId);
      summary.autoCount++;
      continue;
    }

    if (match.decision === "review") {
      const { error } = await client.from("match_review_queue").insert({
        warehouse_id: warehouseId,
        raw_name: rawName,
        raw_price: price,
        raw_stock: stock,
        suggested_product_id: match.productId,
        match_score: match.score,
      });
      if (error) throw error;
      summary.reviewCount++;
      continue;
    }

    const product = await createProduct(client, warehouseId, rawName, barcode, existingCodes);
    catalog.push({
      id: product.id,
      normalizedKey: product.normalized_key,
      parsed: parseName(product.canonical_name),
      barcode: product.barcode ?? undefined,
    });
    await upsertOffer(client, warehouseId, product.id, rawName, price, stock, discountPct);
    await mapRawName(client, warehouseId, rawName, product.id, true);
    rawNameMap.set(rawName, product.id);
    summary.newCount++;
  }

  await client.from("match_metrics").insert({
    warehouse_id: warehouseId,
    import_batch_id: importBatchId,
    auto_count: summary.autoCount,
    review_count: summary.reviewCount,
    new_count: summary.newCount,
  });

  await client.from("warehouses").update({ last_price_update: new Date().toISOString() }).eq("id", warehouseId);

  return jsonResponse({ summary, mapping });
}

async function addDictionaryTranslation(client: ReturnType<typeof createClient>, rawName: string, productName: string) {
  const rawHasArabic = /[\u0600-\u06FF]/.test(rawName);
  const productHasArabic = /[\u0600-\u06FF]/.test(productName);
  if (rawHasArabic === productHasArabic) return;

  const arName = rawHasArabic ? parseName(rawName).base : parseName(productName).base;
  const enName = rawHasArabic ? parseName(productName).base : parseName(rawName).base;
  if (!arName || !enName || /[\u0600-\u06FF]/.test(enName)) return;

  await client.from("brand_dictionary").upsert({ ar_name: arName, en_name: enName }, { onConflict: "ar_name" });
}

async function handleReviewAction(req: Request, client: ReturnType<typeof createClient>, warehouseId: string): Promise<Response> {
  const body = await req.json();
  const action = String(body.action ?? "");

  if (action === "manualAdd") {
    const rawName = String(body.rawName ?? "").trim();
    const price = toNumber(body.price);
    const stock = toNumber(body.stock);
    const barcode = String(body.barcode ?? "").trim();
    if (!rawName) return jsonResponse({ error: "Product name is required." }, 400);

    const { data: products, error } = await client
      .from("products")
      .select("id,product_code,canonical_name,normalized_key,barcode")
      .eq("is_deleted", false);
    if (error) throw error;

    const catalog = buildCatalog(products ?? []);
    const match = matchProduct({ rawName, barcode }, catalog);
    const existingCodes = new Set((products ?? []).map((product) => product.product_code));
    const productId = match.decision === "auto" && match.productId
      ? match.productId
      : (await createProduct(client, warehouseId, rawName, barcode, existingCodes)).id;

    await upsertOffer(client, warehouseId, productId, rawName, price, stock, 0);
    await mapRawName(client, warehouseId, rawName, productId, true);
    await client.from("warehouses").update({ last_price_update: new Date().toISOString() }).eq("id", warehouseId);
    return jsonResponse({ ok: true, productId });
  }

  const reviewId = String(body.reviewId ?? "");

  const { data: review, error: reviewError } = await client
    .from("match_review_queue")
    .select("id,warehouse_id,raw_name,raw_price,raw_stock,suggested_product_id,match_score")
    .eq("id", reviewId)
    .eq("warehouse_id", warehouseId)
    .single<ReviewRow>();
  if (reviewError) throw reviewError;

  if (action === "ignore") {
    await client.from("match_review_queue").update({ status: "rejected" }).eq("id", review.id);
    return jsonResponse({ ok: true });
  }

  let productId = review.suggested_product_id;

  if (action === "new") {
    const { data: products, error } = await client.from("products").select("product_code");
    if (error) throw error;
    const existingCodes = new Set((products ?? []).map((product) => product.product_code));
    const product = await createProduct(client, warehouseId, review.raw_name, "", existingCodes);
    productId = product.id;
    await client.from("match_review_queue").update({ status: "new_product" }).eq("id", review.id);
  }

  if (action === "same") {
    productId = body.productId ? String(body.productId) : productId;
    if (!productId) return jsonResponse({ error: "No product selected." }, 400);
    await client.from("match_review_queue").update({ status: "confirmed" }).eq("id", review.id);
  }

  if (!productId) return jsonResponse({ error: "Unsupported review action." }, 400);

  const { data: product, error: productError } = await client
    .from("products")
    .select("canonical_name")
    .eq("id", productId)
    .single();
  if (productError) throw productError;

  await upsertOffer(client, warehouseId, productId, review.raw_name, review.raw_price ?? 0, review.raw_stock ?? 0, 0);
  await mapRawName(client, warehouseId, review.raw_name, productId, true);
  await addDictionaryTranslation(client, review.raw_name, product.canonical_name);
  await client.from("warehouses").update({ last_price_update: new Date().toISOString() }).eq("id", warehouseId);

  return jsonResponse({ ok: true, productId });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("METHOD_NOT_ALLOWED", "Method not allowed.", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return errorResponse("FUNCTION_NOT_CONFIGURED", "Function is not configured.", 500);

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const warehouseId = await getWarehouseId(client, req.headers.get("Authorization"));
    const contentType = req.headers.get("Content-Type") ?? "";

    if (contentType.includes("application/json")) {
      return await handleReviewAction(req, client, warehouseId);
    }

    return await importPrices(req, client, warehouseId);
  } catch (error) {
    return errorResponse("IMPORT_FAILED", error instanceof Error ? error.message : "Import failed.");
  }
});
