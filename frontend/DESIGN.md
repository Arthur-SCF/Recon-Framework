# RECON_APP Design System — "Operator"

> The single source of truth for every visual decision in the frontend.
> No component is styled without a token from this file. Need a value that
> isn't here? Add it here first, then use it.

Implemented in [`src/index.css`](src/index.css) (token layer + utilities) and
consumed through Tailwind v4 `@theme inline` semantic utilities
(`bg-card`, `text-primary`, `border-border`, `text-sev-critical`, …).

---

## 1. Atmosphere & Identity

A precision instrument for an operator, not a marketing dashboard. It should
feel like a **command deck**: a deep, quiet, near-black substrate where the
*data* is the only texture — hostnames, ports, status codes and severities
rendered in tabular mono, aligned to a strict grid, separated by hairlines
rather than boxes. Calm at rest, legible under pressure, dense without being
cramped.

**The signature is threefold:**
1. **One surgical accent.** A single electric cyan drives *interaction only* —
   active nav, focus, primary action. It is never decoration. Everything else
   is cool grayscale.
2. **Severity is the color language.** The only other color in the UI is the
   `info → low → medium → high → critical` ramp. If a pixel is colored, it
   means something.
3. **The operator mark.** A geometric aperture/crosshair logomark + a
   letter-spaced mono `RECON_APP` wordmark with a live status LED — the tool
   announcing it is armed and watching.

Restraint is the product. We get "modern" by **subtraction** (fewer borders,
tighter type, one accent), not by adding glow, gradients, or 3D globes.

---

## 2. Color

Four themes ship (`neon-recon` default, `eslinks`, `resolve-ai`, `claude`).
Each defines the semantic surface/text/accent tokens below; the **severity
ramp and engineering tokens are shared** across all themes (defined once on
`:root` / `.dark`). `neon-recon` (dark) is the reference implementation — its
exact values are the canonical palette; other themes are disciplined variants.

### Semantic surfaces & text — `neon-recon` dark (reference)

| Role | Token | Value | Usage |
|------|-------|-------|-------|
| Canvas | `--background` | `#070b11` | Deepest page background |
| Sidebar / rail | `--sidebar` | `#090d14` | Operator rail, deepest panel |
| Card / panel | `--card` | `#0c121b` | Cards, tables, panels (surface 2) |
| Elevated | `--popover` | `#10171f` | Popovers, dropdowns, dialogs (surface 3) |
| Hover surface | `--surface-hover` | `#141d28` | Row/interactive hover fill |
| Muted surface | `--muted` | `#0f1720` | Inset wells, chip backgrounds |
| Foreground | `--foreground` | `#e7eef7` | Primary text (never pure `#fff`) |
| Muted foreground | `--muted-foreground` | `#7e8da0` | Labels, metadata, secondary |
| Faint foreground | `--faint-foreground` | `#55627a` | Timestamps, disabled, placeholders |
| Active nav fill | `--accent` | `#0f2130` | Selected nav / active surface (cyan-tinted) |
| Active nav text | `--accent-foreground` | `#c3e8fb` | Text on active surface |

### The one accent

| Role | Token | Dark | Usage |
|------|-------|------|-------|
| Interactive accent | `--primary` | `#34bdf2` | Active nav, focus ring, primary CTA, links |
| On accent | `--primary-foreground` | `#04121c` | Text/icon on a filled accent |

`--primary` is used **only** for interactivity. A colored element that is not
interactive must draw from the severity ramp, not the accent.

### Severity ramp (SHARED — all themes, the semantic color system)

| Level | Token | Dark | Light | Maps to |
|-------|-------|------|-------|---------|
| Info | `--sev-info` | `#38bdf8` | `#0284c7` | 3xx, informational, CDN |
| Low / OK | `--sev-low` | `#34d399` | `#059669` | 2xx, healthy, success, "Done" |
| Medium | `--sev-medium` | `#fbbf24` | `#d97706` | 4xx, warnings, paused, caution |
| High | `--sev-high` | `#fb923c` | `#ea580c` | elevated risk, degraded |
| Critical | `--sev-critical` | `#fb5c74` | `#e11d48` | 5xx, errors, takeover, destructive |

