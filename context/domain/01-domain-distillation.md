---
title: Destylacja domeny — Co jemy?
created: 2026-08-11
type: domain-distillation
---

# Destylacja domeny — „Co jemy?”

> Produkt tego dokumentu to **mapa domeny**, nie kod. Wszystkie pojęcia, agregaty i niezmienniki
> zostały odkryte z dokumentów źródłowych i z kodu; każde twierdzenie jest opatrzone cytatem
> `plik:linia`. Nic nie zostało dopisane „z domysłu” — brak pokrycia w kodzie jest oznaczony wprost.

## KROK 0 — Kontekst projektu

### Dokumenty źródłowe (odnalezione)

| Dokument | Rola | Uwaga |
|---|---|---|
| `context/foundation/prd.md` | Główne źródło wymagań: wizja, US-01/US-02, FR-001…FR-011, Business Logic, Non-Goals, Open Questions | Zawiera ślad rewizji („Superseded 2026-07-18” — pivot na Spoonacular), traktowany jako narracja zmian |
| `context/foundation/tech-stack.md` | Uzasadnienie stacku; zapis pivotu `has_ai → false` | |
| `context/foundation/lessons.md` | Rejestr powtarzalnych reguł/pułapek — 5 wpisów, wszystkie dotyczą reguł domenowych | Najcenniejszy materiał do KROKU 4 |
| `context/foundation/roadmap.md`, `context/changes/**`, `context/archive/**` | Historia zmian w plasterkach S-02…S-05 | Wykorzystane pomocniczo |
| `CLAUDE.md` | Twarde reguły projektu (limity Spoonacular, alias `@/`, Cloudflare SSR) | |
| `README.md` | Bootstrapowy opis stacku | Bez treści domenowej |

Ograniczenie nie występuje: dokumenty wymagań istnieją i są bogate, więc analiza nie musiała opierać
się wyłącznie na kodzie.

### Stack i struktura repo (zweryfikowane)

Astro 6 (SSR) + React 19 + Tailwind 4 + Supabase (Postgres), deploy na Cloudflare Workers.
Warstwy, w których faktycznie żyje logika:

| Warstwa | Lokalizacja | Co tam jest |
|---|---|---|
| Silnik reguł (czysty) | `src/lib/proposals.ts` (480 linii) | Reguły 4 slotów, dobór kuchni, sanityzacja opisu, wykluczenia |
| Odczyty historii | `src/lib/history.ts` (185 linii) | 5 zapytań do Supabase, mapowanie wiersz → kształt domenowy |
| Klient dostawcy | `src/lib/spoonacular.ts` (141 linii) | `complexSearch`, `information/{id}`, typowane błędy, parsowanie limitu |
| API (orkiestracja) | `src/pages/api/proposals.ts`, `src/pages/api/ratings.ts` | Autoryzacja, wybór trybu, mapowanie na HTTP, persystencja |
| Persystencja / polityki | `supabase/migrations/*.sql` (4 migracje) | Tabele `recipes`, `proposals`, `ratings`; widoki `liked_recipe_history`, `cuisine_affinity`; RLS |
| UI | `src/components/proposals/*`, `src/components/ratings/*` | Karta, ocena, lista ocenionych |
| Brama sesji | `src/middleware.ts` | `PROTECTED_ROUTES = ["/dashboard"]` (`src/middleware.ts:3`) — **nie** obejmuje `/api/**` |

**Obserwacja architektoniczna:** nie ma warstwy domenowej jako takiej. `src/lib/proposals.ts` jest
najbliżej modelu domenowego (czyste funkcje, zero I/O), ale operuje na strukturach danych, nie na
bytach z tożsamością i niezmiennikami. Persystencja i reguły są rozdzielone poprawnie; brakuje
warstwy, która spina je w agregat.

---

## KROK 1 — Ubiquitous Language

Każde pojęcie: definicja → cytat źródłowy → miejsce w kodzie.

### 1.1 Byty i pojęcia rdzeniowe

