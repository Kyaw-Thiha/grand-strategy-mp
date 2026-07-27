# Testing and Operations

The game server is a Node/TypeScript service whose tests are grouped by gameplay area. Its default test command selects the smallest relevant lane from the repository diff; a separate command always runs the complete suite.

# Details

## Local operation

Run `npm start` from `game-server/` to host Colyseus locally on port 2567 by default. The server requires a `JWT_SECRET` matching the API server so it can verify player tokens. It also needs `INTERNAL_SECRET` and `API_SERVER_URL` to report game-end events to the API server.

The server raises Colyseus' schema encoder buffer to 256 KB and accepts WebSocket payloads up to 1 MB. These limits support the current replicated game state and long movement orders.

## Test lanes

| Command                 | Coverage                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| `npm test`              | Selects affected lanes from git changes using `test-lanes.json`.   |
| `npm run test:full`     | Runs all server tests unconditionally.                             |
| `npm run test:core`     | Room lifecycle, authentication, and core room behavior.            |
| `npm run test:movement` | Movement behavior.                                                 |
| `npm run test:tactical` | Ground tactical grid, combat, perks, and terrain work.             |
| `npm run test:air`      | Air-wing schema, lifecycle, paths, detection, combat, bombing, and visibility/AOI filtering. |
| `npm run build`         | Type-checks and produces the TypeScript build.                     |

Schema, map-loader, and supply changes are shared dependencies and cause the changed-test runner to use the full suite. A source file outside the configured lanes also falls back to the full suite.

`game-server/package.json` defines the lane commands used by this workflow:

```json
"test": "NODE_ENV=test tsx scripts/test-changed.ts",
"test:full": "time NODE_ENV=test mocha 'test/*.test.ts'",
"test:air": "NODE_ENV=test mocha --grep 'lane:air-combat' 'test/12*.test.ts'",
"test:tactical": "NODE_ENV=test mocha --grep 'lane:tactical' 'test/6*.test.ts'"
```

The default command chooses from the changed-file mapping; the full command deliberately bypasses that selection.

## Adding a server test

Use `getTestPort()` from `test/helpers.ts` when booting a test room so parallel test workers do not collide. Add the file to the appropriate lane in `test-lanes.json` and prefix its top-level `describe()` with `lane:<name> | ` so targeted commands include it.

## Operational limitations

`src/app.config.ts` still includes template-era `/api/hello`, `/hi`, and `/monitor` routes. They are operational/development surfaces rather than game API contracts.

# Related Notes

- [[game-server/index|Game Server]]
- [[game-server/overview|Role and Boundaries]]
- [[game-server/room-lifecycle|Room Lifecycle]]
