# PlanWave UI v2 — Adaptive Redesign (Simplified)

| Field            | Value                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------- |
| **Title**        | PlanWave UI v2 — tokenized, adaptive shell, one artifact for six platforms            |
| **Date**         | 2026-09-17 (revised 2026-09-18)                                                       |
| **Status**       | Accepted — implementing on `feat/ui-v2`                                               |
| **Scope**        | Frontend visual system + adaptive layout under `apps/web`; two native config values   |
| **Out of scope** | sync-core, server, TaskPatch, ports/API, i18n, new product features, per-platform UIs |

This revision replaces the original 10-PR adaptive-ui draft with a simpler, refactor-only plan. Product requirements: reference Things 3 / Linear / TickTick, keep the design quiet and simple, make interaction convenient, **change no existing functionality — UI refactor only**.

---

## 1. Goals & Non-Goals

### Goals

1. A **design-token layer** (`--pw-*` CSS variables) replacing ad-hoc `zinc-*` / magic numbers, with light + dark.
2. A **single AppShell** that reflows by viewport (compact / regular / wide), owning the titlebar, safe-area, and detail-pane docking.
3. **Convenient mobile interaction**: bottom nav, FAB quick-add, always-visible touch actions, bottom-sheet dialogs.
4. Restyle every existing screen; keep **all** `data-testid`, copy, and behavior.

### Non-Goals (cut from the original draft)

| Cut item                                                 | Why                                                                                                                   |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Density setting (`planwave.ui.density`, settings radios) | New product preference, not a refactor. Replaced by automatic pointer-based density in pure CSS.                      |
| Keyboard shortcuts (`useAppHotkeys`, `highlightTask`)    | New functionality. Deferred to a follow-up feature.                                                                   |
| Playwright viewport matrix                               | Nice-to-have. Existing e2e (Desktop Chrome 1280×720) stays the gate.                                                  |
| `--pw-ime-bottom` / `useVisualViewportInset` JS          | Android `windowSoftInputMode="adjustResize"` + compact bottom sheets cover the OSK cases without a JS inset pipeline. |
| iOS `env()` device measurement as merge blocker          | CSS `env()` + `data-insets` guard ships now; real-device verification is a release-time check.                        |

Everything else in the original draft (tokens, AppShell, bottom nav, screen restyles, native window bump) is kept.

---

## 2. Design tokens (`apps/web/src/theme/tokens.css`)

Imported from `styles.css` **after** `@import "@heroui/styles"`. Namespaced `--pw-*` only; HeroUI is aliased through its **own** variables (`--background`, `--surface`, `--foreground`, `--muted`) — we never re-declare HeroUI's `@theme` keys (`--color-surface`, `--radius-md`, `--accent`).

### 2.1 Color

| Token                  | Light                  | Dark                     | Usage                                            |
| ---------------------- | ---------------------- | ------------------------ | ------------------------------------------------ |
| `--pw-bg-canvas`       | `#f4f4f5`              | `#09090b`                | App chrome, sidebar, titlebar                    |
| `--pw-bg-surface`      | `#ffffff`              | `#18181b`                | List pane, detail pane, dialogs                  |
| `--pw-bg-surface-2`    | `#fafafa`              | `#27272a`                | Group headers, out-of-month cells, trays         |
| `--pw-bg-hover`        | `rgb(24 24 27 / .05)`  | `rgb(255 255 255 / .06)` | Row / nav hover                                  |
| `--pw-bg-selected`     | `rgb(37 99 235 / .10)` | `rgb(96 165 250 / .14)`  | Selected row / nav (quiet tint, not a blue pill) |
| `--pw-accent`          | `#2563eb`              | `#60a5fa`                | Selected nav text, today due, focus              |
| `--pw-accent-strong`   | `#2563eb`              | `#3b82f6`                | FAB / primary-fill surfaces                      |
| `--pw-fg`              | `#18181b`              | `#fafafa`                | Primary text                                     |
| `--pw-fg-muted`        | `#52525b`              | `#a1a1aa`                | Secondary text                                   |
| `--pw-fg-subtle`       | `#a1a1aa`              | `#71717a`                | Counts, group headers, placeholders              |
| `--pw-border`          | `#e4e4e7`              | `#3f3f46`                | Pane splits, grid lines                          |
| `--pw-border-hairline` | `rgb(24 24 27 / .08)`  | `rgb(255 255 255 / .08)` | Task-row inset divider                           |
| `--pw-danger`          | `#dc2626`              | `#f87171`                | Overdue, destructive                             |
| `--pw-success`         | `#16a34a`              | `#4ade80`                | Sync online, probe ok                            |