| Pojęcie | Definicja (z dokumentów) | Cytat źródłowy | Gdzie żyje w kodzie |
|---|---|---|---|
| **Proposal / Propozycja** | Pojedyncza sugestia przepisu z tytułem, krótkim opisem i linkiem do źródła zewnętrznego | `prd.md:76` (FR-003) | `src/lib/proposals.ts:13` (`ProposedRecipe`), `src/pages/api/proposals.ts:33` (`ProposalPayload`) |
| **Proposal set / Zestaw propozycji** | Uporządkowany zbiór **do 4** propozycji zwracany na jedno żądanie | `prd.md:115` „no more than 4 proposals per session”; `prd.md:101` (FR-008) | **Brak własnego typu.** Istnieje tylko wynik: `ProposalSetResult` (`src/lib/proposals.ts:20`), `PersonalizedSetResult` (`:35`); limit egzekwuje `SET_SIZE = 4` (`:59`) + `.slice(0, SET_SIZE)` (`:330`) |
| **Slot** | Rola propozycji w zestawie: 1 = ostatnio polubiony, 2 = polubiony, niewidziany ≥2 tyg., 3 = nowy pasujący do profilu, 4 = losowe odkrycie | `prd.md:101` (FR-008), `prd.md:34` | `src/lib/proposals.ts:25-33` (`SlottedRecipe.slot`), etykiety UI `src/components/proposals/ProposalList.tsx:13-18` |
| **Cold start** | Tryb dla użytkownika bez historii ocen: 4 sloty wypełnione losowo z różnorodnych kuchni | `prd.md:101`, US-02 `prd.md:54-62` | `src/lib/proposals.ts:302` (`buildColdStartSet`), przełącznik trybu `src/pages/api/proposals.ts:113` |
| **Rating / Ocena (👍/👎)** | Werdykt użytkownika o przepisie; podstawowy sygnał uczenia | `prd.md:87` (FR-004) | Tabela `public.ratings` (`supabase/migrations/20260808120000_rate_recipe.sql:13-22`), zapis `src/pages/api/ratings.ts:101-109` |
| **Verdict** | Wartość oceny: `like` \| `dislike` | `prd.md:87` | `src/pages/api/ratings.ts:4` (`RatingVerdict`), check w DB `…rate_recipe.sql:16` |
| **Rating history / Historia ocen** | Zbiór ocen użytkownika w czasie — dane, które **muszą** przetrwać sesje | `prd.md:36-38` (§Guardrails) | `src/lib/history.ts:46,72,98,133` (cztery odczyty) |
| **Taste profile / Profil smaku** | Wywnioskowana preferencja użytkownika, sterująca slotem 3 | `prd.md:34`, `prd.md:101` | Zredukowany do **jednej kuchni**: widok `public.cuisine_affinity` (`…personalized_proposal_slots.sql:48-61`), odczyt `src/lib/history.ts:171` (`getTopCuisine`) |
| **Requested cuisine / Kuchnia zamówiona** | Kuchnia, o którą aplikacja **poprosiła** w zapytaniu — nigdy `cuisines[]` z odpowiedzi | `prd.md:119` | `src/lib/proposals.ts:14` (`requestedCuisine`), kolumna `proposals.requested_cuisine` (`…cold_start_proposals.sql:26-27`) |
| **Discovery / Odkrycie** | Losowy „outlier” spoza profilu — slot 4 | `prd.md:115` | `src/lib/proposals.ts:448-449`, etykieta „Something new” (`ProposalList.tsx:17`) |
| **Exclusion (FR-009)** | Przepis oceniony 👎 **nigdy** nie pojawia się w propozycjach | `prd.md:104` (FR-009), AC `prd.md:49` | `src/lib/history.ts:98` (`getDislikedIds`) + filtry `src/lib/proposals.ts:316-328` i `:390-409` — **dwie niezależne implementacje** |
| **Stale like / Zapomniany faworyt** | Polubiony przepis nieproponowany od ≥2 tygodni | `prd.md:101`, `prd.md:115` | `SLOT2_STALE_DAYS = 14` (`src/lib/proposals.ts:53`), widok `liked_recipe_history` (`…personalized_proposal_slots.sql:28-40`), odczyt `src/lib/history.ts:72` |
| **Recipe reference** | Trwały ślad przepisu: **wyłącznie** `id`, `title`, `image` | `prd.md:82` (FR-011) | Tabela `public.recipes` (`…cold_start_proposals.sql:14-19`), zapis `src/pages/api/proposals.ts:185-188` |
| **Proposal event** | Zdarzenie „komu, co, kiedy i o jaką kuchnię poproszono” — dane własne aplikacji | `…cold_start_proposals.sql:10-12` | Tabela `public.proposals` (`:21-30`), insert `src/pages/api/proposals.ts:195-202` |
| **Excerpt / Krótki opis** | Oczyszczony z HTML i przycięty fragment opisu; nigdy nie zawiera makro ani backlinku dostawcy | `prd.md:126` (NFR), `prd.md:133` (Non-Goal) | `sanitizeSummary` (`src/lib/proposals.ts:211-241`), filtry `:73-85` |
| **Publisher credit (atrybucja)** | Nazwa wydawcy + link do jego strony; `sourceUrl` główny, `spoonacularSourceUrl` tylko awaryjnie | `prd.md:79` (FR-010), `prd.md:125` | `src/components/proposals/RecipeCard.tsx:70-72`, `safeUrl` (`src/lib/safe-url.ts:8`) |
| **Degraded set** | Zestaw zbudowany, ale niespełniający projektowanej reguły (np. jedna kuchnia zamiast dwóch) | Wyprowadzone z AC US-02 `prd.md:60` | `src/lib/proposals.ts:335-337`, flaga `degraded` w odpowiedzi `src/pages/api/proposals.ts:149` |
| **Quota / Budżet punktów** | 50 pkt/dobę; koszt zdominowany przez **liczbę wywołań**, nie liczbę wyników | `prd.md:121`, `CLAUDE.md` §Conventions | `QuotaInfo` (`src/lib/spoonacular.ts:17-21`), `parseQuota` (`:39-49`) — **parsowane, ale przez nikogo nieużywane** (patrz KROK 4, R-06) |
| **asDesigned** | Czy slot został wypełniony własną regułą, czy „załatany” z puli | Brak w PRD — pojęcie **wprowadzone przez kod** | `src/lib/proposals.ts:25-33,453` |

