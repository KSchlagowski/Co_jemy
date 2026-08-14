---
date: 2026-08-11T00:00:00+02:00
researcher: KSchlagowski
git_commit: 5a8362188da9c6ec5715db54251a40b394be77ea
branch: master
repository: Co_jemy
topic: "Kandydaci do refaktoryzacji: obecny kształt, intencjonalność, wykonalność migracji"
tags: [research, refactor, technical-debt, contract-seam, compliance, orchestration, verified]
status: complete
last_updated: 2026-08-11
last_updated_by: KSchlagowski
verification_commit: 5a8362188da9c6ec5715db54251a40b394be77ea
verification_method: ast-grep 0.45.1 (pattern + rule kind), cross-checked with grep
inputs: ["context/changes/proposals-dataflow/research.md", "context/map/repo-map.md", "context/foundation/lessons.md"]
---

# Research: refactor opportunities

**Data**: 2026-08-11 · **Researcher**: KSchlagowski
**Git commit**: `5a83621` · **Branch**: `master` · **Repo**: Co_jemy

## Pytanie badawcze

Na bazie `context/changes/proposals-dataflow/research.md` (traktowanego jako zebrane dowody, nie do wyprowadzania na nowo): wypisać każdy odnotowany problem, oddzielić kandydatów do refaktoryzacji (naprawa zmienia strukturę kodu) od reszty, zbadać każdego kandydata pod kątem obecnego kształtu, intencjonalności i wykonalności migracji, i zamknąć rankingiem 2–3 najmocniejszych.

Metoda: trzy równoległe sub-agenty w trybie read-only (obecny kształt / archeologia gita i dokumentów / wykonalność migracji + CI). Priory przeczytane w kontekście głównym: `proposals-dataflow/research.md`, `context/map/repo-map.md`, `context/foundation/lessons.md`, `context/changes/refactor-opportunities/change.md`.

**Żadnych zmian w kodzie nie wprowadzono.**

---

## 1. Inwentarz problemów i klasyfikacja

### 1.1 Kandydaci (naprawa zmienia strukturę kodu)

| # | Problem | Źródło w raporcie |
|---|---|---|
| C1 | Koperta odpowiedzi 200 bez deklaracji po stronie serwera; `ProposalsResponse` przepisany ręcznie w kliencie; `reason` rozszerzony do `string` | §1.7 |
| C2 | Brak generowanych typów bazy — nazwy tabel/widoków/kolumn jako gołe literały; do tego 3 nieograniczone selecty | D-7, §3 |
| C3 | `api/proposals.ts` jako węzeł orkiestracji — auth, klienty, fan-out, dispatch, mapowanie statusów, mapowanie payloadu, `persist` z dwoma klientami, koperta błędu w jednym pliku | §1.5, D-10, repo-map #1 |
| C4 | `sanitizeSummary` + stałe compliance mieszkają wewnątrz silnika slotów `lib/proposals.ts` | D-1 (aspekt strukturalny) |
| C5 | `parseQuota` / `QuotaInfo` — sygnał parsowany na granicy providera i wyrzucany | D-9 |
| C6 | `recorded` — pole kontraktu martwe po stronie UI | D-10 |
| C7 | Klient rozgałęzia się na `data.ok`, ignoruje status HTTP | D-11 |

### 1.2 Nie-kandydaci (wejście do oceny wykonalności i kosztu, nie zmiana struktury)

