# `vibelymeet-rehearsal-artifact/` (gitignored)

The repository root may contain a directory `vibelymeet-rehearsal-artifact/` (see `.gitignore`: “Local rehearsal/worktree artifacts”). When present, it is a **frozen older web snapshot** (~tens of MB), not the live app.

- **Do not** develop against or import from it.
- **Do not** remove without confirming no local scripts or docs depend on the path.
- Production source of truth: repo root `src/`, `apps/mobile/`, `supabase/`.
