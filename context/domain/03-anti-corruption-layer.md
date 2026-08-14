---
title: Anti-Corruption Layer for the recipe provider (Spoonacular)
created: 2026-08-11
type: refactor-plan
---

# Anti-Corruption Layer — izolacja dostawcy przepisów

> Produkt tego dokumentu to **plan**. Nie zmieniono żadnego pliku produkcyjnego.
> Wszystkie cytaty `plik:linia` zweryfikowane na `master` @ `5a83621`.

---

## KROK 0 — Kontekst odkryty

**Stack** (`package.json:20-47`): Astro 6 SSR + React 19 + Tailwind 4, adapter
`@astrojs/cloudflare`, Supabase (`@supabase/ssr`, `@supabase/supabase-js`),
TypeScript, Vitest + Playwright.

**Zależności zewnętrzne o charakterze "systemu obcego"** — dwie, i tylko dwie:

| Oś | Postać w kodzie | Skąd wchodzi |
|---|---|---|
| **Supabase** | pakiet npm (`@supabase/ssr`, `@supabase/supabase-js`) | `src/lib/supabase.ts:1`, `src/lib/supabase-admin.ts:1` |
| **Spoonacular** | **brak pakietu** — surowy `fetch` na `https://api.spoonacular.com` | `src/lib/spoonacular.ts:3,93` |

**Warstwy kodu**: `src/lib/**` (domena + I/O) → `src/pages/api/**` (endpointy /
kontrakt wire) → `src/components/**` (wyspy React, bundle klienta) →
`src/pages/**.astro` (SSR) → `supabase/migrations/*.sql` (persystencja).

**Deklaracje o wymienialności w dokumentach bazowych** — obie dotyczą Spoonaculara,
żadna Supabase'a:

- `context/foundation/tech-stack.md:24` — retrieval to *"a plain REST endpoint called
  with global `fetch` and wired in on top, **independent of starter choice**"*.
  Deklaracja: warstwa pobierania przepisów jest doczepiona z boku, nie wrośnięta.
- `context/foundation/prd.md:76` (FR-003) — Spoonacular jest *"the retrieval mechanism
  **for v1**"*, a limity darmowego planu to *"the accepted **MVP** constraints"*.
  Sformułowanie „dla v1 / na MVP" jest wprost zapowiedzią wymiany.
- `context/foundation/prd.md:144` (Open Question 1) — jeśli limit 50 pkt/dobę nie
  wytrzyma, wyborem jest *"the $29/mo tier (1,500 points/day) **or a request-shaping
  change** such as serving fewer cuisines per set"*. To otwarte, nierozstrzygnięte
  pytanie, którego rozwiązanie zmienia kontrakt wywołań dostawcy.

---

## KROK 1 — Identyfikacja przeciekających zależności

### Oś A — Supabase SDK

Pełna lista plików, które dziś „znają" pakiet Supabase (grep po `@supabase/`,
z pominięciem `node_modules/` i dokumentacji):

- `src/lib/supabase.ts:1` — `createServerClient`, `parseCookieHeader`
- `src/lib/supabase-admin.ts:1` — `createClient`, `type SupabaseClient`
- `src/env.d.ts:3` — `import("@supabase/supabase-js").User` w `App.Locals`

Trzy pliki, jeden katalog + globalna deklaracja typu. Reszta kodu widzi wyłącznie
`ReturnType<typeof createClient>` (`src/lib/history.ts:1,24`,
`src/pages/api/proposals.ts:163`). **Ten przeciek jest już opanowany.**

### Oś B — kontrakt danych Spoonaculara

To nie przeciek *pakietu* — pakietu nie ma. To przeciek **kształtu obcego modelu
danych**: nazwy pól dostawcy, jego reguły fallbacku i jego identyfikator wsiąkły we
wszystkie warstwy. Pliki, które dziś znają ten kształt:

**Warstwa I/O**
- `src/lib/spoonacular.ts:6-14` — `RecipeCandidate` z polami `sourceName`, `sourceUrl`,
  `spoonacularSourceUrl`, `summary`; `:54-72` `toCandidate` przepisuje je 1:1