### 1.2 Pojęcia obecne w dokumentach, BRAK w kodzie

| Pojęcie | Cytat | Status |
|---|---|---|
| **„sufficient rating history”** (próg aktywacji slotów) | `prd.md:101` | W kodzie zmaterializowane jako trzy stałe: `SLOT1_MIN_LIKES=1`, `SLOT2_STALE_DAYS=14`, `SLOT3_MIN_LIKES=5` (`src/lib/proposals.ts:51-55`) — wartości **decyzją planu S-05**, nie PRD. Sam PRD progu nie podaje. |
| **„brief description”** jako część kontraktu propozycji | `prd.md:76` | Opcjonalny: `excerpt` bywa `null` (`src/lib/proposals.ts:233-235` zwraca `null`, gdy klauzula < 40 znaków). Karta renderuje się bez opisu (`RecipeCard.tsx:101`). Wymaganie mówi „includes”, kod dopuszcza brak. |
| **Usunięcie danych po utracie dostępu do API** | `prd.md:26` | **BRAK w kodzie** — nie ma ścieżki kasowania `recipes`; jedyne co istnieje, to rozdział tabel, który ją umożliwia. |
| **Podział na wiele wymiarów profilu smaku** („inferred taste profile”) | `prd.md:34` | Sprowadzony do jednego wymiaru (kuchnia). Kolumna `requested_type` istnieje, ale jest zawsze `null` (`src/pages/api/proposals.ts:200`, `…cold_start_proposals.sql:27-28`). |

---

## KROK 2 — Klasyfikacja subdomen

Kryterium rdzenia: „to, co stanowi przewagę i sens produktu”, czyli — wg `prd.md:14` — **adaptacja do
tego, co użytkownik faktycznie ugotował i polubił**, oraz **redukcja zbioru wyboru do garstki**.

| Obszar | Kategoria | Uzasadnienie (z odwołaniem do celów) |
|---|---|---|
| **Klasyfikacja 4-slotowa** (reguły slotów, aktywacja progowa, backfill) | **CORE** | To jest „the rule the app applies” (`prd.md:127`) i jednocześnie Secondary Success Criterion (`prd.md:34`). Bez tego produkt jest wyszukiwarką. |
| **Historia ocen jako sygnał uczenia** (👍/👎 → wpływ na kolejne zestawy) | **CORE** | Primary Success Criterion: „future proposals are observably influenced by that rating history” (`prd.md:31`). Guardrail `prd.md:38` chroni właśnie ten byt. |
| **Wykluczenie 👎 (FR-009)** | **CORE** | Jedyna **absolutna** reguła produktu: „permanently excludes” (`prd.md:104`). Naruszenie jest natychmiast widoczne dla użytkownika i podważa zaufanie do całej pętli. |
| **Profil smaku / affinity kuchni** | **CORE** | Zasila slot 3 = „growth” (`prd.md:115`). Jest to wnioskowanie, którego nie ma w żadnym generycznym narzędziu — czyli dokładnie luka personalizacyjna z `prd.md:14`. |
| **Różnorodność kuchni po stronie żądania** | **CORE (wąsko)** | Nietrywialna decyzja modelowa opisana w Business Logic (`prd.md:119`): różnorodność jest własnością **zamówienia**, nie odpowiedzi. To wiedza domenowa, której nie da się kupić. |
| **Sanityzacja opisu (excerpt) — cięcie przed makro i backlinkiem** | **SUPPORTING** | Nie jest przewagą, ale jest wymuszone przez Non-Goal `prd.md:133` i NFR `prd.md:126`. Musi być własne, bo reguła cięcia jest specyficzna dla tego produktu. |
| **Atrybucja wydawcy (FR-010)** | **SUPPORTING** | Warunek licencyjny (`prd.md:79-80`), nie źródło wartości. Ale nieusuwalny — „omitting it is a licence breach”. |
| **Ograniczenie zakresu przechowywanych pól (FR-011)** | **SUPPORTING** | Kształtuje schemat (`prd.md:82`), ale nie tworzy wartości dla użytkownika. Kontraktowy przymus. |
| **Zarządzanie budżetem punktów Spoonacular** | **SUPPORTING** | Open Question 1 (`prd.md:143`) — „the tightest constraint the pivot introduced”. Nie jest rdzeniem, ale jego brak potrafi wyłączyć rdzeń. |
| **Pobieranie przepisów z Spoonacular** | **GENERIC** | Zwykłe wywołanie REST (`prd.md:76`); wymienne na innego dostawcę. |
| **Uwierzytelnianie e-mail/hasło** | **GENERIC** | FR-001/002 (`prd.md:68-71`) — Supabase Auth out of the box; `tech-stack.md` wybiera stack właśnie po to, by tego nie pisać. |
| **CRUD ocen (lista, zmiana, usunięcie)** | **GENERIC** | FR-005/006/007 (`prd.md:90-96`) — sam PRD opisuje je jako „CRUD read/update”. Wartość leży w tym, **co** ocena robi, nie w formularzu. |
| **Renderowanie kart, obrazki, fallbacki** | **GENERIC** | NFR `prd.md:124-125`; standardowa higiena UI. |

