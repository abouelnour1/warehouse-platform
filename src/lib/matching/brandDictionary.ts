import type { SupabaseClient } from "@supabase/supabase-js";

import { addBrandTranslations } from "./normalize";

interface BrandDictionaryRow {
  ar_name: string;
  en_name: string | null;
}

export async function loadBrandDictionary(
  client: SupabaseClient,
): Promise<Record<string, string>> {
  const { data, error } = await client
    .from("brand_dictionary")
    .select("ar_name,en_name");

  if (error) {
    throw error;
  }

  const translations = (data as BrandDictionaryRow[] | null ?? []).reduce<Record<string, string>>(
    (acc, row) => {
      if (row.ar_name && row.en_name) {
        acc[row.ar_name] = row.en_name;
      }
      return acc;
    },
    {},
  );

  addBrandTranslations(translations);
  return translations;
}