- `src/lib/spoonacular.ts:121-141` — `searchRecipes` / `getRecipeById`

**Warstwa domeny**
- `src/lib/proposals.ts:1` — import `RecipeCandidate`
- `src/lib/proposals.ts:13-16` — `ProposedRecipe **extends RecipeCandidate**`:
  typ domenowy dziedziczy kształt dostawcy zamiast go tłumaczyć
- `src/lib/proposals.ts:254-260` — `toProposed` rozlewa `...recipe` dalej
- `src/lib/history.ts:26-36,112-118` — `spoonacularId` w każdym typie domenowym
  (`RecentLike`, `StaleLike`, `RatedRecipe`)

**Warstwa API / kontrakt wire**
- `src/pages/api/proposals.ts:33-49` — `ProposalPayload` **powtarza** siedem pól
  dostawcy w kontrakcie wysyłanym do przeglądarki
- `src/pages/api/proposals.ts:51-70` — `toPayload` przepisuje je ręcznie, pole po polu
- `src/pages/api/proposals.ts:186` — `spoonacular_id` w zapisie do `recipes`
- `src/pages/api/ratings.ts:32-64` — `spoonacularId` w kontrakcie wejściowym POST i DELETE;
  `:37` `parseSpoonacularId`; `:101-109`, `:159-164` w zapytaniach

**Warstwa UI (bundle klienta)**
- `src/components/proposals/types.ts:9,14` — re-eksport `ProposalPayload`
- `src/components/proposals/RecipeCard.tsx:67-73` — **reguła FR-010 zaimplementowana
  w komponencie React**: fallback `sourceUrl → spoonacularSourceUrl`, wyprowadzenie
  atrybucji z hostname, sanityzacja URL-i
- `src/components/proposals/RecipeCard.tsx:51` — `{ spoonacularId: proposal.id }` w body fetcha
- `src/components/ratings/types.ts:7` — re-eksport `RatedRecipe`
- `src/components/ratings/RatedRecipesList.tsx:59,63,67,103,132` — `spoonacularId`
  jako klucz Reacta i pole body; `:151` — `safeUrl(rating.image)`

**Warstwa persystencji**
- `supabase/migrations/20260720181257_cold_start_proposals.sql:15,24`
- `supabase/migrations/20260808120000_rate_recipe.sql:15,21`
- `supabase/migrations/20260809120000_personalized_proposal_slots.sql:32,38,40,58,68-69,74`
- `supabase/migrations/20260809180000_manage_rated_recipes.sql`

**Warstwa konfiguracji / copy**
- `astro.config.mjs:21` — `SPOONACULAR_API_KEY`
- `src/lib/config-status.ts:1,20-25` — nazwa dostawcy w tekście widocznym dla użytkownika

---

## KROK 2 — Klasyfikacja i wybór #1

| Kryterium | Oś A — Supabase | Oś B — Spoonacular |
|---|---|---|
| (a) warstw dotkniętych | **1** (`src/lib/`) + `env.d.ts` | **6**: I/O, domena, API, UI, SQL, config |
| (a) plików produkcyjnych | 3 | **12** + 4 migracje |
| (b) koszt wymiany dziś | niski — 2 fabryki, jeden typ w `Locals` | **wysoki** — zmiana kontraktu dostawcy dotyka DTO wire, wyspy React, kolumn i indeksów |
| (b) ryzyko wymiany | niskie, wykrywalne przez kompilator | **wysokie i częściowo niewykrywalne** — reguła FR-010 żyje w JSX, nie w typie |
| (c) deklarowana wymienialność w dokumentach | brak | **jawna, trzykrotna** (tech-stack:24, prd:76, prd:144) |
| (c) rozjazd intencja-vs-kod | brak | **maksymalny** |

### Wybór: **oś B — kontrakt danych Spoonaculara**. Uzasadnienie:

1. **Skala.** 6 warstw wobec 1. Supabase jest już de facto za portem
   (`SessionClient` w `src/lib/history.ts:24` to typ strukturalny, nie import SDK);
   Spoonacular nie jest za niczym.
2. **Rozjazd intencja-vs-kod jest tu najostrzejszy.** Dokumenty bazowe **nigdzie**
   nie obiecują wymienialności Supabase'a, a Spoonaculara obiecują trzy razy —
   w tym w otwartym, nierozstrzygniętym pytaniu (`prd.md:144`), którego dowolna
   odpowiedź (płatny tier / przekształcenie wywołań) uderza w kod.
3. **Ochrona zgodności prawnej, nie tylko estetyka.** FR-010 i FR-011 to warunki
   licencyjne. Dziś FR-010 jest egzekwowane w komponencie React
   (`RecipeCard.tsx:67-73`), czyli w warstwie, którą redesign UI może przepisać
   bez świadomości, że przepisuje klauzulę licencji. PRD explicite chce tego uniknąć:
   *"it must survive any future redesign of the proposal card"* (`prd.md:80`).

**Oś A nie jest problemem i nie jest przedmiotem tego planu.**

---

## KROK 3 — Diagnoza

### D-1. Kształt dostawcy jest deklarowany dwa razy, w dwóch warstwach

`src/lib/spoonacular.ts:6-14`:

```ts
export interface RecipeCandidate {
  id: number; title: string; image: string | null; summary: string | null;
  sourceName: string | null; sourceUrl: string | null; spoonacularSourceUrl: string | null;
}
```

`src/pages/api/proposals.ts:33-49` powtarza sześć z tych pól w `ProposalPayload`
(`id`, `title`, `image`, `sourceName`, `sourceUrl`, `spoonacularSourceUrl`), a
`toPayload` (`:51-70`) przepisuje je ręcznie, pole po polu. Nazwa `spoonacularSourceUrl`
— identyfikator dostawcy — jest **publicznym polem kontraktu HTTP** aplikacji.

Trzecia rekonstrukcja to `ProposedRecipe extends RecipeCandidate`
(`src/lib/proposals.ts:13-16`): typ domenowy nie tłumaczy modelu obcego, tylko go
dziedziczy i dokleja dwa pola.

### D-2. Reguła licencyjna FR-010 mieszka w JSX

`src/components/proposals/RecipeCard.tsx:70-72`:

```tsx
const source = safeUrl(proposal.sourceUrl);
const link = source ?? safeUrl(proposal.spoonacularSourceUrl);
const credit = proposal.sourceName ?? source?.hostname.replace(/^www\./, "") ?? null;
```

To jest pełna implementacja FR-010 (`prd.md:79-80`) i połowa NFR o martwych linkach
(`prd.md:109-110`) — trzy linie w komponencie prezentacyjnym. Konsekwencje:

- redesign karty może ją usunąć bez sygnału z kompilatora,
- pole `spoonacularSourceUrl` musi przejść przez sieć **tylko po to**, żeby klient
  mógł wykonać `??` — serwer zna wynik i mógłby go wysłać gotowy,
- `src/components/ratings/RatedRecipesList.tsx:151` powtarza fragment tej samej
  wiedzy (`safeUrl(rating.image)`) niezależnie, w drugim komponencie.

### D-3. `spoonacularId` → `spoonacular_id`: to samo mapowanie w pięciu miejscach

`src/lib/history.ts:58-61`, `:85-89`, `:109`, `:156-162` — cztery razy ręcznie
`spoonacularId: row.spoonacular_id as number`. Piąte miejsce to
`src/pages/api/ratings.ts:101-109` i `:159-164` (kierunek odwrotny).

### D-4. Groźny przeciek przez granicę klient/serwer — **nie występuje**

Sprawdzone i uczciwie odnotowane: `src/components/proposals/types.ts:1-9` używa
`export type { ... }`, czyli importu wymazywanego w czasie kompilacji, i sam plik to
dokumentuje (`:6-7`). **Żaden moduł serwerowy nie trafia do bundla klienta**, klucz API
nie wycieka (`src/lib/spoonacular.ts:74-76,89`), a surowy HTML `summary` jest odcięty
przed granicą (`src/pages/api/proposals.ts:29-32`). To jest zrobione dobrze i plan
tego nie zmienia.

