---
title: "Niezmiennik domenowy i agregat-strażnik: pętla propozycja → ocena"
created: 2026-08-11
type: refactor-plan
---

# Niezmiennik domenowy i agregat-strażnik

> **To jest PLAN refaktoru, nie implementacja.** Żaden plik produkcyjny nie został zmieniony.
> Wszystkie cytaty `plik:linia` zweryfikowane na stanie repo z 2026-08-11 (branch `master`).

---

## KROK 0 — Kontekst

### Dokumenty źródłowe

| Dokument | Co z niego biorę |
| --- | --- |
| `context/foundation/prd.md` | Vision, Success Criteria, FR-001…FR-011, Business Logic, Non-Goals, §Guardrails |
| `context/foundation/tech-stack.md` | Astro 6 SSR + React 19 + Supabase + Cloudflare Workers |
| `docs/reference/contract-surfaces.md` | Rejestr nazw "load-bearing" — projekt **prowadzi** taki rejestr (KROK 5) |
| `context/foundation/lessons.md` | 5 zarejestrowanych reguł nawracających; trzy z nich dotykają wybranego niezmiennika |
| `CLAUDE.md` | Reguły twarde: FR-011, alias `@/`, brak Node-only API, React compiler |

### Stack i warstwy, w których dziś żyje logika biznesowa

| Warstwa | Pliki | Czy trzyma regułę domenową? |
| --- | --- | --- |
| UI (wyspy React) | `src/components/proposals/RecipeCard.tsx`, `src/components/ratings/RatedRecipesList.tsx` | **Tak** — i w jednym przypadku jest jedynym strażnikiem |
| Strony Astro (SSR) | `src/pages/dashboard.astro`, `src/pages/dashboard/ratings.astro` | Częściowo (odczyt + stan błędu) |
| API (routes) | `src/pages/api/proposals.ts`, `src/pages/api/ratings.ts` | **Tak** — parsowanie, autoryzacja, zapis, kompozycja |
| Silnik slotów (czysta funkcja) | `src/lib/proposals.ts` | **Tak** — reguły slotów 1–4, wykluczenia, dywersyfikacja |
| Dostęp do danych | `src/lib/history.ts` | Częściowo (reguła "≥2 tygodnie" jako filtr zapytania) |
| Provider gateway | `src/lib/spoonacular.ts` | Tak (FR-011 na granicy: tylko dozwolone pola) |
| Persystencja / SQL | `supabase/migrations/*.sql` | **Tak** — RLS, CHECK na `verdict`, FK, widoki agregujące |

Nie ma warstwy domenowej. Logika domenowa jest rozsmarowana po pięciu z siedmiu warstw, a spoiwem jest endpoint `src/pages/api/proposals.ts`, który pełni jednocześnie rolę kontrolera, serwisu aplikacyjnego i repozytorium.

---

## KROK 1 — Zidentyfikowane niezmienniki biznesowe

Lista wyprowadzona z dokumentów **oraz** z kodu. Każdy z cytowanym źródłem.

**I-1. Przepis oceniony 👎 nigdy nie pojawia się w propozycjach.**
Źródło: PRD FR-009 („App permanently excludes recipes rated 👎"), US-01 AC („A recipe rated 👎 never appears in proposals").
Kod: `src/lib/proposals.ts:316-328` (cold start), `src/lib/proposals.ts:390-409` (personalized), `src/lib/history.ts:98-110`.

