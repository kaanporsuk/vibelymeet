# Supabase cloud — verify & deploy (MVP_Vibe / `schdyxcunwcvddlcshwd`)

This repo targets **one** production Supabase project. Always confirm before pushing.

## Expected project

| Field | Value |
|-------|--------|
| **Reference ID** | `schdyxcunwcvddlcshwd` |
| **Dashboard name** | MVP_Vibe |
| **URL** | `https://schdyxcunwcvddlcshwd.supabase.co` |

Source of truth in repo: `supabase/config.toml` → `project_id`.

## Prerequisites

1. [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`supabase --version`).
2. Logged in: `supabase login` (opens browser).
3. This directory linked: from repo root, `supabase link --project-ref schdyxcunwcvddlcshwd` (if `supabase/config.toml` ever drifts).

## Verify connection (read-only)

```bash
cd /path/to/vibelymeet

# Must show ● on schdyxcunwcvddlcshwd
supabase projects list

# Local vs remote migrations (columns should match line-by-line)
supabase migration list --linked

# Remote DB already has all migrations?
supabase db push --linked
# → "Remote database is up to date." when nothing pending

# Deployed Edge Functions on cloud
supabase functions list --project-ref schdyxcunwcvddlcshwd
```

## Deploy database changes

After adding a file under `supabase/migrations/`:

```bash
supabase db push --linked
```

Review SQL in PRs first; this applies pending migrations to **linked** cloud only.

## Deploy Edge Functions

**One function** (typical after code change):

```bash
supabase functions deploy <function-name> --project-ref schdyxcunwcvddlcshwd
```

**All functions** (e.g. after shared `_shared` change or major release):

```bash
./scripts/deploy-supabase-cloud.sh --functions-only
# or full: DB push + all functions
./scripts/deploy-supabase-cloud.sh
```

Secrets (Stripe, Twilio, etc.) are **not** in git — set in Dashboard → Edge Functions → Secrets or `supabase secrets set --project-ref schdyxcunwcvddlcshwd KEY=value`.

## Cursor / MCP

If **user-supabase** MCP is enabled in Cursor, tools such as `list_migrations`, `list_tables`, `execute_sql`, `apply_migration`, and `deploy_edge_function` can read or change the project **that MCP is authenticated to**. Confirm in MCP settings that it points at **`schdyxcunwcvddlcshwd`** so agent actions match this CLI-linked project.

## Safety checklist

- [ ] `supabase projects list` shows linked ref = `schdyxcunwcvddlcshwd`
- [ ] No accidental `supabase link` to another ref (e.g. `wvxzjnfzczepmnlaitdg`)
- [ ] Migrations reviewed before `db push`
- [ ] Function deploys don’t remove required secrets