| Pozycja | Dlaczego nie kandydat |
|---|---|
| D-1 (0% pokrycia `sanitizeSummary`), D-2 (`toCandidate`), D-3 (mapowanie błędów providera), D-4 (4/5 funkcji `history.ts`), D-5 (brak E2E US-01), D-6 (brak testu integracyjnego) | luki w testach — naprawa dodaje pliki testowe, nie zmienia struktury kodu produkcyjnego |
| D-8 (brak timeoutu na `fetch`) | brakujący hardening w 1 call-site (`spoonacular.ts:93`), dodanie zachowania, nie restrukturyzacja |
| D-12 (testy zabetonowane na implementacji), D-13 (komponenty nietestowalne: `vitest` node env, brak jsdom/RTL), D-14 (wyciszony `console.error`, nietestowane `catch`, brak projektu mobilnego w Playwright) | dotyczą infrastruktury testowej; **kluczowe wejście do oceny wykonalności** — patrz §4 |
| `config-status.ts` jako orphan (repo-map #5) | już skorygowane w raporcie źródłowym — nie jest problemem |
| repo-map #2 (fan-in `supabase.ts` = 10 prod), repo-map #6 (bus factor 1) | właściwości repo, nie defekty struktury do naprawy refaktorem |

---

## 2. Kandydaci — obecny kształt (dowody)

### C1 — kontrakt koperty nie jest single-source

**Korekta premisy (evidence).** `ProposalPayload` **jest** zadeklarowanym, eksportowanym interfejsem (`src/pages/api/proposals.ts:33-49`), a `ProposalMode` typem eksportowanym (`:26`); oba są re-eksportowane type-only w `src/components/proposals/types.ts:9,12`. Ta połowa szwu jest zdrowa. Niezadeklarowana jest **koperta**: `json({ ok: true, mode, proposals: payloads, recorded, degraded }, 200)` (`:149`) to literał w locie, bez żadnego typu serwerowego.

**Ręczne lustro (evidence).** `ProposalsResponse` (`src/components/proposals/types.ts:16-18`) przepisuje pola koperty 1:1 i typuje `reason` jako `string`. Serwerowy `FailureReason` (`api/proposals.ts:13`) jest wąskim unionem, ale **nie jest eksportowany** — klient strukturalnie nie ma czego zawęzić (evidence, nie inference).

**Ten sam wzorzec powtarza się po stronie ocen (evidence).** `api/ratings.ts:115` — inline `{ ok: true, verdict }`; `RatingResponse` żyje w `components/proposals/types.ts:28` (a nie w `components/ratings/types.ts`, które je stamtąd re-eksportuje, `ratings/types.ts:11`) i również rozszerza `reason` do `string`; własny `FailureReason` (`ratings.ts:6`) także nieeksportowany. Czyli defekt jest **wzorcem repo**, nie jednorazowym niedopatrzeniem.

**Konsekwencja (inference, zgodna z §1.7 raportu).** Dodanie powodu jest bezpieczne (`STATUS_BY_REASON` się nie skompiluje), ale zmiana nazwy powodu albo pola koperty jest dla typów całkowicie niewidoczna.

### C2 — brak typowanego dostępu do danych

**Evidence.** Dziewięć call-site'ów `.from("…")`: `lib/history.ts:48,75,100,135,173`, `api/proposals.ts:185,195`, `api/ratings.ts:101,160`. Kolumny jako literały w `.select`, `.eq`, `.order`, `onConflict` (`history.ts:49,76,101,136,174`, `proposals.ts:186,187,196-201`, `ratings.ts:103-108`). Wiersze rzutowane ręcznie przez `as` — 12 wyrażeń `as` (`history.ts:59-60,86-88,109,150,157-159,184`) (raport: `59,87,109,157-161,184`). Żadnego pliku typów bazy w `src/`.

**Istniejąca abstrakcja (evidence).** `src/lib/history.ts` **już jest** granicą zapytań po stronie odczytu — komentarz nagłówkowy `:1-22` deklaruje to wprost („all S-05 DB reads in one place… the endpoint stays thin by not owning any query text"). Ale: obejmuje tylko odczyty (zapisy do `recipes`/`proposals`/`ratings` żyją w endpointach) i wewnętrznie i tak używa gołych stringów. To granica **kształtu zapytań**, nie granica **typowanego schematu**.

**Nieograniczone selecty (evidence).** `getRecentLikes` (`:46-62`), `getStaleLikes` (`:72-90`), `getDislikedIds` (`:98-110`) — bez `.limit()`; komentarze `:39-45` i `:92-97` same przyznają zależność od `max-rows`. Wyjątek: `getRatedRecipes` `.limit(100)` (`:139`).

### C3 — endpoint jako węzeł orkiestracji

**Evidence — dziewięć odpowiedzialności w jednym pliku:** bramka auth `:95-98`; konstrukcja klienta sesyjnego `:100-103`; fan-out historii `:105-111`; wybór trybu `:113`; dispatch silnika `:119-140`; `STATUS_BY_REASON` `:18-23`; `toPayload` `:51-70`; `persist` z **dwoma** klientami `:162-209` (admin `:176,185-188`; sesyjny `:195-202`); koperta catch z redakcją `apiKey` `:150-159`.

**Evidence — co jest reużywalne:** eksportowane są **tylko** `ProposalMode` (`:26`) i `ProposalPayload` (`:33`). `STATUS_BY_REASON`, `toPayload`, `persist` i cała sekwencja orkiestracji są module-private — nic w `src/` nie może ich użyć bez duplikacji.

**Uwaga zakresowa:** rozdział dwóch klientów **nie jest** tu defektem (patrz §3, C3) — kandydatem jest współlokacja `persist` + mapowań z resztą endpointu.

### C4 — bariera compliance wewnątrz silnika slotów

**Evidence.** `src/lib/proposals.ts` (480 linii — raport: 481) zawiera dwa rozłączne zbiory:
- *sanityzacja/compliance* ≈ `:67-241`: `MAX_EXCERPT`/`MIN_EXCERPT` (`:67,69`), `NUTRITION_FIGURE` (`:73`), `NUTRITION_CLAIM` (`:81-82`), `PROVIDER_MENTION` (`:85`), tablica `ENTITIES` (`:90-134`) i siedem prywatnych helperów (raport: osiem) (`fromCodePoint:138`, `decodeEntities:142`, `firstStopIndex:155`, `toSentenceBoundary:164`, `ellipsize:177`, `trimDangling:186`, `truncate:196`) plus eksportowany `sanitizeSummary` (`:211`);
- *silnik FR-008* ≈ `:243-480` (raport: `243-481`): `pickCuisinePair:244`, `randomOffset:250`, `toProposed:254`, `interleave:265`, `preferFailure:288`, `buildColdStartSet:302`, `fromById:342`, `buildPersonalizedSet:368`.

**Evidence — szew jest wąski:** jedyne połączenie to `excerpt: sanitizeSummary(recipe.summary)` w `toProposed` (`:258`). Zero zewnętrznych importerów `sanitizeSummary`.

### C5 — sygnał kwoty bez konsumenta

**Evidence.** `QuotaInfo` (`spoonacular.ts:17-21`, eksportowany), `parseQuota` (`:39-49`, prywatny), produkcja w `callApi` (`:99`), dołączane do wyniku w `:102,105,112,114`. Grep po `src/`: żadnego odczytu `.quota` ani importu `QuotaInfo` poza `spoonacular.ts`; `lib/proposals.ts` odrzuca je milcząco (jego typy wynikowe nie mają pola `quota`).

### C6 — `recorded` martwe w UI

**Evidence.** Produkcja: `api/proposals.ts:147,149`; `persist` zwraca `false` w trzech przypadkach (`:182`, `:189-193`, `:203-207`). Konsumpcja: `ProposalList.tsx:53-56` czyta `mode`, `degraded`, `proposals` — `recorded` nie występuje w pliku ani nigdzie w `src/components/**` poza deklaracją typu (`types.ts:17`). Po stronie serwera pole ma 3 asercje `expect()` w `api/__tests__/proposals.test.ts` (`:279,305,324`) — raport: 5 (`:279,293,305,311,324`); `:293` i `:311` to tytuły `it(...)`, nie asercje (dodatkowo `:303,322` to destrukturyzacje body).

### C7 — rozgałęzienie na `data.ok`

**Evidence.** `ProposalList.tsx:30-63`: `fetch` `:37`, `.json()` `:38`, gałąź `!data.ok` `:40-44`, syntetyczne `no_results` `:47-51`, sukces `:53-56`, `catch` → `errorReason = "network_error"` `:57-59`. `response.status` nie jest czytany nigdzie.
**Zaostrzenie (evidence, nowe wobec D-11):** klientowy `"network_error"` z `catch` **koliduje** z serwerowym `"network_error"` (`spoonacular.ts:97,112` → `STATUS_BY_REASON`). `ProposalError.tsx:11-20` to `Record<string,string>` z generycznym fallbackiem `:22-33` — dwie różne przyczyny renderują identyczny komunikat i są nierozróżnialne także dla przyszłej telemetrii.

---

## 3. Werdykty intencjonalności

| # | Werdykt | Dowód |
|---|---|---|
| C1 | **Świadome ograniczenie — częściowo.** Dyscyplina type-only re-eksportu jest udokumentowaną decyzją: commit `b9f8675a` (2026-08-08, triaż impl-review) zastąpił ręczne lustro re-eksportem, „wire contract has exactly one declaration"; ta sama konwencja w `context/archive/2026-07-20-cold-start-proposals/reviews/impl-review.md:98`, `.../2026-08-08-personalized-proposal-slots/research.md:111`, `context/map/repo-map.md:93`. **Ale rozszerzenie `reason` do `string` (`types.ts:18`, commit `b6d64cd8`) i brak typu koperty nie mają żadnego uzasadnienia w commitach ani planach — to przypadkowa złożoność wewnątrz świadomej konwencji.** |
| C2 | **Świadome ograniczenie.** `src/lib/history.ts:8-10` (commit `81716b4a`): „Queries are untyped string-keyed per the repo convention (no generated DB types this slice)"; szerzej `context/archive/2026-08-09-manage-rated-recipes/research.md:144` („the repo deliberately avoids zod, generated DB types, useEffect…"), źródło w `context/archive/2026-07-20-cold-start-proposals/plan.md:13`. |
| C3 | **Świadome ograniczenie — co do rozdziału klientów.** `src/lib/supabase-admin.ts:1-14` (commit `dbe6c631`) cytuje lesson „Shared catalogue tables under anon-key RLS"; `supabase/migrations/20260809180000_manage_rated_recipes.sql:27-29` (ten sam commit) cofa insert dla `authenticated`; pełny opis w `context/archive/2026-08-09-manage-rated-recipes/plan.md:14,21,32,62-63,95,99-103`. **Współlokacja `persist`/`toPayload`/`STATUS_BY_REASON` z endpointem: unknown** — żaden dokument jej nie uzasadnia ani nie kwestionuje. |
| C4 | **Unknown.** Wprowadzone commitem `d2d7513` jako część „pure proposal-assembly layer"; w commitach, planach i review nie ma **żadnej** dyskusji o granicach modułu. Kod wylądował tam, gdzie lądowały pozostałe helpery warstwy retrievalu. Uczciwie: brak dowodu w obie strony. |
| C5 | **Świadome ograniczenie.** `deea7fd` — „minimal typed Spoonacular client (search + by-id, quota telemetry, 402 as typed outcome)"; `context/archive/2026-07-16-spoonacular-retrieval-spike/` (plan/findings/measurements) pokazuje, że nagłówki kwoty były **instrumentem pomiarowym spike'u** walidującym model kosztowy z PRD. Nieużywane dziś, bo swoją robotę już wykonały — nie zapomniane. |
| C6 | **Świadome ograniczenie (zaakceptowana luka).** `context/archive/2026-07-20-cold-start-proposals/plan.md:259`: „If either write fails, return 200 with the proposals and `recorded: false`… the database row is the retryable part". Jawnie odnotowane jako niepodpięte w `.../2026-08-08-personalized-proposal-slots/research.md:61` i zaakceptowane jako szum MVP w `plan-brief.md:57`; `impl-review.md:129-137` (F9) domknął to testem pinującym, świadomie bez podpięcia UI. |
| C7 | **Świadome ograniczenie.** `context/archive/2026-07-20-cold-start-proposals/plan.md:58`: endpoint „maps the typed failure union onto HTTP statuses plus a machine-readable `reason` code. The UI consumes that envelope and branches its error banner on the code." Dyskryminator JSON jest bogatszy niż sam status. |

---

## 4. Wykonalność migracji — wspólne tło

**CI nie uruchamia żadnych testów (evidence).** `.github/workflows/ci.yml`: `npm ci` → `npx astro sync` → `npm run lint` → `npm run build`. `.github/workflows/deploy.yml`: to samo + `wrangler-action@v3`. **Ani `vitest`, ani Playwright nie są w żadnym workflow.** Jedyne uruchomienie pełnej suity to `.husky/pre-push` → `npm test`, lokalnie i nieegzekwowane po stronie serwera; `.husky/pre-commit` uruchamia `vitest related --run --passWithNoTests` tylko na zmienionych plikach.

**To zmienia wagę wszystkich luk testowych z §1.2:** testy w tym repo nie są bramką CI, tylko lokalną siatką. Każdy refaktor jest osłonięty realnie przez `eslint --fix` + `astro build` (typy) i przez suitę tylko wtedy, gdy autor faktycznie zrobi push z hookiem.

**Brak jakiejkolwiek egzekwowanej granicy importów (evidence).** `.dependency-cruiser.cjs` istnieje, ale grep po `package.json`, workflowach i hookach nie znajduje **żadnego** wywołania — konfiguracja jest martwa. `eslint.config.js` jest type-aware (`strictTypeChecked`, `react-compiler: error`), ale nie ma reguł architektonicznych.

**Brak testów komponentów jest strukturalny, nie przypadkowy (evidence).** `vitest.config.ts:20-21` — `environment: "node"`, `include: ["src/**/__tests__/**/*.test.ts"]`; `.tsx` wykluczone; brak jsdom/RTL w `package.json`. Każdy kandydat dotykający `src/components/**` (C1 częściowo, C6, C7) startuje bez możliwości napisania testu regresyjnego bez uprzedniej zmiany konfiguracji i zależności.

**Testy zabetonowane na implementacji podnoszą koszt C2 (evidence, D-12).** `history.test.ts:19-26` i `ratings.test.ts:149-157` kodują dokładny łańcuch PostgREST — typowany builder może zmienić kształt wywołania bez zmiany zachowania i sczerwienić te testy.

**`supabase gen types` offline: unknown w części.** `supabase/config.toml` i migracje istnieją, CLI jest devDependency — scaffolding jest, ale nie zweryfikowano wykonania (analiza read-only).

### 4.1 Notatki per kandydat

| # | Abstrakcja | Blast radius | Osłony dziś | Pierwszy krok-prerekwizyt | Odwracalność |
|---|---|---|---|---|---|
| C1 | istniejąca (konwencja type-only re-eksportu) | niski: 1 typ, konsument `ProposalList.tsx:6,38`; ale wzorzec powiela się na stronie ocen | `api/__tests__/proposals.test.ts` (jedyny), zero testów `.tsx` | wyeksportować nazwany typ koperty **i** `FailureReason` z `api/proposals.ts` (dodatek, nic nie łamie) | wysoka |
| C2 | **nowa** (typy generowane) + rozszerzenie `history.ts` | największy: `supabase.ts` 10 importerów prod + 3 pliki testowe; typy wchodzą w generyki obu fabryk klientów | testy cementujące łańcuch PostgREST **przeszkadzają**, nie chronią | zweryfikować, że `supabase gen types typescript --local` w ogóle się uruchamia; wygenerowany plik zacommitować **niepodpięty** | średnia (generacja odwracalna, wpięcie w generyki mniej) |
| C3 | nowy, mały moduł (przeniesienie 1:1) | najmniejszy ze strukturalnych: `supabase-admin.ts` 1 importer prod, wszystkie 3 cele są dziś module-private | `api/__tests__/proposals.test.ts` mockuje na granicy modułów — po ekstrakcji nadal pokrywa, o ile nowy moduł jest importowany, nie domockowany (inference) | przenieść `persist()` verbatim do nowego pliku, zaimportować bez zmian, lokalnie `npm test` | wysoka (czyste przeniesienie) |
| C4 | nowy, samodzielny moduł | niski: 1 wewnętrzny call-site (`:258`), zero zewnętrznych importerów | `lib/__tests__/proposals.test.ts` istnieje, ale D-1 mówi wprost: **zero testów `sanitizeSummary`** — osłony brak | przenieść blok `:67-241` do `src/lib/sanitize-summary.ts`, zaimportować z powrotem, poprawić import w teście | wysoka |
| C5 | żadna — decyzja usunąć vs podpiąć | usunięcie: tylko `spoonacular.ts` (+ ewentualna asercja w jego teście); podpięcie: `proposals.ts` + `api/proposals.ts`, wchodzi w kolizję z C1 | brak (nic nie konsumuje) | rozstrzygnąć kierunek; usunięcie = zdjąć `quota?` z obu wariantów `SpoonacularResult` | wysoka w obie strony |
| C6 | żadna — decyzja usunąć vs podpiąć | podpięcie: 1 plik UI; usunięcie: `api/proposals.ts` + `types.ts:17` + **przepisanie 5 asercji** | mocne po stronie serwera, zerowe po stronie klienta | **kierunek nie jest pytaniem strukturalnym** — patrz §5 „granica" | typ-only krok odwracalny; edycja testów mniej |
| C7 | żadna — dodanie gałęzi | najmniejszy: 1 funkcja (`getProposals:30-63`) | zero po stronie klienta (brak testów `.tsx`) | najpierw rozbroić kolizję nazwy `network_error` (klient vs serwer), inaczej gałąź po statusie nie da rozróżnienia | wysoka |

---

## 5. Refactor opportunities (ranking — propozycja do osobnej sesji planowania)

### #1 — C4: wyprowadzić barierę compliance z silnika slotów

- **Obecny → docelowy kształt:** ~175 linii sanityzacji i stałych compliance (`lib/proposals.ts:67-241`) wplecionych w 481-liniowy silnik FR-008 → osobny moduł polityki treści (np. `src/lib/sanitize-summary.ts`), importowany przez `toProposed`.
- **Dlaczego to miejsce:** koszt długu jest najwyższy w repo w stosunku do kosztu zmiany. To **jedyny** mechanizm broniący non-goala „no macro/nutritional data" i NFR o stripowaniu markupu (D-1), ma 0% pokrycia, a `lessons.md` już zapisuje ten zbiór wzorców jako trwale niekompletny i wymagający re-widening przy każdej nowej próbce payloadów providera. Trzymanie polityki providera w module reguł produktowych sprawia, że każda zmiana slotów przechodzi przez ten sam plik i odwrotnie. Koszt zmiany jest za to najniższy z całej listy: jeden szew (`:258`), zero zewnętrznych importerów, czyste przeniesienie.
- **Blast radius:** 1 plik źródłowy + 1 plik testowy (import path). Zero konsumentów poza modułem.
- **Ścieżka inkrementalna:** (1) przeniesienie verbatim + re-import, bez zmiany zachowania; (2) dopiero wtedy dopisanie testów `sanitizeSummary` — na module o jednej odpowiedzialności test pisze się na wejście/wyjście, nie przez fixture'y silnika slotów, co jest bezpośrednią przyczyną obecnego zera (D-1); (3) opcjonalnie re-widening wzorców przy następnej próbce payloadów, już pod osłoną testów.
- **Pierwszy krok-prerekwizyt:** przenieść blok `:67-241` do `src/lib/sanitize-summary.ts` i zaimportować z powrotem — jedna zmiana, weryfikowalna przez `npm run build` + `npm test`.

### #2 — C1: zamknąć szew koperty na poziomie typów

- **Obecny → docelowy kształt:** koperta 200 jako literał bez typu (`api/proposals.ts:149`) + ręczne lustro w kliencie z `reason: string` (`types.ts:16-18`) → jedna deklaracja koperty po stronie serwera (właściciela) + eksport `FailureReason`, re-eksportowane type-only tak jak `ProposalPayload`/`ProposalMode` już dziś są.
- **Dlaczego to miejsce:** raport źródłowy nazywa ten szew najwyżej ryzykownym w przepływie, a §3 pokazuje, że jest to **jedyny fragment świadomej konwencji, który tej konwencji nie realizuje** — czyli przypadkowa złożoność w środku decyzji nośnej, najtańszy rodzaj długu do spłacenia. Dziś zmiana nazwy powodu lub pola koperty jest dla kompilatora niewidoczna, a jedyną obroną jest suita, która **nie działa w CI** (§4). Ten sam defekt powtarza się po stronie ocen (`RatingResponse` mieszkający w pliku typów propozycji), więc jedno przejście domyka dwa endpointy.
- **Blast radius:** `api/proposals.ts` (dodanie typu), `components/proposals/types.ts`, `ProposalList.tsx:6,38`, `ProposalError.tsx` (klucze `MESSAGE_BY_REASON` przestają być gołym `string`); analogicznie `api/ratings.ts` + `components/ratings/types.ts`. `RecipeCard.tsx` współzmienia się z `types.ts` w 4/4 commitów — traktować jako część zestawu.
- **Ścieżka inkrementalna:** (1) czysto addytywnie wyeksportować typ koperty i `FailureReason` z endpointu — nic się nie łamie; (2) zamienić `ProposalsResponse` na kompozycję importowanych typów, zawężając `reason`; kompilator wskaże każde miejsce, które dziś przyjmuje dowolny string; (3) to samo dla `RatingResponse`/`RatingDeleteResponse`, przenosząc własność do `api/ratings.ts`.
- **Pierwszy krok-prerekwizyt:** `export` na `FailureReason` w `src/pages/api/proposals.ts:13` i nazwany typ koperty obok `ProposalPayload`. Zmiana wyłącznie typów, `npm run build` jest pełną weryfikacją.

### #3 — C3: odchudzić węzeł orkiestracji

- **Obecny → docelowy kształt:** `api/proposals.ts` niosący dziewięć odpowiedzialności, z których żadna poza dwoma typami nie jest reużywalna → endpoint jako cienka orkiestracja + wydzielony moduł zapisu (`persist`) i moduł mapowania (`toPayload` + `STATUS_BY_REASON`). **Rozdział dwóch klientów Supabase zostaje bez zmian** — jest decyzją nośną wymuszoną przez `revoke insert` (§3).
- **Dlaczego to miejsce:** to strefa ryzyka #1 z repo-mapy i najwyższy fan-out w repo; jednocześnie jedyna nieuzasadniona częścią jest współlokacja, a nie sam podział uprawnień. Koszt długu jest średni (regresja tu dotyka całej pętli produktu), koszt zmiany niski — wszystkie trzy cele są module-private, a `supabase-admin.ts` ma dokładnie jednego importera produkcyjnego. Efekt uboczny wart osobnej uwagi: wydzielony `persist` staje się testowalny bez mockowania czterech kolaboratorów endpointu, co jest bezpośrednim wejściem do D-6 (brak testu integracyjnego) i do jedynej nietestowanej gałęzi insertu `proposals` (`:203-207`).
- **Blast radius:** 1 plik produkcyjny źródłowy + 1 nowy + `api/__tests__/proposals.test.ts` (mocki na granicy modułów). Poza tym nic — te symbole nie wyciekają z pliku.
- **Ścieżka inkrementalna:** (1) `persist()` verbatim do nowego modułu, import bez zmian sygnatury; (2) `toPayload` + `STATUS_BY_REASON` do modułu mapowania (naturalnie łączy się z krokiem #2 z C1 — mapa statusów i union powodów to ten sam kontrakt); (3) dopiero potem ewentualne testy nowych modułów.
- **Pierwszy krok-prerekwizyt:** przenieść `persist()` (`:162-209`) do osobnego pliku bez żadnej zmiany ciała funkcji.

### Kandydaci rozważeni i odrzuceni

| # | Dlaczego nie w rankingu |
|---|---|
| **C2 — typowany dostęp do danych** | Największy blast radius w repo (`supabase.ts`: 10 importerów produkcyjnych), jedyny kandydat wymagający **nowej infrastruktury**, oparty na niezweryfikowanym założeniu, że `supabase gen types` uruchomi się offline. Do tego to jedyny werdykt „świadome ograniczenie" wprost zapisany jako konwencja repo (`history.ts:8-10`) — zmiana wymaga cofnięcia decyzji, nie naprawy pomyłki. Dodatkowo istniejące testy (`history.test.ts:19-26`) cementują łańcuch PostgREST, więc przeszkodzą zamiast osłonić. Rekomendacja: rozważyć dopiero po C1/C3 i po tym, jak testy przestaną być zabetonowane. |
| **C5 — `QuotaInfo` bez konsumenta** | Werdykt: świadome — pole było instrumentem pomiarowym spike'u i swoją rolę wykonało. Naprawa to jednolinijkowe sprzątanie albo (przy podpięciu) nowa funkcja produktowa „licznik budżetu", czyli nie refaktor. Zerowy zysk strukturalny. |
| **C6 — martwe `recorded`** | **Granica analizy: prawdziwa naprawa to decyzja produktowa, nie strukturalna.** Pytanie brzmi „czy użytkownik ma widzieć, że propozycja nie została zapisana i co to dla niego znaczy" — a to przeprojektowanie pojęcia biznesowego (semantyka slotu 2 zależy od kompletności historii). Archeologia potwierdza, że luka jest zaakceptowana świadomie (`plan-brief.md:57`, F9 w impl-review). Zatrzymuję się tutaj; to przedmiot osobnej analizy produktowej, nie sesji refaktorowej. |
| **C7 — rozgałęzienie na `data.ok`** | Werdykt: świadome ograniczenie z jawnym uzasadnieniem w planie (dyskryminator JSON bogatszy niż status). Naprawa dodaje gałąź, nie zmienia struktury. Warto natomiast odnotować jako osobne, drobne znalezisko **kolizję nazwy `network_error`** między `catch` klienta a powodem serwerowym — jedna linia, zero blast radius, ale bez niej gałąź po statusie i tak nic nie rozróżni. |

---

## 5a. Weryfikacja twierdzeń (ast-grep)

Weryfikacja mechaniczna twierdzeń **strukturalnych**, na których stoi ranking. Narzędzie: `ast-grep 0.45.1`, commit `5a83621` (identyczny z commitem raportu). Każdy wynik zerowy z ast-grep został potwierdzony klasycznym `grep`. Sekcje §3 (werdykty intencjonalności) i §5 (ranking) pozostają nietknięte.

| # | Twierdzenie | Werdykt | Dowód (plik:linia) | Metoda (wzorzec/reguła) |
|---|---|---|---|---|
| T1 | Dziewięć call-site'ów `.from("…")` w `src/`, dokładnie pod podanymi liniami | **potwierdzone** | `lib/history.ts:48,75,100,135,173`; `api/proposals.ts:185,195`; `api/ratings.ts:101,160` | pattern `$C.from($T)`, lang ts, dir `src` → 9 trafień; linie startu dopasowania w łańcuchach wieloliniowych zweryfikowane `grep -rn '\.from("'` |
| T2 | Trzy nieograniczone selecty (`getRecentLikes`, `getStaleLikes`, `getDislikedIds`); wyjątek `getRatedRecipes .limit(100)` na `:139` | **potwierdzone** | zakresy funkcji `history.ts:46-62`, `72-90`, `98-110` bez `.limit`; `:139` `.limit(100)` | rule `kind: function_declaration` (zakresy) + `grep -n "limit("` → tylko `:139` i `:178` (`getTopCuisine .limit(1)`, poza twierdzeniem) |
| T3 | Ręczne rzutowania wierszy `as` w `history.ts` pod liniami `59,87,109,157-161,184` | **doprecyzowane** | faktyczne: `history.ts:59,60,86,87,88,109,150,157,158,159,184` (12 wyrażeń) | rule `kind: as_expression` → 12 trafień; `grep -n " as "` potwierdza. Raport pominął `:150` (podwójne `as unknown as`) i podał `157-161` zamiast `157-159` |
| T4 | `api/proposals.ts` eksportuje **tylko** `ProposalMode` i `ProposalPayload` (poza handlerem) | **potwierdzone** | `api/proposals.ts:26` (`ProposalMode`), `:33-49` (`ProposalPayload`), `:91` (`export const POST`) | patterny `export interface $N { $$$ }` → 1, `export type $N = $$$` → 1, `export function $N($$$) { $$$ }` → **0** (potwierdzone `grep -n "^export"`), `export const $N: $T = $$$` → 1 (handler) |
| T5 | `FailureReason` (`api/proposals.ts:13`) nie jest eksportowany; ten sam wzorzec w `api/ratings.ts` | **potwierdzone, doprecyzowane** | `api/proposals.ts:13`, `api/ratings.ts:6` — żaden bez `export`. **Trzecia, nieodnotowana deklaracja: `lib/proposals.ts:18`** (też bez `export`) | `grep -rn "FailureReason" src` → 8 trafień, 3 deklaracje typu, 0 z `export` |
| T6 | Para lustrzana kopert klienckich: `ProposalsResponse` i `RatingResponse` obie rozszerzają `reason` do `string`, obie w `components/proposals/types.ts` | **potwierdzone** | `components/proposals/types.ts:16-18` i `:28`; re-eksport `components/ratings/types.ts:11`; re-eksporty type-only `proposals/types.ts:9,12` | odczyt pełnych plików typów + `grep -n "ok: true"` w `api/ratings.ts` (`:115` inline, zgodnie z raportem) |
| T7 | Para lustrzana `STATUS_BY_REASON` — nieodnotowana w raporcie jako para | **doprecyzowane (nowe)** | `api/proposals.ts:18-23` i `api/ratings.ts:8` — dwie niezależne mapy statusów nad dwoma niezależnymi unionami | `grep -rn "STATUS_BY_REASON" src` → 2 deklaracje |
| T8 | `api/proposals.ts` — dziewięć odpowiedzialności pod podanymi liniami | **potwierdzone** | auth `:95-98`; klient `:100-103`; fan-out `:105-111`; tryb `:113`; dispatch `:119-140`; `STATUS_BY_REASON` `:18-23`; `toPayload` `:51-70`; `persist` `:162-209`; catch `:150-159` | rule `kind: function_declaration` → 3 funkcje (`toPayload:51`, `json:72`, `persist:162`) + odczyt zakresów; plik ma 209 linii |
| T9 | `persist` zwraca `false` w trzech przypadkach | **potwierdzone** | `api/proposals.ts:182`, `:192`, `:206` (raport podał zakresy `:182`, `:189-193`, `:203-207` — obejmują te linie) | odczyt zakresu `162-209` |
| T10 | `lib/proposals.ts`: 481 linii, 8 prywatnych helperów sanityzacji, silnik `:243-481` | **doprecyzowane** | plik ma **480** linii; helperów prywatnych sanityzacji jest **7** (`:138,142,155,164,177,186,196`) + eksportowany `sanitizeSummary:211`; silnik `:243-480` | rule `kind: function_declaration` → 16 funkcji w pliku, wszystkie linie z raportu (`244,250,254,265,288,302,342,368`) zgodne; `wc -l` |
| T11 | Stałe compliance pod liniami `67,69,73,81-82,85,90-134`; blok sanityzacji `:67-241` (~175 linii) | **potwierdzone** | `MAX_EXCERPT:67`, `MIN_EXCERPT:69`, `NUTRITION_FIGURE:73`, `NUTRITION_CLAIM:81`, `PROVIDER_MENTION:85`, `ENTITIES:90` | `grep -n` po nazwach stałych + odczyt bloku |
| T12 | Jedyny szew C4: `sanitizeSummary` wołany raz (`:258`), zero zewnętrznych importerów | **potwierdzone, doprecyzowane** | `lib/proposals.ts:211` (deklaracja), `:258` (jedyne wywołanie) — **łącznie 2 wystąpienia w całym `src/`, w tym 0 w plikach testowych** | `grep -rn "sanitizeSummary" src` → 2 trafienia (ast-grep pattern `sanitizeSummary($$$)` → 1; zero zewnętrznych potwierdzone grepem) |
| T13 | `QuotaInfo`/`parseQuota` — sygnał bez konsumenta poza `spoonacular.ts` | **potwierdzone** | `spoonacular.ts:17` (`QuotaInfo`, eksport), `:39` (`parseQuota`, prywatny), produkcja `:99`, dołączenie `:102,105,112,114` | rule `kind: function_declaration` na `spoonacular.ts` → 5 funkcji; `grep -rn "QuotaInfo\|\.quota"` → poza `spoonacular.ts` wyłącznie fixture'y testowe (`lib/__tests__/proposals.test.ts:50,135,142`), zero odczytów produkcyjnych |
| T14 | `recorded` nie występuje w `src/components/**` poza deklaracją typu | **potwierdzone** | jedyne wystąpienie: `components/proposals/types.ts:17` | `grep -rn "recorded" src` → 0 trafień w `components/` poza `types.ts:17` (wynik zerowy potwierdzony klasycznym grepem) |
| T15 | `recorded` ma 5 asercji po stronie serwera | **obalone** | `api/__tests__/proposals.test.ts:279,305,324` = 3 asercje `expect()`; `:293` i `:311` to tytuły `it(...)`, `:303,322` to destrukturyzacje | `grep -rn "recorded" src` z klasyfikacją trafień |
| T16 | `response.status` nie jest czytany nigdzie w kliencie | **potwierdzone** | zero trafień w `src/components/**` | `grep -rn "\.status" src/components` → **0** (wynik zerowy potwierdzony klasycznym grepem); odczyt `ProposalList.tsx:30-63` — linie `:37,38,40-44,47-51,53-56,57-59` zgodne z raportem |
| T17 | Kolizja nazwy `network_error`: klient (`catch`) vs serwer (provider) | **potwierdzone** | klient `ProposalList.tsx:58`; serwer `spoonacular.ts:97` (fetch throw) i `:112` (parse throw) → `STATUS_BY_REASON` `api/proposals.ts:21` | `grep -rn "network_error" src`; potwierdzone też, że `ProposalError.tsx:13` i `:14` mapują `http_error` i `network_error` na **identyczny** string |
| T18 | Fan-in: `supabase.ts` = 10 importerów produkcyjnych + 3 testowe; `supabase-admin.ts` = 1 produkcyjny | **potwierdzone** | prod: `lib/history.ts`, `middleware.ts`, `api/auth/{callback,confirm,signin,signout,signup}.ts`, `api/proposals.ts`, `api/ratings.ts`, `pages/dashboard/ratings.astro` = 10; testy: `lib/__tests__/history.test.ts`, `api/__tests__/proposals.test.ts`, `api/__tests__/ratings.test.ts` = 3. Admin: `api/proposals.ts:3` (+1 mock testowy) | `grep -rn 'lib/supabase"' src` i `grep -rn "supabase-admin" src` (importy w `.astro` poza zasięgiem ast-grep dla lang ts — stąd grep jako metoda wiodąca) |

### Uwagi wpływające na pozycje kandydatów — **do decyzji na etapie planowania**

1. **C4 (miejsce #1): blast radius jest jeszcze mniejszy, niż zakłada §4.1/§5.** Twierdzenie o „1 pliku testowym (import path)" i o „poprawieniu importu w teście" nie ma pokrycia: `lib/__tests__/proposals.test.ts` **w ogóle nie importuje `sanitizeSummary`** (T12 — 0 trafień w plikach testowych). Ekstrakcja dotyka więc jednego pliku produkcyjnego i zera plików testowych. Wzmacnia to argument za pozycją #1 i jednocześnie potwierdza D-1 (0% pokrycia) mechanicznie. *Do decyzji na etapie planowania.*
2. **C1 (miejsce #2): zakres jest o jedną deklarację szerszy.** Poza `api/proposals.ts:13` i `api/ratings.ts:6` istnieje trzeci, nieodnotowany `FailureReason` w `lib/proposals.ts:18` (T5), a mapa `STATUS_BY_REASON` również występuje w dwóch egzemplarzach (T7). „Jedno przejście domyka dwa endpointy" jest prawdziwe co do kopert, ale union powodów ma trzy miejsca deklaracji, nie dwa. *Do decyzji na etapie planowania.*
3. **C6: siła osłony serwerowej jest niższa, niż podano.** T15 obala „5 asercji" — realnie są 3. Nie zmienia to werdyktu §5 („granica analizy: decyzja produktowa"), ale koszt wariantu „usunąć" (przepisanie asercji) jest mniejszy niż zapisany w §4.1. *Do decyzji na etapie planowania.*
4. **Nic w wynikach nie podważa kolejności C4 → C1 → C3.** Wszystkie twierdzenia niosące ranking (T4, T8, T9, T12, T18) wyszły potwierdzone co do treści i co do numerów linii.

---

## 6. Unknown — czego ta analiza nie ustaliła

- Czy `supabase gen types typescript --local` faktycznie działa w tym repo (nie uruchamiano — tryb read-only).
- Dlaczego `sanitizeSummary` wylądował w `lib/proposals.ts` — brak jakiegokolwiek śladu decyzji (C4, uczciwe unknown; nie wpływa na ranking, bo koszt zmiany jest niski niezależnie od intencji).
- Dlaczego `reason` został rozszerzony do `string` w `types.ts:18` (commit `b6d64cd8`) — brak uzasadnienia w commicie i planach.
- Czy `lib/__tests__/proposals.test.ts` po ekstrakcji C4 wymaga tylko zmiany ścieżki importu, czy również przeniesienia fixture'ów — nie otwierano pliku pod tym kątem.
- Wszystkie oceny pokrycia pochodzą z raportu źródłowego i są statyczne — nie uruchamiano `vitest` ani instrumentacji coverage (w `vitest.config.ts` nadal nie ma bloku `coverage`).
- Czy martwa konfiguracja `.dependency-cruiser.cjs` była kiedyś podpięta — nie badano jej historii.

## 7. Powiązania z istniejącym kontekstem

- `context/changes/proposals-dataflow/research.md` — źródło wszystkich dowodów o długu; niniejszy dokument koryguje jedną premisę §1.7: `ProposalPayload` **jest** zadeklarowany po stronie serwera, niezadeklarowana jest wyłącznie koperta.
- `context/map/repo-map.md` §4 — ryzyko #1 potwierdzone jako powierzchnia regresji (C3), ale w części „dwa klienty" zamknięte jako decyzja nośna.
- `context/foundation/lessons.md` — lekcja „Enumerated filters over third-party prose are known-incomplete" jest bezpośrednim uzasadnieniem miejsca #1 w rankingu (C4); lekcja o `max-rows` wisi nad C2.
- `context/archive/2026-07-16-spoonacular-retrieval-spike/`, `.../2026-07-20-cold-start-proposals/`, `.../2026-08-08-personalized-proposal-slots/`, `.../2026-08-09-manage-rated-recipes/` — źródła werdyktów intencjonalności z §3.
