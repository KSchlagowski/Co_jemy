# Raport architektoniczny — moduł 4 (ścieżka 10xArchitect)

**Data:** 2026-08-11 · **Autor:** KSchlagowski
**Wejścia:** L2 `context/map/repo-map.md` (2026-08-10) · L3 `context/changes/proposals-dataflow/research.md` (2026-08-10) · L4 `context/changes/refactor-opportunities/plan.md` · L5 `context/domain/01..03*.md` (2026-08-11)

## 1. Opisane projekty

Cały moduł przeszedł na **jednym repozytorium — `Co_jemy`**; żaden artefakt nie powstał na innym projekcie.

| Repo | Stack | Skala (orientacyjnie) | Artefakty |
|---|---|---|---|
| `Co_jemy` („Co jemy?" — personalizowany proponent przepisów) | Astro 6 (SSR) + React 19 + Tailwind 4 + Supabase (Postgres/RLS), deploy na Cloudflare Workers; przepisy z REST API Spoonacular (bez pakietu SDK — goły `fetch`) | Płaski monolit: 68 commitów w ~3 miesiące (23.05–10.08.2026), 1 kontrybutor-człowiek; rdzeń `lib/proposals.ts` 480 linii, `lib/history.ts` 185, `lib/spoonacular.ts` 141; 4 migracje SQL; 95 zależności importowych, 0 cykli | L2, L3, L4, L5 |

## 2. Mapa projektu (z L2)

1. **Jeden gorący rdzeń, złudne liczniki gita.** Praca skupia się na osi propozycji `lib/{proposals,spoonacular,history}.ts` → `api/proposals.ts` → `components/proposals/*` — dokładnie pętla produktu FR-003/FR-008. Surowe dotknięcia w gicie prowadzą do warstwy procesu (`context/`, `.claude/`), ale to ~2× zawyżenie przez przenosiny archiwum i generowany manifest; realni liderzy kodu to `src/pages/api` i `src/components/proposals`.
2. **Struktura czysta.** 0 cykli na 95 zależnościach; `lib → components/pages` ma 0 krawędzi; typy idą „w górę" wyłącznie type-only; `spoonacular.ts` importowany tylko przez `lib/proposals.ts` — granica providera szczelna.
3. **Strefy ryzyka:** `lib/supabase.ts` (najwyższy fan-in 12, zamrożony od 07-20 — najszerszy blast radius przy zmianie sygnatury) i `api/proposals.ts` (węzeł orkiestracji, fan-out 5, jedyny plik łączący klienta sesyjnego i service-role); osobno `lib/history.ts` — jedyne miejsce, gdzie zmiana logiki regularnie ciągnie migrację schematu (potwierdzone co-changem 2/4 commitów).
4. **Entry point i granica epok.** Ścieżka „pierwszego dnia": PRD → `CLAUDE.md` → `api/proposals.ts` (z tego pliku widać całą oś domenową naraz). Ostra granica 18.07.2026 — pivot retrievalu z AI-search na Spoonacular; wszystko sprzed pivotu w tym obszarze jest historycznie nieaktualne.
5. **Najważniejsze unknowns:** brak e2e głównej pętli produktu (US-01); `supabase/migrations`, `e2e/` i `context/` są poza grafem importów (dowody tylko z gita — „brak dowodu ≠ brak powiązań"); bus factor = 1.

## 3. Analiza ficzera (z L3)

**Co i dlaczego.** Przepływ propozycji end-to-end (`POST /api/proposals` → lib → Supabase/Spoonacular → UI), bo przecina naraz strefy ryzyka #1, #3 i #4 z mapy. Research (weryfikowany ast-grep 0.45.1) dodatkowo **skorygował mapę**: ryzyko #1 to świadoma decyzja (revoke insertu na `recipes` dla `authenticated` jest przyczyną istnienia klienta admina), a „orphan" `config-status.ts` żyje w `Layout.astro:4`.

**Feature overview.** Wejściem jest klik w `ProposalList` → `POST /api/proposals` bez body; tożsamość pochodzi wyłącznie z cookies sesji Supabase. Endpoint czyta historię ocen czterema równoległymi zapytaniami, wybiera tryb (cold_start / personalized) i deleguje reguły 4 slotów do czystego silnika `lib/proposals.ts`, który woła providera maksymalnie 4 razy na zestaw (0–2 by-id + 2 searche; domknięte strukturalnie — wszystkie 3 `Promise.all` w repo należą do tego przepływu). Stan zmienia się w dwóch zapisach: upsert `recipes` (service-role, tylko 3 pola FR-011) i insert zdarzeń `proposals` (klient sesyjny, RLS) — zapis jest best-effort, porażka daje `recorded:false` przy HTTP 200. Wraca koperta `{ok, mode, proposals, recorded, degraded}`; ocena z karty idzie do `POST /api/ratings`, a następne żądanie widzi ją już w odczytach historii.

**Technical debt (top 3):**

- **[potwierdzone ast-grepem] Luka testowa: `sanitizeSummary` — 0% pokrycia jedynej bariery compliance.** Dokładnie 1 call-site w repo (`lib/proposals.ts:258`), zero wywołań w testach, żaden test nie czyta `.excerpt` — funkcja mogłaby bezwarunkowo zwracać `null` przy zielonej suicie, a broni non-goala „no macro data" i NFR o markupie. To bezpośrednie wejście planu L4.
- **Kruche sprzężenie: szew koperty API↔klient.** Serwer nie deklaruje typu odpowiedzi 200 (literał w locie), klient ręcznie przepisuje pola koperty i rozszerza `reason` do `string` — dodanie powodu jest bezpieczne typowo, ale **zmiana nazwy powodu lub pola jest niewidoczna dla kompilatora** i broniona wyłącznie przez jeden test (`api/__tests__/proposals.test.ts`).
- **[potwierdzone ast-grepem] Blast radius reguły absolutnej: 4 z 5 funkcji `history.ts` bez testów.** FR-009 („👎 nigdy nie wraca" — jedyna absolutna reguła PRD) stoi na nietestowanym `getDislikedIds` i trzech nieograniczonych selectach (cichy cap PostgREST `max-rows` pozostaje unknown) — regresja przechodzi przy zielonym silniku.

## 4. Plan refaktoryzacji (z L4)

**Co:** wariant C4 — wyodrębnienie bariery compliance z silnika slotów. Blok ~175 linii (`proposals.ts:67-241`) przechodzi verbatim do `src/lib/sanitize-summary.ts` z **dokładnie jednym eksportem**; `proposals.ts` zostaje czystym silnikiem FR-008 z importem w jedynym szwie (`:258`); nowy test przypina gwarancje (makra, claims zdrowotne, backlink providera, encje, granice zdań). Pozycja #1 rankingu researchu refaktorów: najwyższy dług względem kosztu zmiany, a kolokacja jest wprost **przyczyną** zera pokrycia (test wymagałby fixture'ów silnika).

**Czego świadomie NIE robimy:** nie tykamy C1 (typowanie koperty) ani C3 (węzeł orkiestracji); nie poszerzamy wzorców filtrów (wymaga świeżych payloadów providera = wydaje kwotę); zero zmiany zachowania — defekt ujawniony przez testy staje się nazwanym follow-upem, nie poprawką; helpery zostają prywatne; bez zmian coverage/jsdom/CI.

**Fazy:**
- **F1 — Verbatim extraction:** czysty move bloku + import w szwie. *Auto:* `astro sync`/lint/build/test + grep na resztki symboli + **diff bajt-w-bajt przeniesionego fragmentu** (jedyny realny dowód — żaden test nie zobaczy zmanglowanego regexa). *Ręcznie:* diff czyta się jako move, jeden eksport, wskaźnik w `lessons.md` przestawiony na nowy plik.
- **F2 — Cover the barrier:** testy string-in/string-out bez fixture'ów silnika. *Auto:* lint/build/test, plik łapany przez istniejący glob bez zmian configu. *Ręcznie:* bez lustrzenia implementacji, bez asercji domykającej zbiór wzorców (rejestr lessons uznaje go za trwale niekompletny), spot-check realnego `summary`, każdy ujawniony defekt = nazwany follow-up.

## 5. Domena wg DDD (z L5)

**Ubiquitous language i rozjazdy model-vs-kod** (z 12 zidentyfikowanych R-01…R-12):

- **Zestaw propozycji** („do 4", sloty 1–4) — **nie istnieje jako typ**: limit w `slice`, wykluczenie FR-009 w dwóch niezależnych kopiach, rola slotu jako indeks tablicy (R-03).
- **Slot** (ostatnio lubiany / zapomniany ≥2 tyg. / nowy wg profilu / odkrycie) — **nieutrwalany w bazie**, więc Secondary Success Criterion jest niesprawdzalny po fakcie (R-04).
- **Profil smaku** — w PRD „inferred taste profile", w kodzie **jedna kuchnia** (`LIMIT 1`); drugi wymiar (`requested_type`) zawsze `null` (R-09).
- **Kuchnia zamówiona** — różnorodność jest własnością **żądania**, nie odpowiedzi (`cuisines[]` providera bywa puste); nietrywialna wiedza domenowa projektu.
- **Budżet punktów** — PRD nazywa go najciaśniejszym ograniczeniem, a `QuotaInfo` jest parsowane i **nigdy nieodczytane** (R-06). Osobno: `asDesigned` to pojęcie wprowadzone przez kod, nieobecne w PRD.

**Niezmiennik #1 i agregat:** **INV-PROPOSED-FIRST (I-2)** — *„ocena może istnieć wyłącznie dla przepisu, który aplikacja faktycznie zaproponowała temu użytkownikowi"* — należy do agregatu **`TasteProfile`** (root = `userId`; encje `ProposalEvent` i `Rating`, `RecipeRef` jako value object poza granicą). Wybrany z 11 niezmienników jako najbardziej rdzeniowy (krawędź `sees → rates` pętli sukcesu) i zarazem jedyny egzekwowany **nigdzie**: strażnikiem jest wyłącznie UI, FK celuje w globalny katalog, a dwa widoki SQL kompensują naruszenie przeciwstawnie (jeden premiuje je w slocie 2, drugi ukrywa w affinity). Naprawa: precondition w `rate()` + atomowe RPC + trigger-backstop w bazie; 8 faz, z twardą kolejnością backfill (F3) przed triggerem (F4).

**Anti-Corruption Layer:** przecieka **kontrakt danych Spoonaculara** — nie pakiet (nie ma go), lecz nazwy pól, reguła fallbacku FR-010 i identyfikator dostawcy — przez **6 warstw** (I/O, domena, API/wire, UI, SQL, config): 12 plików produkcyjnych + 4 migracje; licencyjne FR-010 mieszka dziś w JSX (`RecipeCard.tsx:70-72`). Supabase dla kontrastu jest już opanowany (3 pliki). Docelowo `src/lib/recipe-provider/` (VO `RecipeRef` + wąski port + adapter): po refaktorze wymiana dostawcy dotyka 2 plików ACL-a, a 10 plików produkcyjnych przestaje znać dostawcę.

## 6. Decyzje, które należą do mnie

AI dostarczało pomiary, diagnozy i rankingi — ale rozstrzygnięcia zostawały po mojej stronie. Narzędzia kilka razy się myliły i to ja kazałem im się nawzajem sprawdzać: plik uznany za martwy kod okazał się używany, a trzy „zerowe" wyniki ast-grepa były wadą wzorca, nie kodu — stąd moja zasada, że każde zero weryfikuję drugim narzędziem, zanim cokolwiek na nim oprę. Z rankingu refaktorów wybrałem wariant najmniejszy i w pełni odwracalny (wydzielenie bariery sanityzacji) i świadomie odmówiłem poszerzania filtrów, bo to wydaje realne pieniądze z limitu API. Przy niezmiennikach sam rozstrzygnąłem, który jest „numerem 1": ten, którego naprawa domyka trzy najsłabsze reguły naraz, zamiast leczenia objawów — i zaakceptowałem świadomy koszt, że zapis propozycji przestanie być „jakoś to będzie" i zacznie jawnie zgłaszać błąd, bo trwałość historii ocen jest jedyną rzeczą, której ten produkt nie przeżyje utracić. Decyzję o migracji starych ocen (dopisać im syntetyczne zdarzenia czy nie) też zostawiłem sobie, nie automatowi.
