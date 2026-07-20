import { SUPABASE_URL, SUPABASE_KEY, SPOONACULAR_API_KEY } from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    message: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
  {
    name: "Spoonacular",
    configured: Boolean(SPOONACULAR_API_KEY),
    message: "Spoonacular nie jest skonfigurowany — pobieranie przepisów jest wyłączone.",
    docsUrl: "https://spoonacular.com/food-api/console",
    docsLabel: "Zdobądź klucz API",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