Consumed via additive `@theme` utilities (`bg-canvas`, `bg-pw-surface`, `bg-pw-selected`, `bg-pw-hover`, `text-fg`, `text-fg-muted`, `text-fg-subtle`, `border-pw-border`, `text-pw-accent`, `bg-pw-accent-strong`, `text-pw-danger`) — no collision with HeroUI's `bg-surface` / `text-muted`, which also follow the aliases.

```css
:root {
  --background: var(--pw-bg-canvas);
  --surface: var(--pw-bg-surface);
  --foreground: var(--pw-fg);
  --muted: var(--pw-fg-muted);
}
```

Priority dots (`bg-red-500` / `bg-orange-400` / `bg-yellow-400`) and project dots (`lib/projectColors.ts`) are **unchanged** — tests assert those class names.

### 2.2 Type

System CJK-first stack, no webfont:

```css
--pw-font-sans:
  "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC",
  "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", system-ui,
  sans-serif;
```

Applied to `body`. Sizes stay on Tailwind's scale (`text-sm` body, `text-xs` meta, `text-2xl` view title); Chinese line-heights come from Tailwind defaults.

### 2.3 Spacing, radius, shadow, z-index

- **Automatic density** (no setting): `:root { --pw-row-y: 6px; --pw-hit: 28px }`, `@media (pointer: coarse) { --pw-row-y: 10px; --pw-hit: 44px }`. jsdom / desktop → dense; touch → comfortable. Rows consume `py-[var(--pw-row-y)]`.
- Radius: rows/inputs stay `rounded-xl` (existing); dialogs `rounded-2xl` (existing). No token needed in v2.
- Shadows: `--pw-shadow-2: 0 8px 24px rgb(0 0 0 / .12)` (dark: `/ .4`) for FAB and sheets.
- Z-index scale (replaces ad-hoc 10/20/30/40/50):

| Token            | Value | Layer                                         |
| ---------------- | ----- | --------------------------------------------- |
| `--pw-z-sticky`  | 10    | Pull-to-refresh indicator                     |
| `--pw-z-nav`     | 20    | Compact drawer + backdrops                    |
| `--pw-z-overlay` | 30    | Detail overlay/sheet, FAB                     |
| `--pw-z-chrome`  | 40    | Titlebar (caption buttons), web-update banner |

HeroUI Modals / Toasts are portaled above everything (unchanged).

### 2.4 Chrome & safe-area tokens

```css
:root {
  --pw-safe-top: env(safe-area-inset-top, 0px); /* iOS / web only */
  --pw-safe-right: env(safe-area-inset-right, 0px);
  --pw-safe-bottom: env(safe-area-inset-bottom, 0px);
  --pw-safe-left: env(safe-area-inset-left, 0px);
  --pw-titlebar: 0px;
  --pw-caption-w: 0px;
  --pw-traffic-pad: 0px;
  --pw-nav-height: 0px;
}
html[data-insets="native"] {
  --pw-safe-*: 0px;
} /* Android: natively padded, never double-pad */
html[data-chrome="windows"] {
  --pw-titlebar: 36px;
  --pw-caption-w: 144px;
}
html[data-chrome="macos"] {
  --pw-titlebar: 36px;
  --pw-traffic-pad: 78px;
}
@media (max-width: 767px) {
  :root {
    --pw-nav-height: 52px;
  }
} /* matches BottomNav mount exactly */
```

`platform.ts` gains `applyPlatformAttrs()` (called once from `main.tsx`):

- `data-os`: `windows` / `macos` / `linux` / `android` / `ios` / `web`
- `data-chrome`: `windows` (frameless + captions) / `macos` (Overlay traffic lights) / `linux` / `none` (native or no chrome)
- `data-insets`: `native` (Android — `MainActivity.kt` already pads the WebView) / `css`

