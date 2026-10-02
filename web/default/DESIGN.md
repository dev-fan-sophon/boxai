# BoxAI Design Language — "Studio" (2026)

The single reference for how BoxAI looks and moves. Tokens live in
`src/styles/theme.css` and `src/styles/motion.css`; primitives in
`src/components/ui/`; icons in `src/components/icons/`. When a page needs
something this document does not cover, extend the shared layer first and then
use it — do not hand-roll a one-off look inside a feature.

## 1. Principles

1. **Content first, chrome quiet.** Warm-neutral surfaces carry the work. The
   brand coral (`primary`) is the only saturated colour in the chrome and is
   reserved for the primary action, focus and "you are here".
2. **Depth from tone and shadow, not outlines.** Page ground → inset panel →
   card → popover, each a step lighter (dark: a step up in lightness) with its
   own elevation. Borders are hairlines that separate, never heavy boxes.
3. **One rhythm.** 4px grid; controls are 32px (`sm`, toolbars and dense
   tables) or 36px (default, forms); cards pad 20px (`px-5 py-5`), compact
   cards 16px.
4. **Every string survives Vietnamese.** Vietnamese labels run ~30% longer than
   English and carry stacked diacritics. Layouts wrap or truncate on purpose;
   nothing may overflow its container or the viewport (see §6).
5. **Motion explains, never decorates.** Movement shows where something came
   from or went. Loops are ambient and slow; interaction feedback is fast.

## 2. Colour

Use semantic tokens only — the token lint (`bun run lint:tokens`) rejects raw
palette classes and hex literals.

| Role               | Tokens                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Page ground / text | `background`, `foreground`, `muted-foreground`                                                               |
| Panels             | `card`, `popover`, `surface-subtle`, `surface-sunken`, `surface-overlay`                                     |
| Brand              | `primary`, `primary-foreground`, `ring`, `brand-glow` (halo only)                                            |
| Neutral fills      | `secondary`, `muted`, `accent` (hover/selected rows & menu items)                                            |
| Status             | `success`, `warning`, `info`, `destructive` + `*-subtle` / `*-subtle-foreground` pairs for chips and banners |
| Data               | `chart-1` … `chart-12` (categorical, in order)                                                               |
| Navigation         | `sidebar*` tokens (header and sidebar share the ground)                                                      |

- Status chips: `<StatusBadge variant>` or `<Badge variant='success|warning|info|destructive'>`.
  Never `bg-green-100 text-green-700`.
- Tinted icon tiles: `<IconBadge tone>` (`src/components/ui/icon-badge.tsx`).
- Brand gradients/glows are for marketing heroes, empty states and the CTA only.
- Dark mode is first-class: near-black neutral (`#0e0e10` ground), no navy cast.

## 3. Typography

- Sans: **Inter Variable** (full Vietnamese coverage). Mono: **JetBrains Mono
  Variable** for code, keys, ids and log payloads — not for money or counters,
  which use the sans face with `tabular-nums`.
- Scale: `text-4xs` 9 · `text-3xs` 10 · `text-2xs` 11 · `text-xs` 12 ·
  `text-ui` 13 · `text-sm` 14 · `text-md` 15 · `text-base` 16 · `text-lg`+.
  Running text never goes below `text-2xs`.
- Page title `text-xl font-semibold tracking-tight`; section title
  `text-base font-semibold`; card title via `<CardTitle>`; field label
  `text-sm font-medium`; helper `text-xs text-muted-foreground`.
- Headings get `text-wrap: balance`, paragraphs `text-wrap: pretty` globally.
- Avoid ALL-CAPS labels for anything longer than two words — Vietnamese caps
  with diacritics are hard to read. Small section labels are sentence case
  `text-2xs font-medium text-muted-foreground`.

## 4. Shape & elevation

| Element                     | Radius              | Elevation                                                     |
| --------------------------- | ------------------- | ------------------------------------------------------------- |
| Buttons, inputs, menu items | `rounded-lg` (10px) | inputs: hairline + 1px contact shadow                         |
| Cards, panels, dialogs      | `rounded-2xl`       | `ring-1 ring-border` + subtle shadow; dialogs `shadow-lifted` |
| Popovers, menus, selects    | `rounded-xl`        | `shadow-lifted`                                               |
| Chips / badges              | `rounded-full`      | none, tinted fill + inset ring                                |
| App work panel (inset)      | `rounded-2xl`       | `shadow-panel`                                                |