Each has a tint form used for chip/badge backgrounds: the token at **12–16%
alpha** (`bg-sev-critical/15`), with the solid token as text/foreground.

### Borders & rings

| Role | Token | Dark | Usage |
|------|-------|------|-------|
| Default border | `--border` | `#1a2431` | Cards, tables, dividers (hairline) |
| Subtle border | `--border-subtle` | `#131b25` | Softest separation, inner rules |
| Input border | `--input` | `#101a25` | Field backgrounds/edges |
| Focus ring | `--ring` | `#34bdf2` | Keyboard focus (2px, 2px offset) |

### Rules
- **One accent, one job.** `--primary` = interaction only. Never decorative.
- **Color = meaning.** Any non-gray pixel is either the accent (interactive) or
  a severity token (semantic). No third color story.
- **Never pure black or pure white.** `#070b11` substrate, `#e7eef7` text.
- **Never a raw hex in a component.** Extend this table, then use the token.
- Legacy `--secondary` (emerald) is retained for compatibility but is being
  folded into `--sev-low`; do not introduce new decorative uses.

---

## 3. Typography

Two families. Sans for prose/labels, mono for **every identifier and number**
(hosts, IPs, ports, hashes, counts, latencies, status codes). The mono +
tabular treatment is the single biggest "engineered" signal — use it liberally.

### Font stack
- **Sans:** `Inter, system-ui, -apple-system, sans-serif`
- **Mono:** `"JetBrains Mono", ui-monospace, "SF Mono", monospace`
- **Editorial (Claude theme only):** `Outfit`
- **Global OpenType features:** `"cv01","ss03","zero"` — single-story `a`,
  geometric alternates (the "Linear" character), and a **slashed zero** (vital
  for a tool full of `0`s in IPs/hashes). Applied on `html` in `index.css`.
- **Numbers:** `tabular-nums` via the `.nums` utility or Tailwind
  `tabular-nums`. Every metric and data cell gets it.

### Scale

| Level | Size | Weight | Line height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| Display | 22px / 1.375rem | 600 | 1.2 | -0.02em | Page title (Dashboard h1) |
| H1 | 18px / 1.125rem | 600 | 1.3 | -0.015em | Major section headers |
| H2 | 15px / 0.9375rem | 600 | 1.4 | -0.01em | Card / panel titles |
| Title | 14px / 0.875rem | 600 | 1.4 | -0.006em | Target domain, list titles |
| Body | 13px / 0.8125rem | 400 | 1.5 | 0 | Default UI text |
| Body sm | 12px / 0.75rem | 400 | 1.5 | 0 | Secondary info |
| Label | 12px / 0.75rem | 500 | 1.4 | 0 | Form labels, buttons |
| Metric | 22px / 1.375rem | 600 | 1.1 | -0.01em | Stat values (mono, tabular) |
| Overline | 11px / 0.6875rem | 600 | 1.3 | +0.12em | Section labels (mono, UPPERCASE) |
| Micro | 10px / 0.625rem | 500 | 1.4 | +0.02em | Badges, chips (mono) |

### Rules
- Two families max (Outfit is the Claude-theme swap for sans, not an addition).
- Body never below 12px; data cells 12–13px.
- Overlines are **mono, uppercase, letter-spaced** — the operator-panel label.
- Headings track negative; overlines/micro track positive.
- Numbers are **always** tabular; identifiers are **always** mono.

---

## 4. Spacing & Layout

Base unit **4px**. Matches existing usage — no migration needed.

| Token | Value | Usage |
|-------|-------|-------|
| 1 | 4px | icon↔label, chip inner |
| 2 | 8px | inline groups, list gaps |
| 3 | 12px | control padding, card gap |
| 4 | 16px | card padding (default) |
| 5 | 20px | dashboard section gap |
| 6 | 24px | between section groups |
| 8 | 32px | major breaks |

### Grid
- Dashboard max content width: **1152px** (`max-w-6xl`), centered.
- Breakpoints: sm 640 · md 768 · lg 1024 · xl 1280.
- Sidebar: 256px expanded / 64px collapsed. Top bar: 56px (`h-14`).

