# Seed files by league type

`supabase/config.toml` loads `./seed.sql` first, then every `./seeds/*.sql` in name order, on `pnpm db:reset`
(and the first `pnpm db:start`). Local only: none of it runs in production.

Each league type adds its own file here (for example `playoff.sql`, `squares.sql`, `survivor.sql`) instead of
editing `seed.sql`, so work on different types never collides. A file may use the accounts `seed.sql` creates
(see the comments at its top); give every row it inserts a fixed id so the file can be read and reset safely.
