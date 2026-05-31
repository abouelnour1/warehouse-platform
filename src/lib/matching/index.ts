export { detectColumns } from "./columnDetect";
export type { DetectResult, FieldKey } from "./columnDetect";
export { buildCatalogEntry, matchProduct } from "./matchEngine";
export type { CatalogProduct, MatchDecision, MatchInput, MatchResult } from "./matchEngine";
export { addBrandTranslations, parseName } from "./normalize";
export type { ParsedName } from "./normalize";
export { ensureUniqueCode, generateProductCode } from "./productCode";
export { loadBrandDictionary } from "./brandDictionary";