Cards lift on hover **only** when the whole card is clickable — opt in with
`data-card-hover='true'`.

## 5. Components

Always compose from `src/components/ui/*` and the shared components in
`src/components/` (`EmptyState`, `ErrorState`, `StatCard`, `StatusBadge`,
`SectionPageLayout`, `DataTable*`, `ConfirmDialog`, `CopyButton`, …).

- **Buttons:** `default` (brand, one per view region), `outline` (secondary
  actions), `ghost` (toolbar/icon), `secondary`, `destructive` (soft, turns solid
  on hover), `cta` (marketing only). Sizes: `xs` 28, `sm` 32, `default` 36,
  `lg` 40. Icon-only buttons need `aria-label`.
- **Segmented choices** between peer modes: `<SegmentedControl>` (animated
  thumb). Panels of content: `<Tabs>`.
- **Toolbars** (tables, filters): 32px controls — `size='sm'` buttons, `h-8`
  inputs.
- **Empty states:** `<EmptyState icon title description action>`; never a bare
  "No data" string.
- **Numbers that change** (balance, counters, totals): `@number-flow/react`'s
  `<NumberFlow>` for animated transitions where a value updates in place.
- **Toasts:** `sonner` via `toast.*`, copy through `t()`.

## 6. Text wrapping rules (hard rules)

- Every flex child that holds text gets `min-w-0`; text that must stay on one
  line gets `truncate` **and** a `title`/tooltip with the full value.
- Buttons and chips never wrap their label: they `whitespace-nowrap` (built in)
  and the _row_ that holds them wraps (`flex-wrap gap-2`).
- Long machine strings (keys, URLs, model ids, JSON) use `break-all` or
  `font-mono` + `truncate`; `overflow-wrap: break-word` is on `body` globally.
- Never fix a width in px for a container that holds translated text; use
  `min-w-*`/`max-w-*`, grid `minmax(0,1fr)`, or `w-fit`.
- Tables: cells clamp with `TruncatedCell`; the page never scrolls sideways —
  tables scroll inside their own `overflow-x-auto`.
- Verify every page at 390px and 1440px in **en** and **vi**.

## 7. Icons

- `import { Name } from '@/components/icons'` — never import an icon package
  directly. The module re-exports **Phosphor** glyphs under stable semantic
  names; add a new export there when a glyph is missing.
- Default weight is `bold` (set once by `IconContext` in `main.tsx`), which
  matches the 1.5px stroke of the UI at 16px. Use `weight='fill'` for active or
  toggled-on states (favourite, pinned, active nav), `weight='duotone'` for
  large illustrative icons (empty states, feature tiles ≥ 24px).
- Sizes: `size-3.5` inline with `text-xs`, `size-4` default, `size-[1.125rem]`
  navigation, `size-5`+ feature tiles. Decorative icons get `aria-hidden`.
- Brand / provider logos are not icons: `LobeIcon`, `react-icons/si`.

## 8. Motion

Tokens: `duration-control` (180ms) · `duration-overlay` (250ms) ·
`duration-page` (320ms) · `duration-expressive` (600ms) · `duration-ambient`;
easing `ease-emphasized`. JS: `MOTION_SPRING` / `MOTION_TRANSITION` from
`src/lib/motion.ts` with `motion/react`.

- Never `transition-all`; use `transition-ui` or an explicit property list.
- Shared-element indicators (`layoutId`) for anything "active" that moves
  between siblings: tabs, segmented controls, top nav, view toggles.
- Lists that grow (generation feeds, prompt rows) animate items in with
  `AnimatePresence` + `layout`; removals animate out.
- Respect reduced motion (the root `MotionConfig reducedMotion='user'` handles
  `motion/react`; CSS animations need a `prefers-reduced-motion` branch).

## 9. Page anatomy

- **Console pages** (`SectionPageLayout`): title row (title + actions), then a
  32px toolbar, then content. Content is a grid of cards or a data table.
- **Public pages:** hero with `playground-discover-hero` wash or brand glow,
  `max-w-container` content, generous vertical rhythm (`py-16 sm:py-24`).
- **Admin settings:** left section nav (sidebar drill-in), right column of
  cards; each card = one concern with a title, description and its fields.
