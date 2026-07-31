# BoxAI Brand Kit

Source mark: spiral / vortex flower (coral → peach gradient, cream core).

## Source files

| File | Role |
|------|------|
| `WechatIMG179.jpg` | Original export (4096² PNG misnamed `.jpg`; heavy WeChat/AI dither noise) |
| `mark-master.png` | Cleaned transparent mark (cropped, despeckled) |
| `exports/` | Ready-to-ship derivatives |
| `scripts/build-brand-kit.py` | Regenerate all exports + site/app icons from `mark-master.png` |

## Brand tokens

| Token | Value | Notes |
|-------|-------|--------|
| **Primary (UI)** | `#E05A3A` | Accessible coral for buttons/links (AA on light/dark canvases) |
| **Mark mid** | `#F08050` | Dominant fill in the SVG mark |
| **Mark center** | `#FFF3E0` | Cream core |
| **Ink / app icon bg** | `#0B0B0C` | Default dark plate (product variants below) |
| **Wordmark** | `BoxAI` | Product name (not “Box AI” with space) |

UI theme default (`web/default/src/styles/theme.css`) and admin “BoxAI recommended values” both use `#E05A3A`.

## Product siblings (same coral mark)

| Product | Treatment | Mark | Plate | UI accent |
|---------|-----------|------|-------|-----------|
| **Web** | Coral logo | `#F08050` | transparent | `#E05A3A` |
| **Desktop** | **Same coral logo as-is** | original | `#0B0B0C` | `#E05A3A` |
| **Connect** | Same logo, **saturation ×0.78 only** | slightly softer coral | `#0B0B0C` | `#D4785C` |

No hue swap / flat recolor. Dock distinction is subtle by design.

## Where logos appear (full stack)

### Web (`web/default/public/`)

| Asset | Size | Used for |
|-------|------|----------|
| `logo.svg` | vector | Preferred site mark, favicon (SVG), admin Logo URL default |
| `logo.png` | 512² | Fallback mark (`DEFAULT_LOGO`), schema.org `logo`, header/footer if admin Logo empty |
| `box-ai-icon.svg` | vector | Same mark (legacy path; still valid) |
| `favicon.ico` | 16/32/48 | Browser tab (legacy clients) |
| `favicon-32.png` | 32² | Explicit PNG favicon |
| `apple-touch-icon.png` | 180² | iOS home screen |
| `og-image.png` | 1200×630 | Open Graph / Twitter card (`index.html`, SEO inject) |

**Runtime (admin-configurable)** — System Settings → Site:

- `Logo` → header, sidebar brand, footer, SEO image when set
- `branding.favicon_url` → tab icon (else falls back to Logo)
- `branding.primary_color` → CSS `--brand-primary`
- `SystemName` → wordmark text next to logo

Code touchpoints:

- `web/default/src/components/layout/components/system-brand.tsx` — app chrome brand
- `web/default/src/components/layout/components/public-header.tsx` — marketing header
- `web/default/src/components/layout/components/footer.tsx` — footer mark
- `web/default/src/lib/constants.ts` — `DEFAULT_LOGO = '/logo.png'`
- `web/default/index.html` — static favicon + OG before JS
- `common/seo.go` / `router/web-router.go` — server HTML SEO inject
- `web/default/src/lib/seo.ts` — client SEO + JSON-LD Organization.logo

### Desktop (`desktop/surfaces/gui/`) — same coral as web

- Icons + tray under `src-tauri/icons/`; UI accent `#e05a3a`

### Connect (`connect/`) — slightly less saturated coral

- Icons under `src-tauri/icons/`; UI primary `#D4785C` (sat only)

## Processing pipeline (original → kit)

1. **Despeckle** — zero alpha below ~96; drop non-warm pixels (WeChat dither).
2. **Morph open** — remove isolated dots; slight blur + re-threshold edges.
3. **Tight square crop** — content bbox + ~8% pad → `mark-master.png`.
4. **Exports** — resize transparent mark; app icons on `#0B0B0C` rounded square; multi-size ICO/ICNS; OG 1200×630 card.
5. **SVG** — posterize to 2 fills → VTracer spline paths → `logo.svg` / `box-ai-icon.svg`.

```bash
python3 logo/scripts/build-brand-kit.py
```

## Recommended admin settings (production)

| Field | Value |
|-------|--------|
| System Name | `BoxAI` |
| Logo URL | `/logo.svg` |
| Browser Icon URL | `/favicon.ico` |
| Brand Primary Color | `#E05A3A` |

Or click **BoxAI recommended values** in System Settings → System Information.

## Notes / residual

- Mark has **transparent cutouts** between spiral arms — designed for both light and dark UI; app icons use a solid dark plate so the cutouts read correctly on home screens.
- Raster master still has mild soft AI edges; a hand-drawn vector redraw would be the next quality step if you need print-scale sharpness.
- Secondary theme tokens (`--secondary`, indigo-tinted surfaces) still lean cool-blue from the previous brand; a full surface repaint can follow if you want coral-tinted chrome.
- Production DB may already store old Logo / primary_color options — re-apply recommended values or set them via admin after deploy.