**Wniosek klasyfikacyjny:** rdzeń to jeden spójny obszar — *złożenie zestawu propozycji z historii
ocen*. Wszystko inne jest albo przymusem kontraktowym dostawcy, albo infrastrukturą.

---

## KROK 3 — Kandydaci na agregaty i ich niezmienniki

Legenda statusu: **EGZEKWUJE** (kod uniemożliwia naruszenie) · **DEKLARUJE** (kod opisuje regułę
w komentarzu/typie, ale nie blokuje naruszenia) · **IGNORUJE** (brak jakiejkolwiek realizacji).

### A. `ProposalSet` — Zestaw propozycji *(kandydat na agregat rdzeniowy)*

Tożsamość: (użytkownik, moment żądania). Encje wewnętrzne: 4 × `Proposal` ze slotem.

| # | Niezmiennik | Cytat | Status w kodzie | Dowód |
|---|---|---|---|---|
| A-1 | Zestaw liczy **najwyżej 4** propozycje | `prd.md:115` „no more than 4 proposals per session” | **EGZEKWUJE** (cold start), **EGZEKWUJE strukturalnie** (personalized: tablica 4-elementowa) | `src/lib/proposals.ts:330`; `:412` |
| A-2 | Żaden przepis oceniony 👎 nie trafia do żadnego slotu | `prd.md:104` (FR-009) | **EGZEKWUJE, ale w dwóch kopiach i warunkowo** — filtr aplikacyjny, zależny od kompletności odczytu | `src/lib/proposals.ts:316-328` (cold), `:390-409` (personalized); odczyt `src/lib/history.ts:98-110` |
| A-3 | Żaden przepis nie powtarza się w zestawie | Wyprowadzone z sensu zestawu; brak zdania wprost w PRD | **EGZEKWUJE** — `Set` `used`/`seen` | `src/lib/proposals.ts:266-267,411,415-421` |
| A-4 | Zestaw cold-start obejmuje ≥2 kuchnie | `prd.md:60` (AC US-02) | **DEKLARUJE** — mierzy i raportuje `degraded`, ale zestaw jednokuchniowy i tak jest zwracany | `src/lib/proposals.ts:335-337` |
| A-5 | Każda karta ma działający link zewnętrzny | `prd.md:51` (AC US-01) | **DEKLARUJE** — link renderowany warunkowo; brak `sourceUrl` i `spoonacularSourceUrl` → karta bez linku | `src/components/proposals/RecipeCard.tsx:71-72,105` |
| A-6 | Slot 2 ≠ slot 1 (ten sam polubiony przepis nie zajmuje obu) | `prd.md:101` (dwie różne role) | **EGZEKWUJE** | `src/lib/proposals.ts:373` |
| A-7 | Kuchnia slotu 4 różni się od kuchni slotu 3 | `prd.md:115` („discovery … outlier”) | **EGZEKWUJE** | `src/lib/proposals.ts:378-380` + `pickCuisinePair` `:244-248` |
| A-8 | Polubiony przepis nie może udawać „nowego” w slocie 3/4 | Wyprowadzone z FR-008 (slot 3 = „new recipe”) | **EGZEKWUJE** | `src/lib/proposals.ts:390-396` (`ratedIds` obejmuje też polubienia) |

### B. `RatingHistory` — Historia ocen użytkownika *(kandydat na agregat rdzeniowy)*

Tożsamość: `user_id`. Encje: `Rating` (klucz `user_id + spoonacular_id`).

