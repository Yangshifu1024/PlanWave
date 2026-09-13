# AGENTS.md — PlanWave

Offline-first, multi-device eventually-consistent to-do app. One Rust→WASM data layer + one React UI serve all six platforms (Windows / macOS / Linux / Android / iOS / Web). Full-Rust stack: Axum server + Tauri 2 shell, MySQL persistence. Code comments and UI strings are hardcoded Chinese (no i18n framework); code identifiers, docs like this file, and git history are English.

## Repository structure

| Path | Role |
|---|---|
| `crates/sync-core` | The sync kernel (project soul). Pure logic, zero IO: op model, field-level merge, total-order replay by server `seq`, Lamport clocks. Storage/transport are traits. |
| `crates/sync-wasm` | wasm-bindgen bindings — the only client data-layer implementation: IndexedDB storage + HTTP transport. Build output goes to `apps/web/src/wasm/pkg` (gitignored). |
| `apps/server` | Axum backend: `/auth/*`, `/sync/push|pull|snapshot`, `/health`. `Store` trait with two impls: no `DATABASE_URL` ⇒ in-memory store (local dev / tests / E2E); otherwise MySQL via sqlx. |
| `apps/web` | The only frontend (React 19 + HeroUI v3 + Tailwind v4 + Zustand + Vite). One build artifact serves the standalone site and all native clients' WebViews. |
| `apps/client` | Tauri 2 shell: window + notifications only, zero storage logic. `gen/android/` is committed; `gen/ios/` can only be generated on macOS. |
| `docs/CODE_TOUR.md` | **Read before changing code**: per-directory responsibility tables, the journey of one mutation through the stack, a "which files to touch" quick-reference table. |

## Common commands

Run from the repo root (pnpm workspace + Cargo workspace):

```bash
pnpm build:wasm        # wasm-pack build of the WASM data layer — PREREQUISITE for web dev/build/test/e2e
pnpm dev:server        # sync server on 127.0.0.1:8787 (in-memory store without DATABASE_URL)
pnpm dev:web           # Vite dev server, port 5173 (strict)
pnpm dev:desktop       # Tauri desktop dev
pnpm test:rust         # cargo test --workspace
pnpm test:web          # vitest unit tests
pnpm test:e2e          # Playwright (spawns a real server + vite preview; workers=1, serial)
pnpm lint              # clippy -D warnings + eslint
pnpm typecheck         # tsc --noEmit
pnpm format            # prettier --write + cargo fmt
pnpm stop              # free ports 8787/4173
pnpm bump <version>    # bump version everywhere (4 files + both lockfiles) — never edit versions by hand
```

Definition of "everything passes": `cargo fmt --check`, clippy with `-D warnings`, eslint, `cargo test`, vitest, `pnpm build:web`. CI (`.github/workflows/ci.yml`) runs Rust checks with `--exclude planwave` — the Tauri shell needs GTK/WebKit system libs that Linux CI lacks; it is only compiled for real in `release.yml`.

## Architecture boundaries

- **Sync semantics live only in `crates/sync-core`** — server replay and client engine share it. Never re-implement merge logic in the server or the web app.
- **Three-way JSON contract**: the JSON shape in `sync-core/src/model.rs` must stay in lockstep with the frontend TS side and the literal test cases in `sync-core/tests/json_interop.rs`. A model change must update all three.
- **`TaskPatch` three-state field semantics**: field absent = no change, `null` = clear, value = overwrite (enforced by the custom `deserialize_set_field`). Do not replace it with plain `Option` deserialization.
- **Pull-based sync, no WebSocket**: local writes auto-push with a 1.5s debounce; remote changes arrive via manual refresh, app start, window focus, 60s foreground polling, and post-push pull. New devices bootstrap from `GET /sync/snapshot`.
- **One web artifact for six platforms**: every client loads the same `apps/web/dist` + WASM. There is only one storage shape (IndexedDB) — no "desktop sqlite vs browser IndexedDB" split.
- All domain actions flow through the Zustand store (`apps/web/src/state/store.ts`) → WASM `mutate`. Never bypass the oplog to mutate UI state directly.
- MySQL migrations are hand-written SQL in `apps/server/migrations/`, auto-applied at startup via `sqlx::migrate!`. Known quirks: JSON columns need `CAST(... AS CHAR)` on read; lamport columns are `BIGINT UNSIGNED` → `u64`.

## Git workflow

### Branch strategy (GitHub Flow)

- `main` is the only long-lived branch
- New features / fixes branch off `main`: `feature/<name>` or `fix/<name>`
- Names align with `docs/features/F<number>.md` or `docs/tasks/<feat|fix>-<name>/`

### Commit convention (Conventional Commits)

`<type>(<scope>): <subject>`, type ∈ `feat` · `fix` · `docs` · `refactor` · `test` · `chore`

**Commit messages must be written in English.**

Example: `feat(workspace): add lastActiveRepo persistence on workspace switch`

### PR merging (normal merge)

PRs merge into `main` with a normal merge commit (no squash); the merge respects Conventional Commits. **PR titles and descriptions (summary, change list, test plan) must be written in English** — they are the public face of the repository history.

### Key constraints

- **AI agents must not commit / push / merge automatically** — exception: the user explicitly asks the agent to commit
- **main branch protection**: no force push; PRs must pass code-reviewer review
- **Every PR links a proposal or task**: the description references `docs/features/<yyyyMMdd>-<short-description>.md` or `docs/tasks/<task-name>/plan.md`
- **Confirm the branch before new work / new issues**: before handling, ask whether to use a new branch
  - No: continue on the current branch
  - Yes: suggest a branch name (`feature/<name>` or `fix/<name>`, aligned with `docs/features/<yyyyMMdd>-<short-description>.md` or `docs/tasks/<feat|fix>-<name>/`) and accept custom names; create it after confirmation

