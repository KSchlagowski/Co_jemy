# Artefakt 1 — Mapa terytorium (Wide Scan po historii gita)

**Data analizy:** 2026-08-10 · **Gałąź:** `master` · **Zakres:** ostatnie 12 miesięcy

**Ważny kontekst skali:** cała historia repo to **68 commitów z okresu 2026-05-23 → 2026-08-10** (ok. 3 miesiące). „Ostatnie 12 miesięcy" = cała historia projektu. Rozkład jest silnie skokowy: 1 commit w maju, 10 w czerwcu, 38 w lipcu, 19 w sierpniu — praca odbywa się w intensywnych zrywach (11 commitów 2026-07-20, 19 commitów 2026-08-09).

Filtr szumu: pominięto lockfile'e, `.env*`, snapshoty. **Nie** pominięto plików konfiguracyjnych na poziomie root — przy tak młodym repo niosą realny sygnał.

---

## 1. Aktywność — gdzie projekt był realnie dotykany

Repo dzieli się na dwie rozłączne warstwy i mieszanie ich zniekształca ranking:

- **warstwa kodu** — `src/`, `supabase/`, `e2e/`
- **warstwa procesu** — `context/` (PRD, roadmapa, plany zmian) i `.claude/` (skille toolkitu 10x)

Warstwa procesu dominuje liczbowo (`context/changes` = 90 dotknięć, `.claude/skills` = 57 vs `src/pages` = 32), ale to artefakt metodologii pracy, nie miejsce, gdzie mieszka logika produktu. Poniżej oba rankingi osobno.

### a) TOP foldery / moduły — kod aplikacyjny

| # | Ścieżka | Dotknięć | Co tam jest |
|---|---|---|---|
| 1 | `src/pages/api` | 23 | endpointy: `proposals.ts`, `ratings.ts`, `auth/*` + testy |
| 2 | `src/components/proposals` | 17 | `RecipeCard`, `ProposalList`, `RatingButton`, `ProposalError`, `types` |
| 3 | `src/lib/__tests__` | 6 | testy jednostkowe warstwy domenowej |
| 4 | `src/components/auth` | 6 | formularze rejestracji/logowania |
| 5 | `src/pages/auth` | 4 | strony Astro dla auth |
| 6 | `src/lib/spoonacular.ts` | 4 | klient providera |
| 7 | `src/lib/proposals.ts` | 4 | logika 4 slotów |
| 8 | `src/lib/history.ts` | 4 | historia ocen |
| 9 | `src/components/ratings` | 3 | lista ocenionych przepisów |
| 10 | `supabase/migrations` | 5 (4 pliki) | schemat: cold-start, rate-recipe, sloty, zarządzanie ocenami |

### b) TOP foldery — cały repo (z warstwą procesu)

`context/changes` (90) · `.claude/skills` (57) · root (41) · `context/archive` (35) · `src/pages` (32) · `src/components` (31) · `src/lib` (24) · `context/foundation` (23) · `.claude/prompts` (10) · `supabase/migrations` (5)

### c) TOP pliki

**Kod:**

| # | Plik | Dotknięć |
|---|---|---|
| 1 | `src/pages/api/proposals.ts` | 7 |
| 2 | `src/components/proposals/RecipeCard.tsx` | 7 |
| 3 | `src/pages/api/__tests__/proposals.test.ts` | 4 |
| 4 | `src/lib/spoonacular.ts` | 4 |
| 5 | `src/lib/proposals.ts` | 4 |
| 6 | `src/lib/history.ts` | 4 |
| 7 | `src/components/proposals/types.ts` | 4 |
| 8 | `src/pages/dashboard.astro` | 3 |
| 9 | `src/lib/__tests__/proposals.test.ts` | 3 |
| 10 | `src/components/proposals/ProposalList.tsx` | 3 |

**Cały repo:** `.claude/.10x-cli-manifest.json` (9) · `context/changes/cold-start-proposals/plan.md` (8) · `CLAUDE.md` (8) · `src/pages/api/proposals.ts` (7) · `src/components/proposals/RecipeCard.tsx` (7) · `context/foundation/roadmap.md` (7) · `context/changes/personalized-proposal-slots/plan.md` (6) · `package.json` (5) · `context/foundation/lessons.md` (5) · plany zmian `testing-harness-proposal-units` / `spoonacular-retrieval-spike` / `production-auth-loop` (po 5)

### Wniosek

Serce projektu to **oś propozycji**: `src/lib/proposals.ts` + `src/lib/spoonacular.ts` + `src/lib/history.ts` → `src/pages/api/proposals.ts` → `src/components/proposals/*`. To dokładnie pętla FR-003/FR-008 z PRD (4 sloty + retrieval + oceny). Auth jest zbudowany i zamrożony — dotykany intensywnie w czerwcu, potem prawie wcale.

---

## 2. Podział kwartalny — jak zmieniał się nacisk