**I-2. Ocena może istnieć wyłącznie dla przepisu, który aplikacja faktycznie zaproponowała temu użytkownikowi.**
Źródło: PRD Vision („an app that learns from a simple 👍/👎 signal"), Success Criteria/Primary — pętla to `proposals → click → rate → future proposals influenced`. Ocena bez propozycji nie jest zdarzeniem w tej pętli.
Kod: **brak egzekucji**. Jawnie przyznane w komentarzu migracji: `supabase/migrations/20260809120000_personalized_proposal_slots.sql:26` — „possible: the ratings endpoint has no ownership check".

**I-3. Każda propozycja pokazana użytkownikowi jest zarejestrowana jako zdarzenie (`proposals`).**
Źródło: PRD Business Logic („the app issues searches pinned to chosen `cuisine` values **and records which cuisine it asked for**"); FR-008 slot 2 („not proposed in ≥2 weeks") czyta wyłącznie ten log.
Kod: `src/pages/api/proposals.ts:147` — zapis jest *best-effort*, zestaw wraca do użytkownika niezależnie od wyniku.

**I-4. Persystowane są wyłącznie trzy pola przepisu: `id`, `title`, `image`.**
Źródło: PRD FR-011, `docs/reference/contract-surfaces.md:7-14`.
Kod: `src/pages/api/proposals.ts:185-188`; schemat `supabase/migrations/20260720181257_cold_start_proposals.sql:15-20` fizycznie nie ma innych kolumn. **Egzekwowane strukturalnie.**

**I-5. Zestaw propozycji liczy najwyżej 4 pozycje, po jednej na slot.**
Źródło: FR-008, Business Logic („no more than 4 proposals per session").
Kod: `src/lib/proposals.ts:59` (`SET_SIZE = 4`), `src/lib/proposals.ts:412` (tablica 4 slotów).

**I-6. Zimny start pokrywa ≥2 różne kuchnie.**
Źródło: US-02 AC.
Kod: `src/lib/proposals.ts:244-248`, `:335-337` (`degraded` raportuje niedowiezienie, nie blokuje).

**I-7. Jedna ocena na parę (użytkownik, przepis); werdykt ∈ {like, dislike}.**
Kod: `supabase/migrations/20260808120000_rate_recipe.sql:21` (PK), `:18` (CHECK). **Egzekwowane strukturalnie.**

**I-8. Użytkownik widzi i modyfikuje wyłącznie własne oceny.**
Kod: polityki RLS `20260808120000_rate_recipe.sql:38-51`, `20260809180000_manage_rated_recipes.sql`. **Egzekwowane strukturalnie (RLS).**

**I-9. Excerpt nigdy nie zawiera danych makro/kalorii ani wzmianki o dostawcy.**
Źródło: PRD Non-Goals, `contract-surfaces.md:35`.
Kod: `src/lib/proposals.ts:73-85`, `:211-241`. Znany jako niepełny — `lessons.md` reguła 3.

**I-10. Karta zawsze kredytuje wydawcę i linkuje do `sourceUrl` (fallback `spoonacularSourceUrl`).**
Źródło: FR-010 (licencja, nie preferencja).
Kod: `src/components/proposals/RecipeCard.tsx:70-72`. **Egzekwowane tylko po stronie klienta.**

**I-11. Kolejność zapisu: `recipes` przed `ratings` (FK).**
Kod: `supabase/migrations/20260808120000_rate_recipe.sql:15`, obsługa `23503` w `src/pages/api/ratings.ts:19,112`.

---

## KROK 2 — Klasyfikacja i wybór #1

Oceniam trzy osie: **(a) rdzeniowość** dla sensu produktu, **(b) rozsmarowanie** po warstwach, **(c) status egzekucji**.

| # | (a) Rdzeniowość | (b) Rozsmarowanie | (c) Egzekucja |
| --- | --- | --- | --- |
| I-1 👎 wyklucza | Wysoka (US-01 AC, „one absolute rule") | 4 warstwy: UI-brak, API, silnik, DB-read | **Deklarowany + naruszalny** — filtr w pamięci JS, cichy cap PostgREST (`lessons.md` reguła 4) |
| **I-2 ocena ⇐ propozycja** | **Najwyższa** — to *definicja* pętli z Success Criteria | **5 warstw** (UI, API, silnik, 2 widoki SQL, schemat) | **Nieegzekwowany nigdzie. Jedynym strażnikiem jest klient.** |
| I-3 propozycja ⇒ zdarzenie | Wysoka (zasila slot 2 i affinity) | 3 warstwy | **Naruszalny z premedytacją** — `recorded:false`, log-and-continue |
| I-4 tylko 3 pola | Wysoka (kontrakt z dostawcą) | 2 warstwy | Strukturalnie (schemat) — mocny |
| I-5 max 4 sloty | Średnia | 2 warstwy | Kodowo, spójnie |
| I-6 ≥2 kuchnie | Średnia (tylko zimny start) | 2 warstwy | Raportowany (`degraded`), nie egzekwowany — świadomie |
| I-7 / I-8 | Średnia | 1 warstwa | Strukturalnie (PK/CHECK/RLS) — mocny |
| I-9 | Wysoka (non-goal + licencja) | 1 warstwa | Wzorcami, znany-niepełny |
| I-10 | Wysoka (licencja) | 1 warstwa | **Tylko klient** — ale to reguła *prezentacji*, nie stanu |
| I-11 | Niska (techniczna) | 2 warstwy | FK — mocny |

### Wybór: **I-2 — „Ocena może istnieć wyłącznie dla przepisu, który aplikacja faktycznie zaproponowała temu użytkownikowi"**

**Dlaczego najbardziej rdzeniowy.** PRD/Success Criteria/Primary definiuje sukces jako jeden zamknięty łańcuch: `requests proposals → sees suggestions → clicks → returns and rates → future proposals influenced`. I-2 jest krawędzią `sees → rates` tego łańcucha. Bez niego „profil smaku" przestaje być zapisem tego, co użytkownikowi *pokazano i co ugotował* — a staje się dowolnym zbiorem identyfikatorów. Vision mówi wprost: przewaga produktu polega na tym, że uczy się z sygnału z **własnych** propozycji; oceny spoza pętli to szum, który psuje dokładnie ten mechanizm.

**Dlaczego najsłabiej egzekwowany.** I-4, I-7, I-8, I-11 mają wsparcie strukturalne w bazie. I-1 i I-3 są przynajmniej *jawnie zaimplementowane* (choć dziurawo). I-2 nie jest zaimplementowany **w ogóle** — na żadnej warstwie. Jedynym powodem, dla którego dziś zwykle zachodzi, jest to, że przycisk 👍 renderuje się wyłącznie na karcie, którą serwer właśnie wysłał. To jest egzekucja przez UI, czyli brak egzekucji.

**Dlaczego wybór I-2 pociąga za sobą I-1 i I-3.** I-2 jest korzeniem: jeśli ocena musi wynikać z zarejestrowanej propozycji, to (i) rejestracja propozycji nie może być best-effort (I-3 przestaje być opcjonalny), a (ii) zbiór wykluczeń 👎 przestaje być listą w pamięci JS i staje się pochodną stanu agregatu (I-1 zyskuje jedno miejsce egzekucji). Naprawa I-2 domyka trzy najsłabsze pozycje z tabeli jednym agregatem.

---

## KROK 3 — Diagnoza niezmiennika I-2

### 3.1 Gdzie dziś „żyje" reguła

**(A) Warstwa API — zapis oceny. Zero preconditions.**

`src/pages/api/ratings.ts:101-109`:
```ts
const { error } = await supabase.from("ratings").upsert(
  { user_id: user.id, spoonacular_id: payload.spoonacularId, verdict: payload.verdict, rated_at: ... },
  { onConflict: "user_id,spoonacular_id" },
);
```
Walidacja przed tym zapisem to `parsePayload` (`src/pages/api/ratings.ts:44-56`): sprawdza **typ** (`Number.isInteger`, `value > 0`) i **wartość werdyktu**. Nie sprawdza niczego domenowego. Endpoint nie odpytuje `proposals` ani razu.

**(B) Warstwa persystencji — FK wskazuje na zły zbiór.**

`supabase/migrations/20260808120000_rate_recipe.sql:15`:
```sql
spoonacular_id bigint not null references public.recipes (spoonacular_id),
```
`recipes` to **współdzielony katalog wszystkich przepisów pokazanych komukolwiek** (`20260720181257_cold_start_proposals.sql:15-20`, polityka select `using (true)`). FK egzekwuje więc „przepis znany aplikacji", a nie „przepis zaproponowany *tobie*". Różnica między tymi dwoma zbiorami rośnie z każdym użytkownikiem. Rejestracja jest otwarta (PRD §Access Control), a klucz anon jest publiczny — więc dowolne konto może wywołać `POST /api/ratings` przez `fetch` z dowolnym `spoonacularId` obecnym w katalogu i dostanie `200`.

**(C) Warstwa SQL — widoki *wiedzą*, że reguła jest łamana, i milcząco kompensują.**

`supabase/migrations/20260809120000_personalized_proposal_slots.sql:23-27`:
```
-- "last proposed at" is max(proposed_at) over the event log — NULL when a like has no
-- recorded proposal event at all (possible: the ratings endpoint has no ownership check,
-- and recorded:false sets leave gaps).
```
Widok `liked_recipe_history` robi `left join` na `proposals` (`:32-43`), a `getStaleLikes` traktuje `NULL` jako **maksymalnie stary** i sortuje takie wiersze **pierwsze** (`src/lib/history.ts:78-79`). Efekt domenowy: ocena, która nigdy nie wynikała z propozycji, ma **priorytet** w slocie 2. Naruszenie niezmiennika nie tylko przechodzi — jest premiowane.

Drugi widok, `cuisine_affinity` (`:47-63`), kompensuje odwrotnie: `inner join` + `requested_cuisine is not null` sprawia, że ocena bez propozycji po prostu **znika** z profilu smaku. Dwa widoki, dwie różne (i przeciwstawne) interpretacje tego samego naruszenia — to jest definicja niespójnej egzekucji.

**(D) Warstwa UI — jedyny faktyczny strażnik.**

`src/components/proposals/RecipeCard.tsx:48-52` wysyła `proposal.id` z karty, którą serwer właśnie zwrócił. `src/components/ratings/RatedRecipesList.tsx:100-104` wysyła `rating.spoonacularId` z wiersza wczytanego SSR-em. Oba komponenty *strukturalnie* nie potrafią wysłać niezaproponowanego id — i to jest cała ochrona, jaką ma ten niezmiennik. Wystarczy `curl` z ciasteczkiem sesji, żeby ją ominąć.

**(E) Warstwa API — propozycje. Błąd „połknięty".**

`src/pages/api/proposals.ts:147-149`:
```ts
const recorded = await persist(supabase, user.id, proposals);
return json({ ok: true, mode, proposals: payloads, recorded, degraded }, 200);
```
`persist` (`:162-209`) zwraca `false` przy braku klienta admina (`:176-183`), przy błędzie upsertu `recipes` (`:189-193`) i przy błędzie insertu `proposals` (`:203-207`) — za każdym razem `console.error` + `return false`. Zestaw i tak wraca ze statusem `200`.

To jest **log-and-continue w miejscu, które produkuje przesłankę niezmiennika I-2**. Trzy konsekwencje, wszystkie ciche:
1. Użytkownik widzi przepisy, których „nie widział" według bazy → jego kolejna ocena staje się (według I-2) nielegalna, mimo że jest w pełni prawidłowa.
2. Przy `recorded:false` na etapie `recipes` kolejna ocena kończy się `unknown_recipe` (404) — komunikat `„We couldn't match this recipe"` (`RecipeCard.tsx:18`) obwinia dane, podczas gdy przyczyną jest nasz nieudany zapis.
3. Zapis nie jest atomowy: `recipes` idzie klientem service-role, `proposals` klientem sesyjnym (`:185`, `:195`) — dwa osobne połączenia, dwie transakcje. Sukces pierwszego i porażka drugiego zostawia stan trwale niespójny.

**(F) Warstwa silnika — reguła pochodna (I-1) też nie ma jednego miejsca.**

`src/lib/proposals.ts:390-396` buduje `ratedIds` z `dislikedIds + recentLikes + staleLikes` w pamięci; `src/lib/proposals.ts:316` robi to samo, ale węziej, dla zimnego startu. Wykluczenie jest więc zaimplementowane **dwa razy, w dwóch różnych zakresach**, na danych, których kompletności `src/lib/history.ts:98-110` nie gwarantuje (cap PostgREST — `lessons.md` reguła 4).

### 3.2 Podsumowanie diagnozy

| Warstwa | Status I-2 |
| --- | --- |
| UI (React) | Jedyny faktyczny strażnik — omijalny zwykłym `fetch` |
| API `ratings.ts` | **Brak jakiejkolwiek weryfikacji** |
| API `proposals.ts` | Produkuje przesłankę best-effort; błąd połknięty (`recorded:false`, HTTP 200) |
| Silnik `proposals.ts` | Nie zna reguły; konsumuje jej skutki |
| `history.ts` | Nie zna reguły; `NULL` po `left join` czyta jako „maksymalnie stary" |
| Widoki SQL | Dwie **przeciwstawne** kompensacje naruszenia (premiuje / ukrywa) |
| Schemat (FK) | Egzekwuje słabszy warunek („znany katalogowi"), nie właściwy („zaproponowany tobie") |

---

## KROK 4 — Projekt agregatu-strażnika

### 4.1 Granica agregatu

**Agregat: `TasteProfile`. Root identity: `userId`.**

Uzasadnienie granicy: I-2 wiąże trzy fakty należące do **jednego** użytkownika — co mu pokazano (`proposals`), co ocenił (`ratings`) i co z tego wynika dla następnego zestawu. Wszystkie trzy zmieniają się wspólnie i muszą być spójne w jednym momencie. Katalog `recipes` **nie należy** do agregatu: jest współdzielony między użytkownikami i podlega odrębnym regułom (FR-011, `lessons.md` reguła 2) — wchodzi do modelu jako `RecipeRef` (value object) referencjonowany po id.

```
TasteProfile (root, id = userId)
├── ProposalEvent  (entity: spoonacularId, requestedCuisine|null, proposedAt)
├── Rating         (entity: spoonacularId, verdict, ratedAt)
└── RecipeRef      (VO: spoonacularId, title, image)   ← referencja poza agregat
```

**Niezmienniki utrzymywane przez root** (i tylko przez niego):

- **INV-PROPOSED-FIRST (I-2)**: `∀ r ∈ ratings: ∃ e ∈ proposalEvents, e.spoonacularId = r.spoonacularId`
- **INV-NO-DISLIKED (I-1)**: żaden zestaw zwrócony przez root nie zawiera id o werdykcie `dislike`
- **INV-SET-RECORDED (I-3)**: zestaw jest zwracany dopiero po utrwaleniu jego `ProposalEvent`-ów
- **INV-SET-SIZE (I-5)**: `|set| ≤ 4`

### 4.2 Nowy moduł: `src/domain/taste-profile.ts` (czysty, bez I/O)

```ts
export class RecipeNotProposedError extends Error {
  readonly code = "recipe_not_proposed";
  constructor(readonly spoonacularId: number) { super(`recipe ${spoonacularId} was never proposed to this user`); }
}
export class RecipeDislikedError extends Error { readonly code = "recipe_disliked"; }
export class ProposalSetTooLargeError extends Error { readonly code = "set_too_large"; }
export class RatingNotFoundError extends Error { readonly code = "rating_not_found"; }

export class TasteProfile {
  private constructor(
    readonly userId: string,
    private readonly proposedIds: ReadonlySet<number>,
    private readonly ratings: ReadonlyMap<number, Rating>,
    private readonly staleLikes: readonly StaleLike[],
    private readonly topCuisine: string | null,
  ) {}

  static rehydrate(snapshot: TasteProfileSnapshot): TasteProfile;

  // ---- zapytania domenowe (zastępują rozsiane filtry w src/lib/proposals.ts) ----
  excludedIds(): ReadonlySet<number>;   // 👎 ∪ (już ocenione — nie mogą udawać "nowych")
  recentLikes(): readonly Rating[];
  isColdStart(): boolean;               // recentLikes().length === 0
  slotPlan(now: Date): SlotPlan;        // które sloty aktywne + jakie kuchnie przypiąć

  // ---- metody mutujące: preconditions → zdarzenia, nigdy cichy zapis ----

  /**
   * INV-SET-SIZE + INV-NO-DISLIKED. Wejście: kandydaci z gateway'a (dane, nie decyzje).
   * Wyjście: zdarzenia do utrwalenia. NIE zapisuje — to robi repozytorium, w jednej transakcji.
   * Rzuca, gdy kandydaci naruszają wykluczenie — fail-fast zamiast cichego przefiltrowania,
   * bo obecność 👎 w puli oznacza, że wykluczenie zawiodło warstwę wcześniej.
   */
  planProposalSet(candidates: readonly ScoredCandidate[], now: Date): ProposalSetPlanned;
  //   precondition: candidates.every(c => !this.ratings.get(c.id)?.isDislike())  → RecipeDislikedError
  //   postcondition: result.events.length === result.proposals.length ≤ 4

  /**
   * INV-PROPOSED-FIRST. Jedyne miejsce w systemie, w którym powstaje ocena.
   */
  rate(spoonacularId: number, verdict: Verdict, now: Date): RatingRecorded;
  //   precondition: this.proposedIds.has(spoonacularId)  → RecipeNotProposedError
  //   (brak "log i jedź dalej": nielegalna ocena NIE trafia do bazy)

  /** FR-007. Idempotencja pozostaje decyzją produktową — ale zwraca wynik, nie zgaduje. */
  removeRating(spoonacularId: number): RatingRemoved | RatingAlreadyAbsent;
}
```

Pseudokod dwóch metod krytycznych:

```
rate(id, verdict, now):
    if not proposedIds.has(id):
        throw RecipeNotProposedError(id)          # ← przesunięcie egzekucji z klienta na serwer
    existing = ratings.get(id)
    if existing and existing.verdict == verdict and existing.ratedAt == now:
        return RatingRecorded(id, verdict, now)   # idempotentny no-op
    return RatingRecorded(id, verdict, now)       # rated_at odświeżane także przy flipie (FR-006)

planProposalSet(candidates, now):
    for c in candidates:
        if ratings.get(c.id)?.verdict == 'dislike':
            throw RecipeDislikedError(c.id)       # FR-009 — fail-fast, nie ciche odsiewanie
    chosen = take(dedupe(candidates), 4)          # INV-SET-SIZE
    events = [ProposalEvent(userId, c.id, c.requestedCuisine, now) for c in chosen]
    return ProposalSetPlanned(proposals=chosen, events=events)
```

`src/lib/proposals.ts` **pozostaje** — ale traci status decydenta. Redukuje się do dostawcy kandydatów (`sanitizeSummary`, `pickCuisinePair`, interleave, kształt wywołań do providera) i przestaje samodzielnie stosować wykluczenia w dwóch miejscach.

### 4.3 Repozytorium: `src/infra/taste-profile-repository.ts`

Zastępuje rozsiane zapytania z `src/lib/history.ts` (4 niezależne selecty składane w `Promise.all` w `src/pages/api/proposals.ts:106-111`) jednym ładowaniem agregatu i jednym zapisem.

```ts
export interface TasteProfileRepository {
  /** Jedno RPC → jeden spójny snapshot. Zastępuje getRecentLikes/getStaleLikes/getDislikedIds/getTopCuisine. */
  load(userId: string, staleCutoff: Date): Promise<TasteProfile>;

  /** INV-SET-RECORDED: recipes-upsert + proposals-insert w JEDNEJ transakcji. */
  saveProposalSet(plan: ProposalSetPlanned): Promise<void>;   // rzuca — brak `recorded:false`

  /** INV-PROPOSED-FIRST po stronie DB (backstop). */
  saveRating(userId: string, event: RatingRecorded): Promise<void>;
  removeRating(userId: string, spoonacularId: number): Promise<boolean>;
}
```

**Atomowość.** PostgREST nie ma transakcji wielo-zapytaniowych, więc atomowość musi zejść do jednej funkcji SQL. Nowa migracja:

```sql
-- SECURITY DEFINER, bo upsert na `recipes` jest service-role-only od migracji 20260809180000.
-- Pierwsza instrukcja w ciele: weryfikacja tożsamości, żeby DEFINER nie stał się luką.
create or replace function public.record_proposal_set(
  p_recipes  jsonb,   -- [{spoonacular_id, title, image}]  ← FR-011: dokładnie 3 pola
  p_events   jsonb    -- [{spoonacular_id, requested_cuisine}]
) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  insert into public.recipes (spoonacular_id, title, image)
  select (e->>'spoonacular_id')::bigint, e->>'title', e->>'image'
  from jsonb_array_elements(p_recipes) e
  on conflict (spoonacular_id) do update
     set title = excluded.title, image = excluded.image;

  insert into public.proposals (user_id, spoonacular_id, requested_cuisine)
  select v_user, (e->>'spoonacular_id')::bigint, e->>'requested_cuisine'
  from jsonb_array_elements(p_events) e;
end $$;
```
Jedna transakcja: albo obie wstawki, albo żadna. Wywołanie z Workers: `supabase.rpc("record_proposal_set", {...})`. Znika potrzeba klienta service-role w ścieżce propozycji (`src/pages/api/proposals.ts:176-183`) i znika okno „recipes zapisane, proposals nie".

**Backstop niezmiennika w bazie** (obrona w głąb — agregat pozostaje miejscem *podstawowym*):

```sql
create or replace function public.assert_proposed_before_rating() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from public.proposals p
    where p.user_id = new.user_id and p.spoonacular_id = new.spoonacular_id
  ) then
    raise exception 'recipe % was never proposed to user %', new.spoonacular_id, new.user_id
      using errcode = '23514';   -- check_violation → mapowane na recipe_not_proposed
  end if;
  return new;
end $$;

create trigger ratings_require_proposal
  before insert or update on public.ratings
  for each row execute function public.assert_proposed_before_rating();
```
Indeks `proposals_user_id_spoonacular_id_proposed_at_idx` (już istnieje, `20260809120000:...`) obsługuje ten `exists` bez dodatkowego kosztu.

> **Uwaga migracyjna (wymaga decyzji użytkownika, nie blokuje planu).** Trigger odrzuci wsteczne dane: oceny bez zdarzenia propozycji, powstałe przez `recorded:false` (`src/pages/api/proposals.ts:203-207`). Fazy poniżej zakładają backfill zdarzeń syntetycznych (`requested_cuisine = null`, `proposed_at = ratings.rated_at`) — wariant zachowawczy, który nie kasuje historii ocen (PRD §Guardrails: utrata ocen niszczy pętlę wartości).

### 4.4 Cienkie route'y

`src/pages/api/ratings.ts` — po refaktorze:

```ts
export const POST: APIRoute = async (context) => {
  const user = context.locals.user;                       // 1. auth
  if (!user) return fail("unauthenticated");
  const payload = parsePayload(await readJson(context));  // 2. parse (bez zmian)
  if (!payload) return fail("invalid_payload");

  try {                                                   // 3. agregat decyduje
    const profile = await repo.load(user.id, staleCutoff());
    const event = profile.rate(payload.spoonacularId, payload.verdict, new Date());
    await repo.saveRating(user.id, event);
    return json({ ok: true, verdict: event.verdict }, 200);
  } catch (e) {                                           // 4. mapowanie błędu domenowego
    return mapDomainError(e);                             //    RecipeNotProposedError → 409 recipe_not_proposed
  }
};
```

Mapowanie błędów domenowych na odpowiedzi (jedno miejsce, `src/pages/api/_domain-errors.ts`):

| Błąd domenowy | Status | `reason` |
| --- | --- | --- |
| `RecipeNotProposedError` | 409 | `recipe_not_proposed` |
| `RecipeDislikedError` | 409 | `recipe_disliked` |
| `ProposalSetTooLargeError` | 500 | `internal_error` (błąd programisty, nie użytkownika) |
| `RatingNotFoundError` | 200 | `{ ok: true, deleted: false }` — idempotencja FR-007 zachowana |
| repo/DB throw | 500 | `write_failed` |

Zmiana posture'u w `src/pages/api/proposals.ts`: `recorded` znika z odpowiedzi. Zapis albo się udaje, albo endpoint zwraca `502 set_not_recorded` z jawnym komunikatem, że punkt limitu został wydany a zestaw nie został utrwalony. To jest jedyne miejsce, gdzie plan świadomie **pogarsza** dostępność na rzecz spójności — uzasadnienie: PRD §Guardrails stawia trwałość historii wyżej niż pojedynczy zestaw, a dzisiejsze `recorded:false` produkuje przepisy, których nie da się później ocenić (404 `unknown_recipe`), czyli i tak psuje sesję — tylko później i myląco.

---

## KROK 5 — Before/after, plan faz, testy

### 5.1 Before / after — każde dzisiejsze miejsce reguły

| # | Miejsce | Before | After |
| --- | --- | --- | --- |
| 1 | `src/pages/api/ratings.ts:101-109` | `upsert` bez preconditions | `profile.rate(...)`; nielegalne id → `RecipeNotProposedError` → 409, **bez zapisu** |
| 2 | `src/pages/api/ratings.ts:112` | `23503` → `unknown_recipe` (404) | `23503` nadal 404; nowe `23514` z triggera → 409 `recipe_not_proposed` |
| 3 | `src/pages/api/proposals.ts:147-149` | `recorded = await persist(...)`; 200 mimo porażki | `await repo.saveProposalSet(plan)`; porażka → 502 `set_not_recorded` (fail-fast) |
| 4 | `src/pages/api/proposals.ts:162-209` | 2 klienty, 2 transakcje, 3 ścieżki `return false` | jedno RPC `record_proposal_set`, jedna transakcja, brak ścieżki „połknij" |
| 5 | `src/pages/api/proposals.ts:176-183` | zależność od `SUPABASE_SERVICE_ROLE_KEY` w ścieżce żądania | `SECURITY DEFINER` w RPC; klient service-role znika z tej ścieżki |
| 6 | `src/pages/api/proposals.ts:106-111` | 4 niezależne selecty w `Promise.all` | `repo.load(userId, cutoff)` — jeden spójny snapshot |
| 7 | `src/lib/proposals.ts:316-328` | wykluczenie 👎 (zimny start) inline | `profile.excludedIds()` — jedno źródło |
| 8 | `src/lib/proposals.ts:390-409` | wykluczenie 👎+ocenione (personalized) inline, drugi raz | jw. — druga kopia usunięta |
| 9 | `src/lib/history.ts:46-185` | 5 funkcji-zapytań jako publiczne API domeny | prywatne detale `TasteProfileRepository`; `getRatedRecipes` zostaje (czysty odczyt FR-005) |
| 10 | `20260809120000:32-43` (`liked_recipe_history`) | `left join` + `NULL` = „maksymalnie stary" (premiuje naruszenie) | `NULL` staje się niemożliwe (trigger); `left join` → `join`, `nullsFirst` znika |
| 11 | `20260809120000:47-63` (`cuisine_affinity`) | `inner join` ukrywa naruszenie | bez zmian semantycznych — po triggerze obie interpretacje się zbiegają |
| 12 | `20260808120000_rate_recipe.sql:15` | FK → `recipes` (katalog globalny) | FK zostaje + trigger `ratings_require_proposal` (właściwy zakres) |
| 13 | `RecipeCard.tsx:16-21`, `RatedRecipesList.tsx:17-22` | brak copy dla `recipe_not_proposed` | nowy wpis w mapie reason→copy (obie wyspy) |
| 14 | `RecipeCard.tsx:48-52` | UI = jedyny strażnik | UI = wygoda; egzekucja po stronie serwera |

### 5.2 Plan faz

Projekt ma runner testów (`vitest`, `npm test`) i istniejące suity jednostkowe dla dokładnie tych modułów (`src/lib/__tests__/proposals.test.ts`, `src/pages/api/__tests__/ratings.test.ts`), więc fazy czysto logiczne idą **test-first**. Fazy migracyjne (SQL) — nie: weryfikacja przez migrację na lokalnym Supabase + E2E.

| Faza | Zakres | Test-first? |
| --- | --- | --- |
| **F1** | `src/domain/taste-profile.ts` + błędy domenowe. Czysta logika, zero I/O. | **Tak** — pełna lista przypadków z §5.3 |
| **F2** | Migracja `record_proposal_set` (RPC). `persist()` → jedno wywołanie RPC. `recorded` znika z kontraktu wire. | Nie (SQL) — testy endpointu aktualizowane po |
| **F3** | Backfill: syntetyczne `ProposalEvent` dla ocen bez zdarzenia (`requested_cuisine = null`, `proposed_at = rated_at`). **Musi poprzedzać F4.** | Nie — skrypt weryfikacyjny liczący osierocone oceny przed/po |
| **F4** | Trigger `ratings_require_proposal` + mapowanie `23514` → 409. | Nie (SQL); testy endpointu w F5 |
| **F5** | `TasteProfileRepository` + przepisanie `ratings.ts` i `proposals.ts` na cienkie route'y. `src/lib/history.ts` schodzi za repozytorium. | **Tak** — testy endpointów rozszerzone o ścieżkę 409 |
| **F6** | `src/lib/proposals.ts` traci wykluczenia (dwie kopie) na rzecz `profile.excludedIds()`. Silnik = dostawca kandydatów. | **Tak** — testy silnika przechodzą na wstrzykiwany zbiór wykluczeń |
| **F7** | `liked_recipe_history`: `left join` → `join`, usunięcie `nullsFirst` w `history.ts:79`. | Nie (SQL) — dopiero po F4, bo dopiero wtedy `NULL` jest niemożliwy |
| **F8** | Copy w UI dla `recipe_not_proposed` (obie wyspy) + E2E na ścieżkę 409. | E2E: `e2e/` (Playwright) |

Kolejność F3 → F4 jest twarda: odwrotna wywala trigger na danych historycznych.

### 5.3 Przypadki testowe niezmiennika

**Operacje legalne (muszą przejść):**
1. Ocena 👍 przepisu obecnego w `proposedIds` → `RatingRecorded`, zapis wykonany.
2. Ocena 👎 przepisu zaproponowanego → `RatingRecorded`, przepis trafia do `excludedIds()`.
3. Flip 👍 → 👎 na już ocenionym, zaproponowanym przepisie → `rated_at` odświeżone (FR-006).
4. `removeRating` istniejącej oceny → `RatingRemoved`; przepis znika z `excludedIds()` (FR-007 + FR-009 reset).
5. `removeRating` nieistniejącej oceny → `RatingAlreadyAbsent` → HTTP 200 `deleted: false` (idempotencja zachowana).
6. `planProposalSet` z 4 kandydatami bez ocen → 4 propozycje, 4 zdarzenia.
7. `planProposalSet` z 2 kandydatami → 2 propozycje („up to 4", FR-008).
8. Ocena przepisu zaproponowanego w **poprzedniej sesji** (nie w bieżącym zestawie) → legalna; `proposedIds` to cała historia, nie ostatni zestaw.

**Operacje nielegalne (muszą rzucić / zwrócić 409, bez zapisu):**
9. `rate(id)` dla id **nieobecnego** w `proposedIds` → `RecipeNotProposedError`; asercja: repozytorium **nie** zostało wywołane.
10. `rate(id)` dla id zaproponowanego **innemu użytkownikowi** (obecnego w `recipes`) → `RecipeNotProposedError` — to jest dokładnie dziura z `20260809120000:26`.
11. `POST /api/ratings` (integracyjnie) z id z globalnego katalogu → 409 `recipe_not_proposed`, brak wiersza w `ratings`.
12. `planProposalSet` z kandydatem ocenionym 👎 → `RecipeDislikedError` (FR-009 fail-fast, nie ciche odsianie).
13. `planProposalSet` z 5+ kandydatami po dedupie → `ProposalSetTooLargeError` (INV-SET-SIZE).
14. `saveProposalSet` z błędem drugiej wstawki → **żadna** wstawka nie utrwalona (asercja atomowości na prawdziwym Postgresie, nie na mocku).
15. Endpoint propozycji przy porażce zapisu → 502 `set_not_recorded`, **nie** 200 z `recorded:false`.
16. Trigger DB: bezpośredni `insert into ratings` (z pominięciem aplikacji, klientem sesyjnym przez PostgREST) dla niezaproponowanego id → `23514`.

**Regresja niezmienników sąsiednich (nie mogą się zepsuć):**
17. FR-011: `record_proposal_set` zapisuje dokładnie `spoonacular_id, title, image` — asercja na zbiorze kluczy (uwaga `lessons.md` reguła 5: to nie zastępuje zawężonego typu na granicy).
18. Kształt kosztowy: personalized = 2 × `searchRecipes` + ≤2 × `getRecipeById`; cold start = 2 × `searchRecipes` (`contract-surfaces.md:48` — refaktor nie może dodać wywołania).
19. RLS: `repo.load(userA)` nigdy nie zwraca zdarzeń ani ocen userB.

### 5.4 Nowe nazwy „load-bearing" do rejestracji w `docs/reference/contract-surfaces.md`

| Nazwa | Rodzaj | Kontrakt |
| --- | --- | --- |
| `TasteProfile` | agregat (root) | Jedyne miejsce egzekwowania INV-PROPOSED-FIRST, INV-NO-DISLIKED, INV-SET-SIZE |
| `TasteProfile.rate()` | metoda domenowa | Jedyna ścieżka powstania oceny w systemie |
| `TasteProfile.planProposalSet()` | metoda domenowa | Jedyna ścieżka powstania zdarzenia propozycji |
| `TasteProfile.excludedIds()` | zapytanie domenowe | Jedyne źródło zbioru wykluczeń FR-009 |
| `RecipeNotProposedError` | błąd domenowy | Nazwana odmowa I-2 → 409 `recipe_not_proposed` |
| `RecipeDislikedError` | błąd domenowy | Nazwana odmowa FR-009 → 409 `recipe_disliked` |
| `TasteProfileRepository` | port | `load` / `saveProposalSet` / `saveRating` / `removeRating`; jedyny właściciel tekstu zapytań |
| `public.record_proposal_set(jsonb, jsonb)` | RPC (SQL) | Atomowy zapis recipes+proposals; `SECURITY DEFINER` z wewnętrzną weryfikacją `auth.uid()`; zapisuje wyłącznie 3 pola FR-011 |
| `public.assert_proposed_before_rating()` / `ratings_require_proposal` | trigger (SQL) | Backstop I-2; `errcode 23514` → 409 |
| `recipe_not_proposed` | kod wire (`reason`) | Nowy wariant w `RatingResponse`; wymaga wpisu copy w obu wyspach |
| `set_not_recorded` | kod wire (`reason`) | Zastępuje `recorded: false` w kontrakcie `/api/proposals` |

Do rejestru trafia też **usunięcie**: pole `recorded` znika z odpowiedzi `/api/proposals` — to zmiana łamiąca kontrakt wire, konsumowana dziś przez `src/components/proposals/types.ts`.

---

## Podsumowanie

Przeanalizowałem jedenaście niezmienników wyprowadzonych z PRD i z kodu, i wybrałem ten, który jest jednocześnie najbardziej rdzeniowy i najsłabiej egzekwowany: **ocena może powstać wyłącznie dla przepisu, który aplikacja faktycznie zaproponowała temu użytkownikowi**. Jest rdzeniowy, bo stanowi krawędź `sees → rates` pętli, którą PRD definiuje jako kryterium sukcesu produktu; jest najsłabszy, bo nie jest egzekwowany na żadnej warstwie — jedynym strażnikiem jest UI, a `supabase/migrations/20260809120000_personalized_proposal_slots.sql:26` sam przyznaje brak sprawdzenia własności. Diagnoza pokazała trzy niezależne wady: `src/pages/api/ratings.ts:101` zapisuje ocenę bez żadnego warunku wstępnego, klucz obcy celuje w globalny katalog `recipes` zamiast w historię propozycji użytkownika, a dwa widoki SQL kompensują naruszenie w przeciwstawny sposób — `liked_recipe_history` **premiuje** ocenę bez propozycji w slocie 2, a `cuisine_affinity` ją ukrywa. Osobno `src/pages/api/proposals.ts:147` produkuje przesłankę tego niezmiennika w trybie best-effort (`recorded:false` przy statusie 200), co jest klasycznym „loguj i jedź dalej" w miejscu, które musi być atomowe. Projekt wprowadza agregat `TasteProfile` (root = `userId`) jako jedyne miejsce egzekucji: metoda `rate()` z warunkiem wstępnym rzucającym `RecipeNotProposedError`, `planProposalSet()` egzekwująca FR-009 i limit czterech slotów, oraz `TasteProfileRepository` z atomowym RPC `record_proposal_set` i triggerem `ratings_require_proposal` jako obroną w głąb po stronie bazy. Plan ma osiem faz, z których cztery idą test-first na istniejącym runnerze `vitest`, a kolejność backfill (F3) przed triggerem (F4) jest twarda, bo odwrotna wywraca się na danych historycznych. Do rejestru kontraktów dopisuję jedenaście nowych nazw oraz jedno usunięcie łamiące kontrakt wire — pole `recorded` znikające z `/api/proposals`.

Dokument zapisany w `context/domain/02-invariant-aggregate-refactor.md`; kod produkcyjny nietknięty.
