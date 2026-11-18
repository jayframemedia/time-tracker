# Design spec

Reference prototypes: `design/mockup.html` (iPhone, working) and `design/mac-reference.html` (Mac, static).
Tokens: `design/tokens.css`. Premium = restraint: near-black, one orange accent, big calm digits, smooth motion.

## Colour tokens
| Token | Value | Use |
| --- | --- | --- |
| `--bg` | #0A0A0B | Screen background |
| `--bg-bar` | #0D0D0F | Tab bar |
| `--surface` | #161618 | Cards, rows |
| `--surface-2` | #141416 | Running button fill |
| `--border` | #26262A | Card borders |
| `--divider` | #222226 | Row dividers |
| `--track` | #1F1F23 | Ring track, tab bar top border |
| `--text` | #F5F5F7 | Main text, counter |
| `--text-muted` | #8E8E93 | Labels, dates, inactive tabs |
| `--accent` | #FF7A1A | START, totals, active tab, Export button |
| `--accent-glow` | rgba(255,122,26,0.35) | START shadow |
| `--accent-halo` | rgba(255,122,26,0.08) | START outer ring |
| `--accent-tint` | #2A1A0E | Selected filter pill (Mac) |

## Type
System stack: `-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`.
| Element | Size / weight |
| --- | --- |
| Counter (iPhone) | 76 px, weight 200, letter-spacing −0.02em, tabular-nums |
| Counter (Mac) | 64 px, weight 200 |
| Screen title | 30 px, weight 600 |
| Body / rows | 15 px (14 px on Mac table) |
| Section labels | 13 px, weight 600, uppercase, letter-spacing 0.08–0.12em, muted |
| Column labels | 11 px, weight 600, uppercase, letter-spacing 0.1em, muted |
| Tab labels | 11 px, weight 600 |

## iPhone layout (390 × 844 reference)
- Content padding: 24 px sides; top = safe-area + ~12 px.
- Timer tab, top to bottom: "TODAY" + date row → 72 px gap → counter → 14 px → subline → 52 px → button group → "Logged today" card pinned to bottom.
- **Button group:** 264 px square. Ring: r = 124, track 4 px `--track`, progress 6 px round caps, starts at 12 o'clock.
- **START:** 216 px circle, fill `--accent`, label `--bg` 24 px weight 600, letter-spacing 0.16em, shadow `0 0 0 10px --accent-halo, 0 18px 60px --accent-glow`.
- **FINISH:** 216 px circle, fill `--surface-2`, 2 px `--accent` border, label `--accent`, sub-label "HOLD 1 SEC" 12 px muted.
- Ring while running = progress through the current hour (orange). While holding = hold progress (white, 0→100% in 1 s).
- Cards: radius 16 px, 1 px `--border`, padding 16–18 px.
- Tab bar: 84 px incl. safe area, 3 equal columns, 24 px stroke icons (1.8 px), active = accent.
- Toast: pill at top, `#1E1E21` fill, 1 px `#2E2E33` border, 8 px orange dot, 14 px weight 500, auto-hide 2.6 s.

## Mac layout (≥ 900 px wide; reference 1120 × 700)
- Left column 400 px (border-right `--track`): same Timer content, counter 64 px, button 188 px in a 232 px ring; bottom card shows "This week".
- Right: History. Header row = title + filter pills (Last 2 weeks / This month / All) + Export CSV.
- Table card with 5 equal columns: DATE · DAY · CLOCK IN · CLOCK OUT · TOTAL HOURS (right-aligned).
  Row: `16 Nov 2026 | Monday | 8:00 am | 5:00 pm | 9.00`. Week header rows on `#121214`.

## Motion
- 200 ms ease-out for state changes; START → FINISH cross-fade + scale 0.96 → 1.
- Counter digits never shift (tabular-nums).
- Logged: toast slides down 12 px + fade; History row inserts with a 150 ms fade.
- `prefers-reduced-motion`: no scale or slide, fades only.

## Accessibility
- Real `<button>` elements; START `aria-label="Start timer"`; FINISH `aria-label="Finish: press and hold for one second"`, Enter/Space also finishes.
- Toasts in `role="status"`. Text contrast ≥ 4.5:1 (muted #8E8E93 on #0A0A0B passes).
