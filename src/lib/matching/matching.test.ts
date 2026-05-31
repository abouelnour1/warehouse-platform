import { describe, expect, it } from "vitest";

import { detectColumns } from "./columnDetect";
import { buildCatalogEntry, matchProduct } from "./matchEngine";
import { addBrandTranslations, parseName } from "./normalize";

describe("matching engine", () => {
  it("normalizes Arabic, English, and equivalent strength forms to the same key", () => {
    const arabic = parseName("أوجمنتين ١ جم أقراص");
    const english = parseName("Augmentin 1000mg tab");
    const englishGm = parseName("AUGMENTIN 1 GM tab");

    expect(arabic.normalizedKey).toBe(english.normalizedKey);
    expect(englishGm.normalizedKey).toBe(english.normalizedKey);
    expect(english.normalizedKey).toBe("augmentin|1000mg|tab");
  });

  it("sends strength mismatches to review instead of auto-matching", () => {
    const catalog = [buildCatalogEntry("product-1", "Augmentin 1g tab")];
    const result = matchProduct({ rawName: "Augmentin 625mg tab" }, catalog);

    expect(result.productId).toBe("product-1");
    expect(result.decision).toBe("review");
    expect(result.reason).toBe("critical_diff_needs_review");
  });

  it("auto-matches a safe typo when strength and form agree", () => {
    const catalog = [buildCatalogEntry("product-1", "Augmentin 1g tab")];
    const result = matchProduct({ rawName: "اوجمينتين 1جم اقراص" }, catalog);

    expect(result.productId).toBe("product-1");
    expect(result.decision).toBe("auto");
    expect(result.reason).toBe("exact_key");
  });

  it("returns new for a brand-new product", () => {
    const catalog = [buildCatalogEntry("product-1", "Augmentin 1g tab")];
    const result = matchProduct({ rawName: "Claritin 10mg tab" }, catalog);

    expect(result.productId).toBeNull();
    expect(result.decision).toBe("new");
    expect(result.reason).toBe("no_match");
  });

  it("detects a messy Arabic and English Excel header", () => {
    const result = detectColumns([
      "serial",
      " البيان ",
      "Unit Price",
      "الرصيد الحالي",
      "GTIN",
      "نسبه الخصم",
    ]);

    expect(result.mapping.name).toBe(1);
    expect(result.mapping.price).toBe(2);
    expect(result.mapping.stock).toBe(3);
    expect(result.mapping.barcode).toBe(4);
    expect(result.mapping.discount).toBe(5);
    expect(result.unmapped).toContain(0);
  });

  it("hydrates additional brand translations from the dictionary", () => {
    addBrandTranslations({ اختبارين: "testorin" });

    const arabic = parseName("اختبارين 500 مجم قرص");
    const english = parseName("Testorin 500mg tab");

    expect(arabic.normalizedKey).toBe(english.normalizedKey);
  });
});