### Rules
- No magic numbers; every value maps to the 4px scale.
- Density target: **compact-operational.** Table rows 32–36px, card padding
  16px, control height ~32px. Dense, never cramped — type does the spacing.

---

## 5. Components

### Logomark + wordmark (`Sidebar`)
- **Structure:** inline SVG aperture/crosshair mark (`--primary`) + `RECON`
  in mono weight 600 letter-spaced, `_APP` in `--faint-foreground`, trailing
  live status LED.
- **States:** LED = `--sev-low` (healthy) / `--sev-critical` (offline),
  `2px` dot; mark gains a faint accent glow on hover only.

### Metric tile (`StatsRow`)
- **Structure:** hairline panel, mono UPPERCASE overline label, large
  tabular-mono value, small severity-tinted icon top-right.
- **Variants:** accent (targets), low (running/ok), info (completed),
  medium (notifications).
- **States:** static; value animates count-in via opacity (no layout anim).

### Asset card (`TargetCard`)
- **Structure:** hairline panel, status LED + mono domain title, mono meta row
  (`N scans · Xd ago`), badge row (priority, policy, loop), severity-tinted
  left rule keyed to status.
- **States:** rest = border `--border`; hover = border `--primary/40` + inset
  accent ring + `-translate-y-0.5` (transform only); running = animated
  severity progress rule; focus-visible ring.

### Badge / chip
- **Structure:** mono micro text, `4px` radius, severity tint bg + solid
  severity text (`bg-sev-*/15 text-sev-*`), optional 1px border at same hue.
- **Never** pill-shaped except true tags (`#tag`) which use full radius.

### Panel (utility `.panel`)
- Card bg + `1px` `--border` + optional inset hairline ring. **No drop shadow
  at rest.** This is the default container.

### States every interactive element ships
default · hover · active (`scale .98`) · focus-visible (ring) · disabled
(50% opacity) · loading (skeleton, not spinner where layout is known).

---

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 120ms | ease-out | button/press (`scale .98`), toggle, hover fill |
| Standard | 180ms | ease-in-out | panel/tab/accordion, nav |
| Emphasis | 240ms | cubic-bezier(0.16, 1, 0.3, 1) | card entry, page transition |
| Stagger | +30ms/item | — | list/grid entry cascade |

### Rules
- Animate **only** `transform` and `opacity`. Never layout props.
- Every interactive element has hover + active + focus.
- Entry = opacity + small `translateY` (≤12px), staggered — never mount all at
  once, never bounce/spring (operator tools don't bounce).
- Respect `prefers-reduced-motion`: disable non-essential motion.

---

## 7. Depth & Surface

**Strategy: borders + tonal-shift.** (Committed — not "a mix".)

Elevation is communicated by **luminance stepping** the surface and a **1px
hairline border**, Linear-style — not by material drop shadows.

| Level | Treatment | Use |
|-------|-----------|-----|
| 0 canvas | `--background`, no border | Page background |
| 1 rail | `--sidebar` | Sidebar, deepest panel |
| 2 surface | `--card` + `1px --border` | Cards, tables, panels (default) |
| 3 elevated | `--popover` + `1px --border` + inset ring | Popovers, dropdowns, dialogs |
| hover | `--surface-hover` fill | Rows, interactive cards |

**Shadows are reserved for genuinely floating overlays only** — dropdowns,
command palette, toasts, the bulk-action bar. Resting cards never cast a
shadow; they sit on the page via border + tonal step. The one texture allowed
is `.deck-grid` — a very low-alpha grid, used only on empty/hero surfaces.

---

## Compliance checklist (run after each component)
- [ ] Colors are tokens from §2 — no raw hex in components.
- [ ] Numbers are tabular mono; identifiers are mono.
- [ ] Sizes match the §3 scale.
- [ ] Spacing is on the 4px grid.
- [ ] Interactive elements have all §5 states.
- [ ] Depth = border + tonal step (§7); shadows only on floating overlays.
- [ ] Motion follows §6 timings; transform/opacity only.
- [ ] One accent (interaction), severity ramp (meaning) — no third color.
