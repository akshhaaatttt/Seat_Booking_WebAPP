# SeatBox

Seat booking app: browse events, pick a show, hold seats, book them.

## Run

```bash
npm install
cp server/.env.example server/.env
npm run db:reset
npm run dev
```

<http://localhost:5173> — in a Codespace or container, open the forwarded port 5173 instead.

## Commands

| Command | |
|---|---|
| `npm run dev` | API `:4000` + client `:5173` |
| `npm test` | 38 tests |
| `npm run typecheck` | Both workspaces |
| `npm run build` | Compile + bundle |
| `npm run db:reset` | Recreate and seed the database |
| `npm run db:migrate` | Apply schema only |
| `npm run db:seed` | Reseed only |

Settings: `server/.env` (see `server/.env.example`).

## Dev logins

Seed data only. Not for production.

| | |
|---|---|
| `aria@example.com` | `User@12345` |

## Docs

- [REASONING.md](REASONING.md) — design decisions
- [AI_LOGS.md](AI_LOGS.md) — build log