| # | Niezmiennik | Cytat | Status | Dowód |
|---|---|---|---|---|
| B-1 | Jedna ocena na parę (użytkownik, przepis) | `prd.md:93` (FR-006 — zmiana, nie druga ocena) | **EGZEKWUJE** — klucz główny + `onConflict` | `…rate_recipe.sql:21`; `src/pages/api/ratings.ts:108` |
| B-2 | Werdykt należy do zbioru {like, dislike} | `prd.md:87` | **EGZEKWUJE** dwukrotnie (DB check + walidacja wejścia) | `…rate_recipe.sql:16`; `src/pages/api/ratings.ts:52-54` |
| B-3 | Historia ocen musi przetrwać sesje — jej utrata niszczy produkt | `prd.md:36-38` (§Guardrails) | **EGZEKWUJE** — zapis nietolerancyjny: błąd zapisu = błąd żądania, UI nie pokazuje niezapisanej oceny | `src/pages/api/ratings.ts:111-113`; `RecipeCard.tsx:26-32,54` (brak optymistycznego stanu) |
| B-4 | Ocena należy do zalogowanego użytkownika; tożsamość pochodzi z sesji, nie z ciała żądania | `prd.md:137` (Access Control) | **EGZEKWUJE** — `user.id` z sesji + RLS | `src/pages/api/ratings.ts:99-103,158-163`; polityki `…rate_recipe.sql:38-49` |
| B-5 | Usunięcie oceny przywraca przepis do stanu „nieoceniony” (kasuje też wykluczenie FR-009) | `prd.md:96` (FR-007) | **EGZEKWUJE** — widoki i odczyty wyprowadzają się z `ratings`, więc kasowanie wiersza znosi wykluczenie | `src/pages/api/ratings.ts:159-164`; `…manage_rated_recipes.sql:21-25` |
| B-6 | Ocenić można tylko przepis, który był użytkownikowi zaproponowany | **Brak zdania w PRD** — implikowane przez pętlę „propozycja → klik → ocena” (`prd.md:31`) | **IGNORUJE** — jedyny warunek to istnienie wiersza w współdzielonym katalogu `recipes` | `src/pages/api/ratings.ts:101-113` (brak sprawdzenia `proposals`); przyznane wprost w komentarzu migracji: „the ratings endpoint has no ownership check” (`…personalized_proposal_slots.sql:26-27`) |

### C. `RecipeReference` — Referencja przepisu *(agregat kontraktowy)*

Tożsamość: `spoonacular_id`.

| # | Niezmiennik | Cytat | Status | Dowód |
|---|---|---|---|---|
| C-1 | Trwale przechowywane są **wyłącznie** `id`, `title`, `image` | `prd.md:82` (FR-011) | **EGZEKWUJE słabo** — literałem obiektu w jednym miejscu zapisu; brak typu zawężającego na granicy i brak ograniczenia w DB poza kształtem tabeli | `src/pages/api/proposals.ts:185-188`; tabela `…cold_start_proposals.sql:14-19`; otwarta reguła: `lessons.md:35-38` |
| C-2 | Dane pochodne od dostawcy są odseparowane od danych własnych użytkownika (możliwość czystki) | `prd.md:26` | **EGZEKWUJE strukturalnie** (rozdział tabel), **IGNORUJE operacyjnie** (brak ścieżki czystki) | `…cold_start_proposals.sql:4-12`; brak jakiegokolwiek kodu kasującego `recipes` |
| C-3 | Zapisy do katalogu idą wyłącznie ścieżką serwerową (service-role), nie kluczem anon | `lessons.md:14-17` (lekcja 2) | **EGZEKWUJE** | `…manage_rated_recipes.sql:28-29` (odebrany insert); `src/pages/api/proposals.ts:176-183` |

### D. `RecipeExcerpt` — Fragment opisu *(Value Object, agregat wspierający)*

| # | Niezmiennik | Cytat | Status | Dowód |
|---|---|---|---|---|
| D-1 | Excerpt nigdy nie zawiera danych makro/kalorycznych ani twierdzeń zdrowotnych | `prd.md:133` (Non-Goal) | **DEKLARUJE, świadomie niekompletnie** — zbiór wzorców wyliczony z próbek, nie ze schematu; nowe sformułowanie przechodzi po cichu | `src/lib/proposals.ts:73-85` (komentarz mówi wprost: „known incomplete”); reguła: `lessons.md:21-24` |
| D-2 | Excerpt nie zawiera znaczników HTML ani obcych kotwic | `prd.md:126` (NFR) | **EGZEKWUJE** | `src/lib/proposals.ts:216-219` (strip tagów), `:85` (cięcie wzmianki o dostawcy) |
| D-3 | Excerpt nigdy nie jest kikutem („This recipe serves 4 and has…”) | Brak w PRD — reguła jakościowa wprowadzona przez kod | **EGZEKWUJE** | `src/lib/proposals.ts:183-194,233-236` (`MIN_EXCERPT = 40`) |