Historia obejmuje dwa kwartały kalendarzowe (Q2 częściowo, Q3 do 10 sierpnia).

### Q2 2026 (kwi–cze; realnie 23.05–07.06) — faza fundamentów

| Obszar | Dotknięć |
|---|---|
| `.claude/skills/10x-bootstrapper` | 9 |
| `.claude/skills/10x-tech-stack-selector` | 8 |
| `src/components/auth` | 6 |
| `CLAUDE.md` | 4 |
| `src/pages/auth` | 3 |
| `src/pages/api` | 3 |
| `.claude/skills/10x-stack-assess` | 3 |

Charakter: wybór stacku, scaffolding, PRD, pełna pętla auth. Kodu domenowego prawie nie ma.

### Q3 2026 (lip–sie, do 10.08) — faza produktu

| Obszar | Dotknięć |
|---|---|
| `src/pages/api` | 20 |
| `src/components/proposals` | 17 |
| `context/changes/cold-start-proposals` | 17 |
| `context/changes/spoonacular-retrieval-spike` | 15 |
| `context/changes/personalized-proposal-slots` | 13 |
| `context/changes/manage-rated-recipes` | 11 |
| `context/changes/testing-harness-proposal-units` | 10 |

Charakter: przełom to **18–19 lipca** — pivot retrieval na Spoonacular (PRD i tech-stack mają wpisany tę datę jako „Revised"). Po nim wszystko kręci się wokół propozycji. Sierpień (30 commitów w 3 dni) dokłada personalizację slotów, zarządzanie ocenami i harness testowy.

**Przesunięcie nacisku w jednym zdaniu:** infrastruktura + auth (Q2) → retrieval + rekomendacje + testy (Q3), z ostrą granicą na pivocie Spoonacular 18.07.

---

## 3. Współzmiany — co zmienia się razem

Katalogi liczone per commit (dla `src/`, `context/`, `.claude/` do 3. poziomu).

### Najczęstsze pary

| Dotknięć razem | Para |
|---|---|
| 8 | `CLAUDE.md` ↔ `.claude/.10x-cli-manifest.json` |
| 4 | `src/lib/__tests__` ↔ `src/pages/api` |
| 4 | `astro.config.mjs` ↔ `src/pages/api` |
| 3 | `context/changes/manage-rated-recipes` ↔ `src/components/ratings` |
| 3 | `context/changes/manage-rated-recipes` ↔ `src/pages/api` |
| 3 | `src/components/proposals` ↔ `src/pages/api` |
| 3 | `src/lib/history.ts` ↔ `src/pages/api` |
| 3 | `src/lib/proposals.ts` ↔ `src/pages/api` |
| 3 | `context/changes/spoonacular-retrieval-spike` ↔ `src/lib/spoonacular.ts` |

### Najczęstsze trójki

- `src/components/proposals` + `src/lib/history.ts` + `src/pages/api`
- `src/components/ratings` + `src/lib/history.ts` + `src/pages/api`
- `src/lib/__tests__` + `src/lib/history.ts` + `src/pages/api`
- `context/changes/personalized-proposal-slots` + `src/lib/history.ts` + `supabase/migrations`

### Wnioski dla TOP 3 z rankingu

**1. `src/pages/api`** — węzeł centralny całego repo. Występuje w niemal każdej istotnej parze i trójce: z `src/lib/*` (domena), z `src/components/*` (UI), z `src/lib/__tests__`, z `astro.config.mjs`. To warstwa, przez którą przechodzi każda zmiana funkcjonalna. Praktycznie: zmiana kształtu odpowiedzi `proposals.ts` propaguje się w tym samym commicie do UI i do testów — kontrakt API nie jest odizolowany, jest współdzielony wprost.

**2. `src/components/proposals`** — zmienia się razem z `src/pages/api` i (2×) z `src/components/ratings`. To drugie sprzężenie jest ciekawe: karta propozycji i lista ocenionych przepisów dzielą model danych przepisu (`types.ts` w obu katalogach). Zmiana pól przepisu dotyka obu miejsc — kandydat na wspólny typ zamiast dwóch równoległych.

**3. `src/lib/*` (proposals / history / spoonacular)** — trzy pliki, nie folder, ale zachowują się jak jeden moduł. `history.ts` jest sprzężone najszerzej: z API, z UI propozycji, z UI ocen, z testami i z `supabase/migrations`. To sygnał, że **historia ocen jest osią schematu**: zmiana logiki historii ciągnie za sobą migrację bazy. `spoonacular.ts` jest natomiast wąsko sprzężone — tylko ze swoim spike'em i testami, czyli granica providera jest domknięta czysto (spójne z FR-011, gdzie warstwa dostawcy musi być izolowana).

---

## 4. Wspólny mianownik — pojedynczy plik dotykający wielu obszarów

Po odfiltrowaniu jednego bulk-commita (scaffolding, >25 plików), który sztucznie łączy wszystko ze wszystkim, ranking plików wg liczby **różnych** obszarów, z którymi współwystępują:

| Obszarów | Plik | Charakter |
|---|---|---|
| 59 | `.claude/.10x-cli-manifest.json` | generowany manifest toolkitu — szum, nie sprzężenie |
| 54 | `CLAUDE.md` | **realny wspólny mianownik** |
| 39 | `package.json` | zależności + skrypty |
| 26 | `context/foundation/prd.md` | źródło prawdy o produkcie |
| 24 | `context/foundation/roadmap.md` | kolejność prac |

**Odpowiedź na pytanie:** tak, taki plik istnieje i jest nim **`CLAUDE.md`** — nie plik tłumaczeń ani config, lecz plik instrukcji dla agenta. Zmienia się razem z niemal każdym obszarem repo (54 różne konteksty, 8 dotknięć własnych), bo każda decyzja architektoniczna dopisuje do niego regułę. Para `CLAUDE.md` ↔ `.10x-cli-manifest.json` (8 wspólnych commitów) to najsilniejsze sprzężenie w całym repo.

To specyfika tego projektu: **wspólnym mianownikiem jest warstwa wiedzy, nie warstwa kodu.** Po stronie kodu odpowiednikiem jest `package.json` (39) — ale to zwykłe sprzężenie przez zależności, nie sprzężenie logiczne.

Uwaga metodologiczna: `.10x-cli-manifest.json` prowadzi w rankingu, ale jest plikiem generowanym przez toolkit przy każdej aktualizacji skilli. Traktować jako szum, mimo że nie wpadł w standardowy filtr.

---

## 5. Weryfikacja: czy sprzężone pliki nadal istnieją?

Sprawdzono obecność w bieżącym drzewie (`git ls-files`).

**Istnieją — analiza jest oparta na żywym kodzie:**

`src/pages/api/proposals.ts` · `src/pages/api/ratings.ts` · `src/components/proposals/RecipeCard.tsx` · `src/components/proposals/types.ts` · `src/lib/spoonacular.ts` · `src/lib/proposals.ts` · `src/lib/history.ts` · `src/lib/config-status.ts` · `src/pages/dashboard.astro` · wszystkie 4 migracje w `supabase/migrations`

**Usunięty — jedyny w całej historii `src/`:**

- `src/pages/api/spike/spoonacular.ts` (2 dotknięcia) — tymczasowy endpoint spike'u retrievalowego, skasowany po zakończeniu badania. Zniknął celowo; **nie opierać na nim analizy.**

**Przeniesione — 20+ plików, wszystkie w warstwie procesu:**

Ukończone zmiany są przenoszone `context/changes/<id>/` → `context/archive/<data>-<id>/` (skill `/10x-archive`). Git liczy to jako zmianę obu ścieżek, więc **rankingi z sekcji 1 zawyżają katalogi `context/changes/*` mniej więcej dwukrotnie**. Przeniesione do tej pory: `spoonacular-retrieval-spike` (19.07), `cold-start-proposals` (20.07), `personalized-proposal-slots` (08.08), `manage-rated-recipes` (09.08). Aktywne pozostają m.in. `testing-harness-proposal-units`, `production-auth-loop`, `testing-storage-diversity-units`.

**Zero przenosin ani zmian nazw w `src/`** — struktura kodu jest stabilna od momentu powstania. Cała turbulencja historii jest w dokumentacji procesu, nie w kodzie.

---

## Podsumowanie mapy

1. Projekt ma **jeden gorący rdzeń**: pętlę propozycji (`lib/proposals` + `lib/spoonacular` + `lib/history` → `api/proposals` → `components/proposals`). To ok. 60% aktywności kodowej.
2. **`src/pages/api` to węzeł sprzężeń** — każda zmiana funkcjonalna przez niego przechodzi. Tu jest największe ryzyko regresji i tu warto trzymać najostrzejsze testy (co repo już robi: `src/pages/api/__tests__/`).
3. **Auth jest domknięty** — zbudowany w Q2, potem prawie nietykany. Niskie ryzyko, niski priorytet uwagi.
4. **Granica providera (`spoonacular.ts`) jest czysta** — sprzężona wąsko, zgodnie z wymogami FR-011 co do izolacji danych dostawcy.
5. **`history.ts` ciągnie za sobą schemat bazy** — jedyne miejsce, gdzie zmiana logiki regularnie wymusza migrację. Punkt podwyższonej ostrożności.
6. **Wspólny mianownik repo to `CLAUDE.md`**, nie plik kodu — projekt jest prowadzony dokumentacyjnie, warstwa `context/` jest liczebnie większa od `src/`.
7. **Ostry pivot 18.07.2026** (retrieval → Spoonacular) dzieli historię na dwie epoki; wszystko sprzed tej daty w obszarze retrievalu jest historycznie nieaktualne.