### Releasing

Cut releases with the `planwave-release` skill (`.agents/skills/planwave-release/SKILL.md`) instead of hand-rolling the steps. Its non-negotiable rules:

- Suggest the next semver from commits since the last tag (breaking → minor while 0.x, `feat` → minor, `fix` → patch) and confirm with the user. Never reuse an already-tagged version — the Android `versionCode` derives from the tag.
- Run the full gate before bumping: clean tree, up-to-date `main`, then `pnpm lint`, `pnpm test:rust`, `pnpm test:web`, `pnpm build:web`.
- Bump only via `pnpm bump <version>` (expect exactly 7 changed files), commit as `chore(release): vX.Y.Z`.
- **Always stop before pushing**: pushing the `v*` tag triggers release CI (and cancels any in-flight release) and is effectively irreversible — push `main` + tag only after the user's explicit yes.

## Specialized agents

| Agent | When to use |
|---|---|
| **product-manager** | Requirements analysis, PRD, user stories, competitive analysis, prioritization |
| **code-reviewer** | Code review (correctness / security / performance / maintainability / readability / test coverage / best practices) |
| **tester** | Test case design, test strategy, defect analysis, automation advice |

Detailed agent behavior conventions live in `.agents/agents/<name>.md`. Project skills (automation recipes like `planwave-release`) live in `.agents/skills/<name>/SKILL.md`.

Invoke the matching specialized agent per scenario.

### 1. Requirements flow (user files a new requirement)

Trigger: the user raises a new requirement / feature idea

1. Invoke `@.agents/agents/product-manager.md`
2. PM analyzes the requirement, asking clarifying questions when needed
3. PM writes it up as a structured proposal in `docs/features/<yyyyMMdd>-<short-description>.md`
4. Engineering analyzes the requirement and produces the technical plan
5. The plan goes to `docs/tasks/<feat-task-name>/plan.md`
6. Status flow: proposal → accepted / rejected → merged

### 2. Defect flow (user reports an issue)

Trigger: the user reports a problem, bug, or unexpected behavior

1. Invoke `@.agents/agents/tester.md`
2. Tester reproduces the issue and analyzes the root cause
3. Tester proposes the best fix (change suggestions + regression test points)
4. The fix plan goes to `docs/tasks/<fix-task-name>/plan.md`
5. Apply and verify the fix

### 3. Code review flow (after development)

Trigger: development done, new code awaiting merge

1. Automatically invoke `@.agents/agents/code-reviewer.md`
2. Reviewer audits across 7 dimensions: correctness / security / performance / maintainability / readability / test coverage / best practices
3. Critical issues (🔴) must be fixed before merging
4. The review report goes to `docs/tasks/<task-name>/review.md`

## Code conventions

- Rust: thiserror-derived error enums per layer (`ApiError` / `StoreError` / `SyncError`), no anyhow; logging via tracing; default rustfmt (4-space indent).
- TypeScript: strict + `noUncheckedIndexedAccess`; eslint `no-explicit-any: error`; prefix unused vars/args with `_`. Prettier: double quotes, printWidth 100, trailing comma all.
- Frontend: function components with inline prop types; every interactive element carries `data-testid` (Playwright depends on it); HeroUI primitives + Tailwind utilities incl. `dark:` variants.
- Versions live in 4 files + 2 lockfiles — only change them via `pnpm bump <version>`; tagging `v*` triggers release CI.

## Known gotchas

- `apps/web/src/wasm/pkg/` is a gitignored build artifact. After a fresh clone you must run `pnpm build:wasm` (needs `rustup target add wasm32-unknown-unknown` + `wasm-pack`) before the web dev server or tests will start.
- Ports are load-bearing: API fixed at 8787, preview 4173 strict, dev 5173 strict. `apps/web/src/lib/platform.ts` picks the API base by port heuristic (5173/4173 → 8787; production: same-origin `/api`).
- E2E must stay `workers: 1` / serial: all tests share one in-memory-store server with a single account.
- Axum routes have no `/api` prefix — the prefix exists only in the production reverse proxy (Caddy strips it). Never add `/api` to server routes.
- `apps/web/src/styles.css` must import `@heroui/styles` directly; importing it through `@heroui/react` leaves an unresolved `@import` and breaks the build.
- Titlebar asymmetry: macOS uses `titleBarStyle: "Overlay"` from `tauri.conf.json`; Windows gets a frameless window via `WindowControls.tsx` calling `setDecorations(false)` with custom min/max/close buttons.
- Android builds: `PLANWAVE_CN_MIRROR=1` enables Aliyun Maven mirrors (off by default — aliyun 502s hard-fail CI).
- No `DATABASE_URL` ⇒ in-memory store, wiped on restart. That's a feature for local dev/E2E, not a bug.

## Further documentation

- `README.md` — architecture overview, design rationale (why no CRDT, why no WebSocket), test matrix
- `docs/CODE_TOUR.md` — read this before touching sync or data-layer code
- `deploy/README.md` — deployment manual (GHCR images, MySQL, Caddy `/api` strip pitfalls)
- `docs/APPLE_SIGNING.md` — macOS signing/notarization + iOS signing
- `.env.example` — all server environment variables