### E. `QuotaBudget` — Budżet punktów dostawcy *(kandydat na agregat, dziś nieistniejący)*

| # | Niezmiennik | Cytat | Status | Dowód |
|---|---|---|---|---|
| E-1 | Zestaw propozycji kosztuje ograniczoną, znaną liczbę wywołań (2 wyszukania + ≤2 by-id) | `prd.md:121`; `CLAUDE.md` §Conventions | **EGZEKWUJE strukturalnie** — kształt wachlarza jest zaszyty w kodzie i udokumentowany | `src/lib/proposals.ts:57-58,306-309,383-388` |
| E-2 | Aplikacja wie, ile budżetu zostało, i zachowuje się inaczej przy jego wyczerpaniu | `prd.md:143` (Open Question 1) | **IGNORUJE** — `QuotaInfo` jest parsowane z nagłówków i przenoszone w wyniku, ale **żaden konsument go nie odczytuje**; jedyną reakcją jest HTTP 402 po fakcie | parsowanie `src/lib/spoonacular.ts:39-49,99`; brak odczytu `quota` w `src/lib/proposals.ts` i `src/pages/api/proposals.ts`; mapowanie 402 `src/pages/api/proposals.ts:19` |

---

## KROK 4 — Rozjazdy MODEL vs KOD

Uporządkowane wg dotkliwości. To najcenniejsza część mapy: pokazuje, gdzie wiedza domenowa istnieje
w dokumentach, ale kod jej nie odwzorowuje.