Przeciek jest zatem **konceptualny, nie bezpieczeństwa**: wyciekają *nazwy i reguły*
dostawcy, nie jego kod.

### D-5. Cytat kontra kod

| Deklaracja | Rzeczywistość |
|---|---|
| `tech-stack.md:24` — *"wired in on top, independent of starter choice"* | `spoonacularSourceUrl` jest polem kontraktu HTTP (`api/proposals.ts:40`) i propem komponentu React (`RecipeCard.tsx:71`) |
| `prd.md:76` — *"the retrieval mechanism **for v1**"* | nazwa dostawcy jest w nazwach kolumn i indeksów bazy (`20260809120000_personalized_proposal_slots.sql:68-69`) |
| `prd.md:80` — FR-010 *"must survive any future redesign of the proposal card"* | FR-010 **jest** designem karty (`RecipeCard.tsx:70-72`) |

---

## KROK 4 — Projekt ACL

Nowy katalog: **`src/lib/recipe-provider/`**. Jedyne miejsce w repozytorium, które zna
słowo „spoonacular".

```
src/lib/recipe-provider/
  recipe-reference.ts   # value object — jedyna wiedza o kształcie danych dostawcy
  port.ts               # wąski interfejs domenowy (RecipeProvider)
  spoonacular-adapter.ts# implementacja portu (dzisiejsze src/lib/spoonacular.ts)
  index.ts              # eksportuje WYŁĄCZNIE: RecipeRef, RecipeProvider, provider
```

### 4.1 Value object — `RecipeReference`

Jedyne miejsce wiedzy o: mapowaniu z/do persystencji, konwersji z/do typu dostawcy
oraz operacjach domenowych (FR-010 / NFR martwych linków).

```ts
// src/lib/recipe-provider/recipe-reference.ts

/** Nieprzezroczysty identyfikator przepisu u dostawcy. Domena nie wie, że to `spoonacular_id`. */
export type RecipeRefId = number & { readonly __brand: "RecipeRefId" };

/**
 * Domenowa referencja do przepisu. Pola nazwane językiem PRODUKTU, nie dostawcy:
 * `publisher` / `link` zamiast `sourceName` / `sourceUrl` / `spoonacularSourceUrl`.
 * Fallback z FR-010 jest już ROZSTRZYGNIĘTY w chwili konstrukcji.
 */
export interface RecipeRef {
  readonly id: RecipeRefId;
  readonly title: string;
  /** Bezpieczny http(s) albo null — reguła z safe-url.ts wciągnięta do konstruktora. */
  readonly imageUrl: string | null;
  /** FR-010: link do wydawcy; fallback dostawcy zastosowany tutaj, nie w UI. */
  readonly link: string | null;
  /** FR-010: widoczna atrybucja; hostname jako fallback zastosowany tutaj, nie w UI. */
  readonly publisher: string | null;
  /** Surowy HTML opisu — NIGDY nie opuszcza ACL-a; wejście dla sanitizeSummary. */
  readonly rawSummary: string | null;
}
```

Operacje — pełne sygnatury + pseudokod:

