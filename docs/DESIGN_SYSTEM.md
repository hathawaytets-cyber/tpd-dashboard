# Design System

One black-and-gold system for the public site and the private headquarters,
derived from the department badge. Tokens live in `src/app/globals.css`;
components in `src/components/ui`; the app shell in `src/components/shell`.

## Principles
1. **The badge sets the palette.** Obsidian field, heritage gold, warm ivory. Gold marks action, rank and live state; it is never decoration.
2. **Real units, real data.** Activity is shown in hours and 15-minute blocks (hour meter). No decorative or invented statistics; sample data is always labelled.
3. **One primary action per view.** Start patrol on Overview and Patrol; New request in Requests; Confirm in every admin dialog.
4. **Consequences before commitment.** Admin and approval flows show what changes (access, vehicles, exemptions) before the confirm button is enabled, and always require a reason.
5. **Policy is cited, not paraphrased into rules.** Guidance text names its handbook section (HB §x.y).
6. **Hiding is not authorizing.** Navigation, palette results and menus are filtered for clarity; `can()` in `src/lib/authz` is the check, and the store re-checks every operation.

## Brand assets (`public/brand`)
| Asset | Notes |
|-------|-------|
| `tpd-badge.png` | Transparent cut-out of the official badge, unaltered. Source is 207×265 px, so do not render it larger than ~130 px wide; a higher-resolution original is needed for print or large hero use. |
| Favicon / touch icon | Generated from the badge. |
| `charger-*.webp` | In-game Charger photo (public hero). |
| `tampa-banner-*.webp` | Tampa skyline banner (stats band, footer at 12% opacity). |

## Color tokens
Brand constants: **Obsidian #101113**, **Graphite #242830**, **Heritage gold #D5AB36**, **Warm ivory #F7F5EF**.

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `bg` | #F4F2EC | #0D0E10 | Page background |
| `surface` / `surface-2` / `sunken` | #FFF / #FAF9F5 / #ECEAE3 | #16181C / #1B1E23 / #0A0B0D | Panels, footers of panels, inputs and empty meter cells |
| `ink` / `ink-2` / `muted` | #121317 / #3D3B36 / #67635A | #ECEAE4 / #C5C8CE / #8B93A0 | Text hierarchy |
| `line` / `line-strong` | #E7E3DA / #CFCABD | #262A31 / #353A43 | Dividers inside panels / control borders |
| `edge` | rgb(41 37 28 / 9%) | = `line` | Resting panel outline, paired with `shadow-card` |
| `gold` (+ `on-gold` #121317) | #D5AB36 | #D5AB36 | Gold buttons, live duty, highlights |
| `gold-ink` | #7A5C0E | #D5AB36 | Gold text and focus ring (AA on light surfaces) |
| `primary` | #121317 | #ECEAE4 | Default solid button |
| `green` / `amber` / `red` / `info` | status | status | Approved or met / pending or below half / denied, end patrol, suspension / submitted |
| `obsidian`, `obsidian-2`, `graphite`, `dark-line`, `on-dark` | always dark | always dark | Sidebar, duty console, public header, hero and footer |

Each status colour has a `-soft` background pair for pills. `on-red` keeps danger buttons readable in both themes.
Contrast checked: ink on gold 8.6:1, gold on dark background 8.9:1, gold-ink on white ≥ 6:1, muted ≥ 4.97:1 on every light surface (bg, surface, surface-2, sunken).
Light-theme greys are tinted warm to match the ivory canvas.
Theme follows the OS and can be overridden (stored in `localStorage` as `tpd-theme`).

## Typography
Archivo variable (self-hosted, `wdth` axis). `.display` and `.display-x` use the wide cuts for page titles, names and big numbers; body text is the normal width. Tabular numerals (`.tabular`) for times, call signs and counts. Sentence case throughout, including nav group labels. Hierarchy comes from size, weight and colour together: page title (24/32 px display, 20 px on phones) → panel title (14 px semibold, ink) → body and row titles (13 px, row titles semibold) → secondary (12 px muted) → meta (11 px muted). Eyebrows above page titles are muted; gold is kept for actions, live duty state and links.

## Layout
- HQ: collapsible obsidian sidebar (persisted), top bar with breadcrumbs, palette, quick create and notifications; `Page` / `PageHeader` set width and rhythm. Wide pages for tables.
- Mobile: bottom tab bar and navigation drawer; sheets go full screen; no horizontal page overflow (tested).
- Public: obsidian header and hero, ivory content sections, banner footer. The gold roleplay disclaimer is always the first line of the page.

## Components (`src/components/ui`)
Buttons (primary, gold, secondary, ghost, danger; loading state), fields, select, textarea, search; pills, dots and live dots; cards and sections; `Dialog` and `Sheet` on native `<dialog>` (focus trap, Escape, inert background from the platform; nested dialogs do not close their parent); popovers and menus with full keyboard support; tooltips; toasts; skeletons and empty states; tabs and segmented controls; hour meter, bar, stack and capacity charts with legends; `DataTable` (sort, column visibility persisted, selection, row menus, sticky header, pagination, CSV export).

## Depth and emphasis
- Elevation tokens, each a tight contact shadow plus a soft ambient one, tinted warm: `shadow-sm` (controls), `shadow-card` (resting panels, with `border-edge`), `shadow-md` (hover / raised), `shadow-lg` (overlays). Dark theme relies on `line` borders because shadows do not read on near-black.
- The normal state is quiet: "Recorded" sessions and "Active" members render as muted text, and the neutral pill has no ring, so amber, red, info and gold pills stand out as exceptions.
- Repeated row links ("View") are muted until hover; one gold link per panel header.
- Empty states say what will appear and use `EmptyState compact` inside panels (icon beside copy, left aligned).

## Interaction
- Ctrl/⌘K palette searches pages, people and actions and only lists what `can()` allows. `g` + letter shortcuts; `?` opens the shortcut sheet; `[` collapses the sidebar.
- Every mutation is guarded against double submit and shows a toast. Destructive or consequential actions confirm with a specific verb ("Confirm promotion", "End patrol").
- Focus ring is `focus` (gold-ink), defined in `@layer base` so utilities can override it.
- Motion is short (≤200 ms) and disabled under `prefers-reduced-motion`.
- Anything that is not wired to real data says so with a "Design preview" or "Sample" label.