| # | Dokument mówi X | Kod robi Y | Dowód |
|---|---|---|---|
| **R-01** | FR-009: 👎 wyklucza przepis **na stałe** — to jedyna absolutna reguła produktu (`prd.md:104`) | Wykluczenie jest **filtrem aplikacyjnym powielonym w dwóch ścieżkach**, zasilanym z odczytu, który PostgREST po cichu ucina na `max-rows` (domyślnie 1000). Reguła nie jest wyrażona ani w jednym miejscu, ani w bazie. | filtry: `src/lib/proposals.ts:316-328` i `:390-409`; odczyt bez `.limit()`: `src/lib/history.ts:98-110`; ryzyko opisane: `lessons.md:28-31` |
| **R-02** | Pętla produktu to „propozycja → klik → **powrót i ocena**” (`prd.md:31`) | Endpoint ocen nie sprawdza, czy przepis był danemu użytkownikowi zaproponowany — wystarczy dowolny `spoonacular_id` obecny w współdzielonym katalogu. Ocena jest tym samym oderwana od zdarzenia propozycji. | `src/pages/api/ratings.ts:101-113`; przyznane wprost: `…personalized_proposal_slots.sql:26-27` |
| **R-03** | „Zestaw propozycji” jest bytem domenowym o własnych regułach (`prd.md:115`, FR-008) | Nie istnieje jako obiekt. Reguły są rozsypane: limit 4 w `slice` (`:330`) i długości tablicy (`:412`), wykluczenie w dwóch filtrach, kolejność slotów w indeksach tablicy, werdykt do prezentacji doklejany dopiero w endpoincie. Dwie funkcje budujące (`buildColdStartSet`, `buildPersonalizedSet`) niezależnie reimplementują wykluczanie, dedup i pobieranie kuchni. | `src/lib/proposals.ts:302-338` vs `:368-480`; złożenie `src/pages/api/proposals.ts:113-140` |
| **R-04** | „Slot 1 = ostatnio polubiony, slot 2 = zapomniany faworyt…” — klasyfikacja jest sensem produktu (`prd.md:34`) | Przypisanie slotu **nie jest utrwalane**. Tabela `proposals` zapisuje `user_id`, `spoonacular_id`, `requested_cuisine`, `proposed_at` — bez slotu i bez `asDesigned`. Nie da się po fakcie zweryfikować Secondary Success Criterion („the 4-slot proposal logic works correctly”), bo dane o tym, w jakiej roli przepis został pokazany, giną z odpowiedzią HTTP. | `…cold_start_proposals.sql:21-30`; insert `src/pages/api/proposals.ts:195-202`; slot istnieje tylko w pamięci: `src/lib/proposals.ts:465` |
| **R-05** | Non-Goal: „no macro or nutritional data … the app makes no health claims” (`prd.md:133`) | Granica egzekwowana wyliczonym zbiorem wyrażeń regularnych nad obcą prozą. Kod sam deklaruje niekompletność; nowa fraza dostawcy przechodzi bez sygnału. Zabezpieczenie jest wykrywające, nie zapobiegawcze. | `src/lib/proposals.ts:73-85` (komentarz „known incomplete”); reguła: `lessons.md:21-24` |
| **R-06** | Kwota 50 pkt/dobę to „the tightest constraint the pivot introduced”, mierzenie jej to najcenniejszy wynik spike'u (`prd.md:143`) | `QuotaInfo` jest parsowane (`spoonacular.ts:39-49`), dołączane do wyniku (`:99,102,105,114`) — i **nigdy nieodczytane**. Nie ma licznika, progu ostrzegawczego ani degradacji przy niskim stanie. Aplikacja dowiaduje się o wyczerpaniu dopiero z HTTP 402. | `src/lib/spoonacular.ts:17-21,39-49`; brak jakiegokolwiek użycia `.quota` poza tym plikiem |
| **R-07** | FR-011: przechowywane są **tylko** trzy pola; naruszenie to złamanie umowy z dostawcą, nie bug (`prd.md:82`) | Jedyną barierą jest kształt literału w jednym wywołaniu `upsert`. Brak nazwanego typu zawężającego na granicy zapisu — czyli dokładnie stan, przed którym ostrzega własny rejestr lekcji. | `src/pages/api/proposals.ts:185-188`; otwarta reguła: `lessons.md:35-38` |
| **R-08** | „Jeśli dostęp do API ustanie, wszystkie dane z niego uzyskane muszą zostać usunięte” — dlatego tabele są rozdzielone (`prd.md:26`) | Rozdział tabel istnieje, ale **operacji czystki nie ma**. Zdolność, dla której poniesiono koszt modelowania, nie została zrealizowana. | `…cold_start_proposals.sql:4-12`; brak kodu/migracji kasujących `recipes` |
| **R-09** | „Inferred taste profile” — profil smaku jako wnioskowana charakterystyka (`prd.md:34,101`) | Profil to **jedna kuchnia**: `ORDER BY like_events DESC, last_event_at DESC LIMIT 1`. Drugi wymiar (`requested_type`) jest zadeklarowany w schemacie i zawsze `null`. Slot 3 aktywuje się dopiero przy 5 polubieniach — próg pochodzi z planu S-05, nie z PRD. | widok `…personalized_proposal_slots.sql:48-61`; `src/lib/history.ts:171-185`; `SLOT3_MIN_LIKES` `src/lib/proposals.ts:55`; `requested_type: null` `src/pages/api/proposals.ts:200` |
| **R-10** | AC US-02: „Cold-start proposals span at least 2 different cuisine types” (`prd.md:60`) | Kryterium jest **mierzone i raportowane** (`degraded`), ale nie wymuszane: zestaw jednokuchniowy jest zwracany jako `ok: true`. Świadomy kompromis (lepsze niż ekran błędu), ale to znaczy, że AC nie jest niezmiennikiem, tylko metryką. | `src/lib/proposals.ts:335-337`; `src/pages/api/proposals.ts:149` |
| **R-11** | FR-003: propozycja zawiera tytuł, **krótki opis** i link (`prd.md:76`) | `excerpt` bywa `null` (gdy po ucięciu zostaje mniej niż 40 znaków), a link renderuje się warunkowo. Trzyczęściowy kontrakt propozycji nie jest nigdzie egzekwowany jako całość. | `src/lib/proposals.ts:233-235`; `RecipeCard.tsx:71-72,101,105` |
| **R-12** | Access Control: „Unauthenticated users cannot access proposals, ratings, or any personalized content” (`prd.md:137`) | Middleware chroni tylko `/dashboard`; każdy endpoint `/api/**` sam powtarza własną bramkę. Reguła dostępu jest zduplikowana w kodzie, a nie wyrażona raz. Dziś działa poprawnie — ale nowy endpoint domyślnie jest publiczny. | `src/middleware.ts:3,17-21`; powtórzone bramki `src/pages/api/proposals.ts:95-98`, `src/pages/api/ratings.ts:78-81,137-140` |

---

## KROK 5 — Ranking refaktoru

Ocena dwuwymiarowa: **wartość** (jak rdzeniowy jest niezmiennik dla sensu produktu) × **ryzyko**
(jak słabo jest dziś egzekwowany).