```ts
/** ADAPTACJA: surowy JSON dostawcy → RecipeRef. Jedyne miejsce znające nazwy pól Spoonaculara. */
export function fromProviderPayload(raw: Record<string, unknown>): RecipeRef | null;
//  1. waliduj id:number + title:string (dzisiejsze toCandidate, spoonacular.ts:54-72)
//  2. link      = safeHttpUrl(raw.sourceUrl) ?? safeHttpUrl(raw.spoonacularSourceUrl)   // FR-010
//  3. publisher = raw.sourceName ?? hostnameOf(safeHttpUrl(raw.sourceUrl))              // FR-010
//  4. imageUrl  = safeHttpUrl(raw.image)                                                // NFR obrazków
//  5. rawSummary= raw.summary ?? null
//  → null przy dryfie schematu (zachowanie z spoonacular.ts:51-53)

/** PERSYSTENCJA — zapis. Jedyne miejsce znające nazwę kolumny `spoonacular_id`. */
export function toPersistenceRow(ref: RecipeRef): { spoonacular_id: number; title: string; image: string | null };
//  FR-011: dokładnie trzy pola. Nigdy summary, nigdy sourceUrl.

/** PERSYSTENCJA — odczyt. Wiersz `recipes` → RecipeRef bez linku (baza go nie trzyma). */
export function fromPersistenceRow(row: { spoonacular_id: number; title: string; image: string | null }): RecipeRef;
//  link = null, publisher = null, rawSummary = null — FR-011 jest tu STRUKTURALNIE wymuszone.

/** Odczyt/zapis identyfikatora na granicy wire. */
export function refIdFromWire(value: unknown): RecipeRefId | null;   // dzisiejsze parseSpoonacularId
export function refIdToColumn(id: RecipeRefId): number;
```

**Kluczowa właściwość**: `fromPersistenceRow` *nie ma jak* zwrócić `rawSummary` ani
`link`. FR-011 przestaje być regułą pilnowaną przez recenzenta, a staje się
konsekwencją typu.

### 4.2 Wąski port

```ts
// src/lib/recipe-provider/port.ts
import type { RecipeRef, RecipeRefId } from "./recipe-reference";

export type ProviderFailure = "quota_exhausted" | "http_error" | "not_configured" | "network_error";
export type ProviderResult =
  | { ok: true; recipes: RecipeRef[] }
  | { ok: false; reason: ProviderFailure };

/** Dwie metody — cały kontrakt, jakiego potrzebuje FR-008. */
export interface RecipeProvider {
  /** Wyszukanie puli kandydatów przypiętej do kuchni (slot 3/4 + cold start). */
  searchByCuisine(cuisine: string, options: { count: number; offset: number }): Promise<ProviderResult>;
  /** Ponowne pobranie polubionego przepisu po id (slot 1/2 — FR-011 zabrania cache'owania opisu). */
  findById(id: RecipeRefId): Promise<ProviderResult>;
}
```

Zmiany wobec dzisiejszego kształtu, świadome:

- **`sort: "random"` i clamp offsetu znikają z sygnatury.** To decyzje o *tym
  dostawcy* (`spoonacular.ts:125-127`), nie o domenie. Wędrują do adaptera.
- **`QuotaInfo` znika z portu** (`spoonacular.ts:16-21`) — pojęcie „punktów" jest
  cennikiem Spoonaculara. Zostaje w adapterze; do domeny wraca tylko `quota_exhausted`.
- **`status: number`** (surowy kod HTTP dostawcy) znika z wyniku. Dziś jest niesiony
  przez trzy warstwy i po drodze jawnie porzucany —
  `src/pages/api/proposals.ts:17` mówi wprost: *"The status carried on the result is
  the raw provider status and never used here"*. Martwe pole.

### 4.3 Adapter

```ts
// src/lib/recipe-provider/spoonacular-adapter.ts
import { SPOONACULAR_API_KEY } from "astro:env/server";
// JEDYNY plik z tym importem, jedyny z BASE_URL, jedyny wołający fetch na api.spoonacular.com

const BASE_URL = "https://api.spoonacular.com";
const MAX_OFFSET_PROVIDER = 900;   // limit Spoonaculara (dziś spoonacular.ts:126)

export const spoonacularProvider: RecipeProvider = {
  searchByCuisine(cuisine, { count, offset }) {
    // GET /recipes/complexSearch?addRecipeInformation=true&sort=random&cuisine=…
    // includeNutrition / addRecipeNutrition NIGDY nie wysyłane (PRD Non-Goals)
    // → results.map(fromProviderPayload).filter(Boolean)
  },
  findById(id) { /* GET /recipes/{id}/information → [fromProviderPayload(body)] */ },
};
```

