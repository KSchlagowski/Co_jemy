# Review follow-ups: manage-rated-recipes impl review (2026-08-09)

## F2 — One-time post-hardening audit of `recipes` (human-run)

The 20260809180000 migration closes future spoofed writes, but rows inserted
before it under the old `with check (true)` policy were never verified, and
S-04's ratings page is the first surface that renders stored rows back to
users. Run both queries once in the Supabase SQL editor (read-only; zero
Spoonacular cost). There is no `created_at` on `recipes`, so the image-host
heuristic stands in for a pre/post-hardening cut.

### 1. Spoof heuristic — rows whose image is not provider-hosted

Genuine rows come from Spoonacular's `complexSearch`, whose `image` URLs live
on `img.spoonacular.com` (or are null). Anything else predates the hardening
and did not come from the provider:

```sql
select spoonacular_id, title, image
from public.recipes
where image is not null
  and image not like 'https://img.spoonacular.com/%';
```

Expected: zero rows. Any hit: verify the title against
`https://spoonacular.com/recipes/x-<spoonacular_id>`; re-proposing the recipe
repairs the row via the service-role upsert, or delete it manually if it has
no ratings referencing it (FK `ratings.spoonacular_id` restricts otherwise).

Caveat: a spoofed *title* with a legitimate image host escapes this heuristic.
Accepted — titles render JSX-escaped, and the pre-hardening user base was the
project owner only.

### 2. Grant-layer residue — what `anon`/`authenticated` still hold on `recipes`

Supabase's default privileges grant broadly on new public tables; the
migration revoked only `insert` from `authenticated`. RLS (enabled, with no
insert/update/delete policies remaining for these roles) is what actually
denies writes, but confirm the grant layer matches expectations:

```sql
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'recipes'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;
```

Expected: `select` for both roles (the embedded ratings-page read needs
`authenticated`'s). If `insert`/`update`/`delete` grants remain, RLS still
blocks them today; optionally revoke them in the already-filed S-05
anon-grant-revoke follow-up migration rather than a new one.

- **Status**: PENDING (human-run)
