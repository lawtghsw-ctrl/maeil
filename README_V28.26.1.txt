v28.26.1 compile hotfix
- app/cases/[id]/page.tsx TypeScript narrowing fix
- handleDelete receives the already-resolved case record as an argument and guards it before access.
- No Supabase migration required beyond v28.26's existing 018 migration.