Zachowane bez zmian: klucz w query stringu nigdy nie logowany
(`spoonacular.ts:74-76,94-97`), parsowanie nagłówków `X-API-Quota-*`, mapowanie 402.

---

## KROK 5 — Dowód izolacji + before/after

### 5.1 Co dotyka wymiana dostawcy — PO refaktorze

Scenariusz: zamiana Spoonaculara na inne API przepisów.

| Element | Dziś | Po refaktorze |
|---|---|---|
| `src/lib/recipe-provider/spoonacular-adapter.ts` | — | **ZMIANA** (nowy plik adaptera) |
| `src/lib/recipe-provider/recipe-reference.ts` | — | **ZMIANA** — tylko `fromProviderPayload` |
| `src/lib/recipe-provider/port.ts` | — | bez zmian |
| `src/lib/proposals.ts` (silnik FR-008) | ZMIANA | **bez zmian** |
| `src/lib/history.ts` | ZMIANA | **bez zmian** |
| `src/pages/api/proposals.ts` | ZMIANA | **bez zmian** |
| `src/pages/api/ratings.ts` | ZMIANA | **bez zmian** |
| `src/components/proposals/**` | ZMIANA | **bez zmian** |
| `src/components/ratings/**` | ZMIANA | **bez zmian** |
| `supabase/migrations/**` (kolumna `spoonacular_id`) | ZMIANA | **bez zmian** — nazwa kolumny to historyczny artefakt, izolowany przez `toPersistenceRow` / `fromPersistenceRow` |

Nazwa kolumny zostaje celowo. Migracja zmieniająca nazwę to koszt bez korzyści, skoro
jedyne dwa miejsca, które ją czytają, to dwie funkcje ACL-a. Warunek: obcy identyfikator
musi pozostać liczbą całkowitą. Jeśli nowy dostawca ma id tekstowe, migracja typu jest
nieunikniona — i to jest jedyny scenariusz, w którym wymiana sięga bazy.

### 5.2 Before / after — duplikacje z KROKU 3

**D-1 — potrójna deklaracja kształtu**

*Before:* `spoonacular.ts:6-14` → `proposals.ts:13-16` (`extends`) →
`api/proposals.ts:33-49` (ręczna kopia) + `toPayload:51-70` (ręczne przepisanie).

*After:* jedna deklaracja `RecipeRef`. `ProposedRecipe` **komponuje zamiast dziedziczyć**:

```ts
export interface ProposedRecipe { ref: RecipeRef; requestedCuisine: string | null; excerpt: string | null; }
```

`ProposalPayload` przestaje być siedmiopolową kopią dostawcy i staje się kontraktem
produktu — `link` i `publisher` zamiast `sourceUrl` / `spoonacularSourceUrl` / `sourceName`.
**Trzy pola wire mniej.**

**D-2 — FR-010 w JSX**

*Before* (`RecipeCard.tsx:70-72`) — komponent rozstrzyga fallback licencyjny:

```tsx
const source = safeUrl(proposal.sourceUrl);
const link = source ?? safeUrl(proposal.spoonacularSourceUrl);
const credit = proposal.sourceName ?? source?.hostname.replace(/^www\./, "") ?? null;
```

*After* — komponent renderuje gotowe dane domenowe:

```tsx
{proposal.publisher && <span>by {proposal.publisher}</span>}
{proposal.link && <a href={proposal.link} target="_blank" rel="noopener noreferrer">View recipe</a>}
```

Warstwa UI dostaje **rozstrzygnięty wynik**, nie surowy obiekt dostawcy do interpretacji.
`safeUrl` znika z obu komponentów (`RecipeCard.tsx:4`, `RatedRecipesList.tsx:4`) — staje
się prywatnym helperem ACL-a. Reguła FR-010 przenosi się do miejsca pokrytego testem
jednostkowym, a nie do miejsca, które redesign przepisuje jako pierwsze.

**D-3 — pięciokrotne mapowanie `spoonacular_id`**