Chrome derives from **OS**, not `isDesktopApp`: Linux keeps native decorations → `--pw-titlebar: 0`, no web titlebar (fixes today's wasted 36px on Linux).

### 2.5 Motion

Existing transitions stay (`duration-200` drawer, row hover). `@media (prefers-reduced-motion: reduce)` zeroes transition durations globally.

---

## 3. Adaptive shell

### 3.1 Shell modes

| Shell     | Width    | Chrome                                                   |
| --------- | -------- | -------------------------------------------------------- |
| `compact` | < 768    | Bottom nav + left drawer; detail = fullscreen overlay    |
| `regular` | 768–1279 | Sidebar 240px; detail = 360px right sheet + dim backdrop |
| `wide`    | ≥ 1280   | Sidebar 256px + list + docked detail 360px               |

**Detail docks at 1280, not 768** — today's `md:w-80` docking leaves a 768–1024 viewport with a ~230px list. `useNarrowViewport.ts` is replaced by `lib/useShellMode.ts`:

```ts
export type ShellMode = "compact" | "regular" | "wide";
export function useShellMode(): ShellMode; // matchMedia 768 / 1280
export function useCoarsePointer(): boolean; // (pointer: coarse)
```

jsdom has no `matchMedia` → default `wide` / `false` (same default-wide contract as `useIsNarrow`; existing tests stay on the desktop branch). JS forks are allowed only where CSS cannot decide: month dots vs chips, Modal `placement`, BottomNav mount. All layout is CSS.

**Month unscheduled tray exception:** stays at `lg` ≥1024 (`hidden lg:flex`, unchanged) — not a fourth shell mode.

### 3.2 AppShell structure

```
AppShell (flex column, h-full, bg-canvas)        ← wraps boot + auth + ready
├── Titlebar          in-flow, height var(--pw-titlebar); null on linux/none
│                     windows: caption buttons right (padding-right --pw-caption-w)
│                     macos:   padding-left --pw-traffic-pad
├── WebUpdateBanner   in-flow (was fixed top-0), web-only
├── SafeArea          flex-1 min-h-0; padding = --pw-safe-* on requested edges;
│                     "bottom" omitted while BottomNav is mounted (nav owns it)
│   └── boot splash | auth card | ready panes (nav | main | detail)
├── BottomNav         compact+ready only; 52px + padding-bottom --pw-safe-bottom
└── (detail overlay is in-tree fixed, below Titlebar in z)
```

The three per-pane `h-9` drag spacers (Sidebar / TaskList / TaskDetail) are **deleted**; the Titlebar is the single drag region. Windows caption buttons move from `WindowControls.tsx` into `Titlebar` (same testids `window-controls` / `win-minimize` / `win-maximize` / `win-close`); `initWindowsFrameless()` stays exported from `WindowControls.tsx` for `main.tsx`.

Overlay geometry (drawer, detail sheet, FAB):

```
top:    calc(var(--pw-titlebar) + var(--pw-safe-top))
right:  var(--pw-safe-right)
bottom: var(--pw-safe-bottom)
left:   var(--pw-safe-left)   /* compact fullscreen only */
```

Overlays never paint over the Titlebar (`--pw-z-chrome` wins).

Toast offset (HeroUI `Toast.Provider placement="bottom"`, portaled): pure CSS override so toasts clear the bottom nav + home indicator —

```css
.toast-region--bottom {
  bottom: calc(0.75rem + var(--pw-nav-height) + var(--pw-safe-bottom));
}
```

---

## 4. Navigation

### 4.1 Sidebar (regular / wide rail, compact drawer)

- Structure unchanged: brand row → smart lists → 项目 header + add → project rows → footer 设置 / 退出登录. Scroll region stays `min-h-0 flex-1`.
- **Quiet selection**: active item = `bg-pw-selected` + `text-pw-accent` (replaces solid `bg-blue-500 text-white`).
- Smart lists get 16px stroke icons (calendar-day / calendar-week / inbox / trash), labels unchanged.
- Project ⋯ menu button **always visible**; counts no longer hide on hover (drop `group-hover:invisible`). Menu content unchanged (颜色 / 重命名 / 删除).
- Drawer (compact): `fixed`, `w-[min(320px,86vw)]`, translate animated, backdrop `data-testid="sidebar-backdrop"` (unchanged), `setView` still closes it.

### 4.2 Bottom nav (compact only, new chrome)

4 tabs, in-flow below SafeArea, content height 52px:

| Tab  | Behavior                                                                                                                      | testid             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 今天 | `setView smart:today`, `aria-current` when active                                                                             | `tab-today`        |
| 全部 | `setView smart:all`                                                                                                           | `tab-all`          |
| 项目 | **chrome control**: `toggleSidebar(true)` + `aria-expanded={sidebarOpen}`; `aria-current` only when `view.kind === "project"` | `nav-projects-tab` |
| 更多 | opens MoreSheet                                                                                                               | `nav-more`         |

`data-testid="bottom-nav"` on the bar. Not mounted at ≥768 (no `matchMedia` → not mounted in jsdom).

**MoreSheet** (HeroUI Modal, bottom placement): 最近 7 天， 回收站， 同步状态， 设置， 退出登录 — all call existing actions (`setView` / `openSyncSheet` / `openSettings` / `requestConfirm` logout). testids `more-upcoming` / `more-trash` / `more-sync` / `more-settings` / `more-logout`.

The old hamburger `menu-button` is **removed** — no test clicks it (desktop e2e uses the persistent sidebar; vitest never touches it).

### 4.3 Search

Unchanged: filters current view, month → list on typing. The input stays in the toolbar on all shells.

---

## 5. Screen-by-screen specs

Every surface below exists today. Restyle only; copy and testids unchanged unless noted.

### 5.1 Boot splash / Auth

- Both render inside `SafeArea` so Windows caption buttons exist on login/splash.
- Auth card: compact = `max-md:mt-[10vh]` top-aligned (OSK keeps password + submit visible), flat on canvas (no shadow); desktop keeps centered `max-w-sm` card. Probe states, disabled fields, copy unchanged.
- `applyTheme` also drives `<meta name="theme-color">` (`#f4f4f5` / `#09090b`) so mobile status bars match the canvas.

### 5.2 TaskList

- Loses the `h-9` drag spacer. Toolbar: menu-button removed; search + `SyncBadge` + refresh unchanged.
- **Compact FAB**: 56px `+` circle, `data-testid="fab-add"`, fixed above bottom nav, opens `QuickAddModal` with empty title. Mounted **only when** `!isTrash && !showMonth` (same predicate as the inline input). Inline `new-task-input` form becomes `hidden md:flex` (regular/wide unchanged).
- Rows/groups/completed section/trash tools keep structure and testids; colors move to tokens (group header `text-fg-subtle`, overdue accent `--pw-danger` at 80%, hairlines `--pw-border-hairline`).
- Empty state keeps the three one-liners + a quiet 48px checkbox-circle illustration above (20% opacity, `aria-hidden`).
- Wide: list column capped `xl:max-w-[52rem] xl:mx-auto` on the header rows + `<ul>`.
- Trash bulk bar unchanged in flow.

### 5.3 TaskRow

Structure and testids untouched (`task-row`, `check-*`, `restore-*`, `purge-*`, `subtask-toggle-*`, `trash-check-*`, `aria-label="移到回收站"`; keep `before:bg-zinc-200/70` divider and `ml-9` subtask classes — vitest asserts them).

- Row vertical padding → `py-[var(--pw-row-y)]` (auto density).
- Selected row → `bg-pw-selected`.
- Destructive/restore actions stay **always mounted**: fine pointer = hover-reveal (`opacity-0 group-hover:opacity-100`, plus visible when selected); coarse pointer = always visible via `@custom-variant coarse (@media (pointer: coarse))` → `coarse:opacity-100`. Never moved into a Dropdown (e2e/vitest click these nodes directly).

### 5.4 TaskDetail

- Geometry owned by an **AdaptivePane** wrapper: compact fullscreen / regular 360px right sheet + 30% backdrop (click = `closeDetail`) / wide docked 360px with border-l. `data-testid="task-detail"` stays on the pane.
- Header (`← 返回` compact, 保存/删除, `×` wide), draft + explicit 保存 semantics, tombstone actions — all unchanged.
- Native `<input type="date">` and `<select>` extracted to `components/ui/DateField.tsx` / `NativeSelect.tsx` (one tokenized implementation, reused by QuickAddModal; HeroUI `DatePicker` deliberately not used — OS sheet wins on mobile).
- Subtask delete button: `coarse:opacity-100`.

### 5.5 Month view (+ DayTasksOverlay, UnscheduledTray)

- `useIsNarrow` → `useShellMode()` + `useCoarsePointer()`: dots + count when `compact || coarse`, chips otherwise.
- Compact cells `min-h-14` (was 76px); `@media (max-height: 500px)` → `min-h-12` (landscape phones). Desktop chip path unchanged (`sm:min-h-24`).
- Compact unscheduled: toolbar text button `未排期 (N)` (`lg:hidden`, `data-testid="unscheduled-sheet-open"`) opens a bottom sheet (`data-testid="unscheduled-sheet"`) listing the same tasks via `TaskRow`. Desktop tray (`unscheduled-tray`, `unscheduled-toggle`, `unscheduled-chip-*`) unchanged at `lg`.
- `DayTasksOverlay` gains optional `onAdd` — omitted by the unscheduled sheet (hides the add button), present for day cells (unchanged behavior).
- **Drag behavior fix**: `useTaskDrag` `onPointerDown` no-ops unless `pointerType === "mouse"` (product intent was always "移动端不做拖拽"; touch tap still opens detail via the existing click path). New vitest covers the touch no-op.
- Today numeral keeps `bg-blue-500` (vitest asserts it).

### 5.6 Dialogs

- `QuickAddModal`, `DayTasksOverlay`, `SyncStatusSheet`, `SettingsDialog`, `ConfirmDialog`, `PurgeConfirmDialog`, `ProjectRenameDialog`: `placement = compact ? "bottom" : "center"` via `useShellMode`. `UpdateDialog` stays centered (short, blocking).
- `SyncStatusSheet` rebuilt on HeroUI `Modal` (was a hand-rolled overlay → gains focus trap / Esc / scroll lock). All `sync-sheet*` testids preserved; content and copy unchanged.
- `SettingsDialog`: **drop `min-w-96`** → `w-[min(100vw-24px,28rem)]` (fixes 390px overflow). Tabs / radios / network tab unchanged.

### 5.7 WebUpdateBanner / WindowControls

- Banner: in-flow under Titlebar (was `fixed top-0`), copy unchanged.
- Windows caption buttons: absorbed into Titlebar (§3.2).

---

## 6. Component inventory

```
apps/web/src/
  theme/tokens.css                 NEW   --pw-* tokens + @theme utilities + density/insets selectors
  styles.css                       MOD   import tokens; body → tokens; coarse variant; toast offset
  main.tsx                         MOD   + applyPlatformAttrs()
  lib/platform.ts                  MOD   + applyPlatformAttrs()
  lib/useShellMode.ts              NEW   useShellMode / useCoarsePointer
  lib/useNarrowViewport.ts         DELETED (call sites migrated)
  lib/useTaskDrag.ts               MOD   mouse-only pointerdown
  components/shell/AppShell.tsx    NEW   Titlebar + banner + children column
  components/shell/Titlebar.tsx    NEW   drag region + Windows caption buttons
  components/shell/SafeArea.tsx    NEW   --pw-safe-* padding on requested edges
  components/shell/AdaptivePane.tsx NEW  role: nav | main | detail
  components/shell/BottomNav.tsx   NEW   4 tabs + MoreSheet
  components/ui/Logo.tsx           NEW   moved from App.tsx (breaks Sidebar→App import)
  components/ui/DateField.tsx      NEW   tokenized native date input
  components/ui/NativeSelect.tsx   NEW   tokenized native select
  App.tsx                          MOD   AppShell root; Logo moved out
  Sidebar / TaskList / TaskRow / TaskDetail / MonthView / DayTasksOverlay /
  UnscheduledTray / ViewModeToggle / QuickAddModal / SettingsDialog /
  SyncStatusSheet / ConfirmDialog / PurgeConfirmDialog / ProjectRenameDialog /
  UpdateDialog / AuthScreen / WebUpdateBanner / WindowControls
                                   MOD   restyle per §5
```

Zustand: **no new state**. Only `applyTheme` gains the `theme-color` meta write.

Native config (allowed, two files):

| File                                                       | Change                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `apps/client/tauri.conf.json`                              | `width: 1280`, `height: 800` (`minWidth: 420` unchanged) — fresh installs land on the `wide` three-pane shell |
| `apps/client/gen/android/app/src/main/AndroidManifest.xml` | `android:windowSoftInputMode="adjustResize"` on MainActivity                                                  |

---

## 7. Testing contract

1. **Every existing `data-testid` stays on the same node type.** New testids are additive only (`bottom-nav`, `tab-today`, `tab-all`, `nav-projects-tab`, `nav-more`, `more-*`, `fab-add`, `unscheduled-sheet`, `unscheduled-sheet-open`, `detail-backdrop`).
2. jsdom defaults: shell `wide`, pointer fine, insets css — existing vitest untouched except where noted in §5 (month tests keep working via the wide default).
3. New vitest: `useTaskDrag` ignores non-mouse pointers; `applyPlatformAttrs` dataset mapping.
4. Gate before merge: `pnpm lint`, `pnpm typecheck`, `pnpm test:web`, `pnpm build:web`, `pnpm test:e2e` (Desktop Chrome, serial, unchanged).

---

## 8. Implementation checklist (single branch `feat/ui-v2`, phased)

1. **Tokens**: `tokens.css`, `styles.css` wiring, `coarse` variant, toast offset.
2. **Shell**: `platform.ts` attrs, `useShellMode`, `AppShell` / `Titlebar` / `SafeArea` / `AdaptivePane`, `WindowControls` absorbed, `WebUpdateBanner` in-flow, delete three `h-9` spacers, `main.tsx`.
3. **Nav**: Sidebar restyle, `BottomNav` + MoreSheet, remove `menu-button`.
4. **List & rows**: TaskList (FAB, hidden compact input, max-width, empty illustration), TaskRow (density var, coarse actions).
5. **Detail**: AdaptivePane wrapper, DateField / NativeSelect, coarse subtask delete.
6. **Month**: shell-mode fork, compact cells, unscheduled sheet, mouse-only drag + test.
7. **Overlays**: placements, SyncStatusSheet → Modal, settings width fix, AuthScreen OSK alignment, theme-color meta.
8. **Native**: `tauri.conf.json` 1280×800, AndroidManifest `adjustResize`.
9. **Docs**: `AGENTS.md` / `docs/CODE_TOUR.md` structure updates.
10. Gate (§7.4) → single commit.

---

## 9. Key decisions

1. **Stay on HeroUI v3 + Tailwind v4.** Tokens are namespaced `--pw-*`; HeroUI aliased via its own `--background` / `--surface` / `--foreground` / `--muted`. No `@theme` re-declaration of HeroUI keys.
2. **One AppShell, three shell modes — not six OS skins.** OS only sets `data-chrome` / `data-insets`; layout is viewport-driven CSS.
3. **Detail docks at 1280px.** 768–1279 gets a right sheet below the Titlebar; default Tauri window becomes 1280×800.
4. **Android insets stay native; iOS/web use CSS `env()`; never both** (`data-insets="native"` guard).
5. **Density is automatic** (pointer media query), not a setting. Hotkeys are deferred — this is a refactor, not a feature release.
6. **Compact chrome = bottom nav (4 tabs) + project drawer + FAB.** 项目 tab is a chrome control (`toggleSidebar` + `aria-expanded`), not a destination. Month stays a presentation toggle.
7. **Quiet selection tint**, not solid blue pills. Priority/project dots keep their current hues (tests depend).
8. **Destructive row actions stay always-mounted** (hover-reveal on fine pointer, always visible on coarse). Never a Dropdown.
9. **All testids, copy, and domain flows unchanged.** `store.ts` gains nothing but a meta-tag write.

---

## 10. References

- `AGENTS.md` — one artifact, HeroUI+Tailwind, `data-testid`, Android insets gotcha
- `docs/CODE_TOUR.md` — file roles under `apps/web`
- Original 10-PR draft (git history of this file, 2026-09-17) — token values, overlay geometry math, and rationale for the cut items
- `docs/features/20260914-task-list-visual-refresh.md`, `20260915-month-view.md` — list/month structure this restyle preserves