| Poz. | Kandydat na agregat | Wartość | Ryzyko | Kluczowy rozjazd | Uzasadnienie |
|---|---|---|---|---|---|
| **#1** | **`ProposalSet`** | Bardzo wysoka | Wysokie | R-01, R-03, R-04, R-10 | Skupia cztery niezmienniki rdzeniowe naraz (≤4, wykluczenie 👎, brak duplikatów, różnorodność), a wszystkie są rozproszone po dwóch funkcjach, endpoincie i indeksach tablicy. Wykluczenie FR-009 istnieje w **dwóch niezależnych kopiach** — klasyczna sytuacja, w której poprawka trafi do jednej. |
| **#2** | **`RatingHistory`** | Bardzo wysoka | Średnio-wysokie | R-02, R-01 (odczyt) | Guardrail PRD chroni właśnie ten byt i persystencja jest zrobiona solidnie (B-1…B-5 egzekwowane). Ale brakuje niezmiennika B-6: ocena jest oderwana od zdarzenia propozycji, więc agregat nie kontroluje własnej granicy. |
| **#3** | **`QuotaBudget`** | Średnia | Bardzo wysokie | R-06 | Byt nie istnieje wcale, mimo że PRD nazywa go najciaśniejszym ograniczeniem projektu, a dane do jego zbudowania są już pobierane i wyrzucane. Najtańszy refaktor o największym stosunku efektu do kosztu — ale wspierający, nie rdzeniowy. |
| **#4** | **`RecipeReference`** | Średnia | Średnie | R-07, R-08 | Ryzyko jest kontraktowe (dostawca), nie funkcjonalne. Naprawa to typ zawężający na granicy zapisu + ścieżka czystki; obie zmiany są małe i lokalne. |
| **#5** | **`RecipeExcerpt`** | Niska | Wysokie, ale ograniczone | R-05 | Ryzyko jest realne i udokumentowane, lecz to Value Object bez tożsamości. Refaktor „na agregat” nic tu nie da — potrzebne jest poszerzanie filtrów i telemetria trafień, nie zmiana modelu. |

### #1 do refaktoru: `ProposalSet`

**Dlaczego właśnie ten.** Zestaw propozycji to jedyne miejsce, gdzie spotykają się wszystkie
niezmienniki rdzeniowe produktu — a jest to jedyny byt rdzeniowy, który **nie ma reprezentacji
w kodzie**. Konsekwencje są mierzalne:

1. **Reguła absolutna jest zduplikowana.** FR-009 („permanently excludes”, `prd.md:104`) ma dwie
   implementacje: `src/lib/proposals.ts:316-328` dla cold startu i `:390-409` dla trybu
   personalizowanego. Każda przyszła zmiana semantyki wykluczenia musi trafić w oba miejsca; nic
   w kodzie tego nie wymusza.
2. **Niezmienniki są wyrażone przez pozycję w tablicy.** Rola slotu żyje jako indeks `filled[0..3]`
   (`:412-460`), a nie jako pojęcie. Reguła „slot 2 to inny przepis niż slot 1” to pojedyncze
   `.find()` (`:373`) — poprawne, ale nieodróżnialne od przypadkowej optymalizacji.
3. **Zestaw nie potrafi opowiedzieć o sobie po fakcie.** Slot i `asDesigned` nie są utrwalane
   (`…cold_start_proposals.sql:21-30`), więc Secondary Success Criterion (`prd.md:34`) jest
   niesprawdzalny na danych produkcyjnych.
4. **Granica agregatu jest przecięta.** `ratingVerdict` — atrybut prezentacyjny propozycji — jest
   doklejany dopiero w endpoincie (`src/pages/api/proposals.ts:126-129`), a decyzja o trybie
   (cold start vs personalized) zapada poza silnikiem reguł (`:113`). Silnik nie kontroluje więc
   ani wejścia, ani wyjścia własnej reguły.

**Kierunek (bez pisania kodu):** wprowadzić jeden byt, który przyjmuje historię ocen i pulę
kandydatów, sam decyduje o trybie, sam stosuje wykluczenie w **jednym** miejscu i zwraca zestaw,
którego nie da się skonstruować w stanie naruszającym A-1…A-3. Utrwalanie slotu i `asDesigned`
w tabeli `proposals` domyka pętlę weryfikacji — i przy okazji daje `RatingHistory` brakujący
niezmiennik B-6 (ocena może dotyczyć wyłącznie przepisu, który był użytkownikowi zaproponowany),
czyli rozwiązuje jednocześnie rozjazd #2 z rankingu.

---

## Załącznik: dowody zweryfikowane bezpośrednio

Wszystkie ścieżki i numery linii w tym dokumencie pochodzą z odczytu następujących plików w całości
lub w cytowanych zakresach: `context/foundation/prd.md`, `context/foundation/tech-stack.md`,
`context/foundation/lessons.md`, `CLAUDE.md`, `src/lib/proposals.ts`, `src/lib/history.ts`,
`src/lib/spoonacular.ts`, `src/lib/safe-url.ts`, `src/middleware.ts`, `src/pages/api/proposals.ts`,
`src/pages/api/ratings.ts`, `src/components/proposals/RecipeCard.tsx`,
`src/components/proposals/RatingButton.tsx`, `src/components/proposals/ProposalList.tsx`,
`src/components/ratings/RatedRecipesList.tsx`, `src/pages/dashboard.astro` oraz cztery migracje
w `supabase/migrations/`.