*Before:* `history.ts:58-61,85-89,109,156-162` + `api/ratings.ts:101-109,159-164`.
*After:* `toPersistenceRow` / `fromPersistenceRow` / `refIdFromWire` — trzy funkcje, jeden plik.

### 5.3 Rozstrzygnięcie otwartych pytań zależnych od kontraktu dostawcy

**Open Question 1** (`prd.md:144`) — *„czy 50 pkt/dobę wytrzyma?"*. Obie odpowiedzi są
teraz zmianami w ACL-u:

- **płatny tier ($29/mo, 1500 pkt/dobę)** → zmiana wyłącznie w adapterze; limit tkwi po
  stronie klucza API, nie kodu. **Zero plików domenowych.**
- **przekształcenie wywołań** (*„serving fewer cuisines per set"*) → decyzja o tym, ile
  wywołań składa się na zestaw, to dziś `Promise.all` z czterema pozycjami w
  `proposals.ts:383-388`. Ta decyzja jest **domenowa** (kompozycja slotów FR-008) i
  zostaje w `proposals.ts`; wiedza „ile punktów kosztuje jedno wywołanie" jest
  **dostawcy** i idzie do adaptera. Miejsce zakodowania decyzji: **adapter, nie
  `src/pages/api/proposals.ts`** — endpoint nie powinien znać cennika.

**Open Question 3** (`prd.md:146`) — *„jak niezawodnie `sourceUrl` wskazuje żywego
wydawcę?"*. Odpowiedź jest już zaimplementowana, tylko w złej warstwie: dzisiejszy
fallback `sourceUrl → spoonacularSourceUrl` (`RecipeCard.tsx:71`) to właśnie „graceful
error state", nie aktywny reachability check. **Decyzję zakodować w
`fromProviderPayload`**, nie w komponencie. Aktywne sprawdzanie osiągalności zostaje
poza zakresem (kosztowałoby żądanie HTTP na kartę); gdyby kiedyś weszło, to również
punkt w ACL-u.

---

## KROK 6 — Weryfikacja i plan

### 6.1 Kryterium sukcesu (mechaniczne)

```bash
grep -rn "spoonacular\|sourceUrl\|sourceName\|summary" src --include=*.ts --include=*.tsx -i
```

Musi zwrócić **wyłącznie** pliki z `src/lib/recipe-provider/`, plus dwa świadome wyjątki:

- `src/lib/config-status.ts:20-25` — nazwa dostawcy w komunikacie dla użytkownika
  (celowa, produktowa, nie jest sprzężeniem)
- `src/lib/sanitize-summary.ts` — jeśli w międzyczasie powstanie z równolegle
  planowanego refaktoru C4; przyjmuje `string`, nie zna dostawcy

Drugi grep, węższy — na identyfikator dostawcy w kodzie aplikacji:

```bash
grep -rln "spoonacular" src --include=*.ts --include=*.tsx -i
```

Oczekiwany wynik: `src/lib/recipe-provider/spoonacular-adapter.ts`,
`src/lib/recipe-provider/recipe-reference.ts`, `src/lib/config-status.ts`.

### 6.2 Pliki, które dziś znają zależność, a po refaktorze przestaną

| Plik | Dziś | Po |
|---|---|---|
| `src/lib/spoonacular.ts` | zna | **usunięty** → adapter |
| `src/lib/proposals.ts:1,13-16,254-260` | zna | nie zna (widzi `RecipeRef` + port) |
| `src/lib/history.ts:26-36,58-61,85-89,109,112-118,156-162` | zna | nie zna (`RecipeRefId`) |
| `src/lib/safe-url.ts` | zna pośrednio | wchłonięty do ACL-a |
| `src/pages/api/proposals.ts:33-49,51-70,186` | zna | nie zna |
| `src/pages/api/ratings.ts:32-64,101-109,159-164` | zna | nie zna |
| `src/components/proposals/types.ts` | zna | nie zna |
| `src/components/proposals/RecipeCard.tsx:51,67-73` | zna | nie zna |
| `src/components/ratings/types.ts` | zna | nie zna |
| `src/components/ratings/RatedRecipesList.tsx:59,63,67,103,132,151` | zna | nie zna |
| `src/lib/config-status.ts:20-25` | zna | **nadal zna — świadomie** (copy produktowe) |
| `astro.config.mjs:21` | zna | **nadal zna — świadomie** (nazwa sekretu) |
| `supabase/migrations/**` | zna | **nadal zna — świadomie** (nazwa kolumny) |

Bilans: **10 plików produkcyjnych przestaje znać dostawcę; 2 z nich znikają lub są wchłaniane.**

### 6.3 Fazy (konwencja `/10x-plan`)

Każda faza jest samodzielnie zielona: `npm run build` + `npm test` przechodzą na jej końcu.

**Faza 1 — powołanie ACL-a bez zrywania czegokolwiek.**
Utworzyć `src/lib/recipe-provider/` z `recipe-reference.ts`, `port.ts`,
`spoonacular-adapter.ts` (przeniesiona treść `src/lib/spoonacular.ts`), `index.ts`.
Stary `src/lib/spoonacular.ts` zostaje jako cienki re-eksport, więc żaden istniejący
import się nie psuje. Testy: `src/lib/__tests__/recipe-reference.test.ts` — mapowanie
FR-010 (fallback linku, fallback atrybucji z hostname), FR-011 (`toPersistenceRow`
zwraca dokładnie trzy pola), odrzucanie dryfu schematu.
*Weryfikacja:* `npm test` zielone, `src/lib/__tests__/spoonacular.test.ts` bez zmian i zielony.

**Faza 2 — domena za portem.**
`proposals.ts`: `ProposedRecipe extends RecipeCandidate` → kompozycja `{ ref, ... }`;
wywołania `searchRecipes` / `getRecipeById` → wstrzykiwany `RecipeProvider`.
`history.ts`: `spoonacularId: number` → `RecipeRefId`, mapowanie wierszy przez ACL.
*Weryfikacja:* `grep -n "spoonacular" src/lib/proposals.ts src/lib/history.ts` → pusto.
Wstrzykiwany port upraszcza przy okazji stubowanie w `src/lib/__tests__/proposals.test.ts`.

**Faza 3 — kontrakt wire w języku produktu.**
`ProposalPayload`: `sourceUrl` + `spoonacularSourceUrl` + `sourceName` → `link` + `publisher`;
`toPayload` czyta gotowe pola `RecipeRef`. `ratings.ts`: `spoonacularId` → `recipeId`,
`parseSpoonacularId` → `refIdFromWire`. **Zmiana łamiąca kontrakt HTTP** — musi wejść
w jednym commicie z Fazą 4.
*Weryfikacja:* `npm run build`; testy `src/pages/api/__tests__/*.test.ts` zaktualizowane.

**Faza 4 — UI dostaje dane domenowe.**
`RecipeCard.tsx:67-73` → dwa proste renderowania. Usunąć import `safe-url` z obu
komponentów. Body fetchy: `spoonacularId` → `recipeId`.
*Weryfikacja:* `npm run lint` (react-compiler) + `npm run build`; testy E2E w `e2e/`
przechodzą bez modyfikacji — kontrakt widoczny dla użytkownika się nie zmienia.

**Faza 5 — domknięcie.**
Usunąć `src/lib/spoonacular.ts` (shim) i `src/lib/safe-url.ts`. Uruchomić oba grepy
z §6.1. Zaktualizować `docs/reference/contract-surfaces.md` (9 wystąpień nazwy dostawcy)
oraz `context/map/repo-map.md`.
*Weryfikacja:* grep z §6.1 zwraca wyłącznie oczekiwaną listę; `npm test` + `npm run build` zielone.

**Poza zakresem:** zmiana nazwy kolumny `spoonacular_id` (§5.1), aktywny reachability
check linków (§5.3), wybór płatnego tieru (decyzja produktowa, Open Question 1),
wydzielenie `sanitizeSummary` (osobny, równolegle zaplanowany refaktor C4).
