# BoxAI Product Documentation System

Complete design for a **user-friendly and AI-friendly** documentation system,
hosted **in-product** at `https://you-box.com/docs`.

| | |
|--|--|
| Status | **P0 + P1 core implemented** (2026-08-04); P2 optional |
| Product | BoxAI (`you-box.com`) |
| Primary market | Vietnam (`vi`) |
| Secondary | Other overseas (`en` first; zh/ja/fr/ru later) |
| Hosting | **In-app** on the main SPA — not a separate docs site |
| Related | `web/default/src/features/docs/*`, `common/seo.go`, `docs/environment.md`, `deploy/README.md` |

This document is the single source of truth for the public docs redesign.
Engineering notes in this repo’s top-level `docs/` stay internal; only content
under the product docs pipeline is public.

---

## 0. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Hosting | **In-built** `you-box.com/docs` (same SPA, same deploy as web) |
| D2 | Separate domain | **No** `docs.you-box.com` for P0–P2 |
| D3 | Content source | **Markdown files + frontmatter** (not TS constants, not full MDX) |
| D4 | Languages (P0) | **`en` (source) + `vi` (full core path)** |
| D5 | Screenshots | WebP multi-width; annotations as **overlay**, not baked-in arrows |
| D6 | API protocol pages | Keep **data-driven** from `IntegrationProfile`; do not hand-write every protocol |
| D7 | OpenAPI | Embed / link from product docs in P1; do not replace MD guides |
| D8 | Console help | Same MD source → full page **and** optional Help drawer excerpts |
| D9 | Repo `docs/` | Internal (ops, design, agents). Public IA does not list these files |
| D10 | Success bar | New user completes **sign-up → key → first 200 response** via docs in ≤ 5 minutes |

---

## 1. Goals and non-goals

### 1.1 Goals

1. **User-friendly:** task-oriented paths, one step / one figure, deep links into
   console features, mobile-usable, Vietnamese-complete on core journeys.
2. **AI-friendly:** stable URLs, Markdown truth in git, machine manifest,
   executable samples, structured error tables, alt text so figures are not the
   only carrier of information.
3. **Maintainable:** writers edit MD; engineers own shell, components, CI
   screenshots; one content pipeline feeds SEO, search, and in-console help.
4. **On-brand / on-market:** Vietnam-first examples (Zalo, Waffo, `+84`) without
   China-domestic assumptions.

### 1.2 Non-goals (P0–P2)

- Standalone Docusaurus / Nextra / GitBook site
- Full MDX compile chain in Rsbuild
- Putting long doc bodies into `i18n/locales/*.json`
- Video-first onboarding (optional later)
- Versioned multi-release docs portal (`/docs/v1`, `/docs/v2`) until API
  breakage volume justifies it
- Publishing internal design docs (`document-artifacts.md`, etc.) to the public nav

---

## 2. Current state (baseline)

| Area | Today | Gap |
|------|-------|-----|
| Route | `/docs`, `/docs/$slug` | Flat slugs only; index redirects to `what-is-boxai` |
| Content | `web/default/src/features/docs/content.ts` (`GLOBAL_DOCS` × 4) | Hard to extend; no figures |
| Protocol docs | Dynamic from `IntegrationProfile` + `sample-builder` | Good pattern — keep |
| Render | Custom React sections + `CodeBlock` | No shared MD pipeline for guides |
| Markdown stack | `components/ui/markdown.tsx` (marked + DOMPurify) | Reuse for guide bodies |
| Screenshots | `public/desktop-screenshots/*` (marketing) | No console/docs screenshot system |
| SEO | `common/seo.go` + `lib/seo.ts` list 4 doc paths; generic fallback for other `/docs/*` | Must track real IA |
| i18n | Every string via `t('English key')` | Fine for chrome; wrong for long guides |
| OpenAPI | `docs/openapi/*.json` | Not surfaced in product docs |
| Repo docs | Ops/design/glossaries | No public/internal split documented |

---

## 3. Information architecture

### 3.1 Public URL tree

```
/docs                              Home (audience rails + search)
/docs/start/what-is-boxai
/docs/start/getting-started
/docs/start/first-request
/docs/console/api-keys
/docs/console/model-hub
/docs/console/billing-topup
/docs/console/usage-logs
/docs/console/profile-security
/docs/api/overview
/docs/api/streaming
/docs/api/errors
/docs/api/auth
/docs/api/{profile.docs_slug}       Dynamic protocol pages (unchanged source)
/docs/clients/desktop
/docs/clients/connect
/docs/clients/third-party
/docs/playground/overview
/docs/playground/document-generation   (user-facing subset only)
/docs/concepts/models-groups-quota
/docs/concepts/billing-units
```

Admin-only material (channel config, ratio, system settings):

- **P0:** omit from public nav
- **P1+:** `/docs/admin/*` gated in UI (link visible only when `role >= admin`)
  and `noindex` if the HTML is still reachable

### 3.2 Audience rails (home)

| Rail | Primary paths | Persona |
|------|---------------|---------|
| Use the website | `start/*`, `console/*` | VN end user |
| Integrate the API | `api/*`, `start/first-request` | Developer |
| Install clients | `clients/*` | Desktop / IDE users |
| Playground | `playground/*` | Power users in-browser |

### 3.3 Content vs engineering docs

| Tree | Audience | Published? |
|------|----------|------------|
| `web/default/content/docs/**` | Users + public AI crawlers | Yes → `/docs` |
| `docs/**` (repo) | Engineers, agents, ops | No (git / internal only) |
| `.agents/skills/**` | Amp agents | No |
| `docs/openapi/**` | Developers | Yes **via** product docs embed/link, not as raw nav dump |

### 3.4 Redirect map (compat)

Old flat slugs must keep working:

| From | To |
|------|----|
| `/docs` | `/docs` home (stop auto-jump-only; home is real) |
| `/docs/what-is-boxai` | `/docs/start/what-is-boxai` |
| `/docs/getting-started` | `/docs/start/getting-started` |
| `/docs/streaming` | `/docs/api/streaming` |
| `/docs/errors` | `/docs/api/errors` |
| `/docs/{profile.docs_slug}` | `/docs/api/{profile.docs_slug}` |

Implement with TanStack Router redirects **and** keep Go SEO `LookupSEOPage`
aware of both old and new paths during the transition window.

---

## 4. User experience specification

### 4.1 Shell layout

```
┌──────────────────────────────────────────────────────────────┐
│ Public top nav (existing)                    Lang · Theme    │
├────────────┬─────────────────────────────┬───────────────────┤
│ Sidebar    │ Article                     │ On this page TOC  │
│ · Search   │ H1, summary                 │ · H2/H3 anchors   │
│ · Rails    │ Body (MD + figures)         │ · Related links   │
│ · Sections │ Prev / Next                 │ · Feedback Y/N    │
│            │                             │                   │
│ Mobile: Sheet (already patterned)        │ Hide < md         │
└────────────┴─────────────────────────────┴───────────────────┘
```

### 4.2 Page template (every user guide)

1. **Title** — task or concept name  
2. **Summary** — one sentence outcome  
3. **Prerequisites** — account, balance, permissions  
4. **Steps** — ordered; each step may have a figure  
5. **Verify success** — observable result (“HTTP 200”, “key prefix `sk-` shown once”)  
6. **Common failures** — table or bullets with fixes  
7. **Next** — 1–3 deep links  

Developer pages add: auth headers, full samples (curl / Python / TS / JS tabs),
rate-limit notes, link to Model Hub for exact model IDs.

### 4.3 In-console help (same source)

| Surface | Behavior |
|---------|----------|
| Empty API Keys | CTA → `/docs/console/api-keys` + optional drawer with `excerpt` section |
| Playground first run | Checklist from `start/first-request` frontmatter `checklist[]` |
| Error / 429 UI | Link with hash `/docs/api/errors#rate-limits` |
| Top nav / footer | Docs entry (already partially present) |

Drawer loads **compiled excerpt** from the same MD (`<!-- excerpt:start -->` …
`<!-- excerpt:end -->` or frontmatter `excerpt_path`), never a second wiki.

### 4.4 Accessibility and mobile

- Figures: meaningful `alt`, visible caption, focusable if zoomed  
- Steps: real `<ol>` / headings, not screenshot-only instructions  
- Contrast AA; tap targets ≥ 44px on mobile CTAs  
- Code blocks horizontal scroll, copy button always available  
- VN low-end Android: WebP, lazy-load below-fold figures, avoid 3MB PNGs  

### 4.5 Feedback

Lightweight end-of-page control:

- “Did this page help?” Yes / No  
- Optional short comment  
- POST to existing feedback channel or a minimal `POST /api/docs/feedback`
  (auth optional; rate-limit by IP)  
- P0 may log only; P1 dashboards optional  

---

## 5. AI-friendly design

### 5.1 Principles

1. **Stable slugs** — treat paths as API; renames need redirects forever.  
2. **Git-native truth** — agents read `content/docs/**/*.md` without a browser.  
3. **Manifest first** — machines discover pages via `docs-manifest.json`.  
4. **Executable samples** — complete URL, header, body; placeholder model
   `YOUR_MODEL_ID` + link to Model Hub.  
5. **Structure over prose** — error codes, limits, prerequisites as lists/tables.  
6. **Dual-channel facts** — anything in a screenshot also appears as text.  
7. **Single terminology** — align with `docs/translation-glossary*.md` and product copy.  

### 5.2 Build artifacts

Emitted at frontend build into `web/default/public/doc-assets/` (or `dist` copy).
Static assets intentionally use `/doc-assets/*` (not `/docs/*`) so the Gin static
file server does not shadow SPA product-docs routes under `/docs`.

| Artifact | Purpose |
|----------|---------|
| `docs-manifest.json` | All pages: path, locale, title, summary, section, order, audience, updated, headings |
| `docs-search.{locale}.json` | MiniSearch/FlexSearch documents (title, headings, body plain text) |
| `llms.txt` (P1) | Curated URL list + one-line summaries for crawlers/agents |
| Sitemap entries | Merge doc paths into existing sitemap generation |

Example manifest entry:

```json
{
  "path": "/docs/console/api-keys",
  "locale": "en",
  "title": "Create and manage API keys",
  "summary": "Issue a key, set limits, and call the gateway from your server.",
  "section": "console",
  "order": 20,
  "audience": ["user", "developer"],
  "updated": "2026-08-04",
  "headings": [
    { "id": "create-a-key", "text": "Create a key", "level": 2 },
    { "id": "rotate-a-key", "text": "Rotate a key", "level": 2 }
  ],
  "has_vi": true
}
```

### 5.3 Frontmatter schema

```yaml
---
title: Create and manage API keys
summary: Issue a key, set limits, and call the gateway from your server.
section: console          # start | console | api | clients | playground | concepts | admin
order: 20                 # sort within section
audience: [user, developer]
updated: 2026-08-04
status: published         # draft | published
og_image: /doc-assets/screenshots/console/api-keys-create.en.webp
checklist:                # optional; console first-run
  - Create an API key
  - Copy the secret once
  - Send a test request
noindex: false            # true for admin/draft
---
```

Validation: build fails if required fields missing, slug collides, or `status:
published` page lacks `vi` counterpart while `section` is in the **core path**
set (see §11).

### 5.4 Writing rules for models and humans

- One H1 (= title).  
- H2 = durable anchor ids (`## Rate limits` → `#rate-limits`).  
- Never put secrets in samples; use `$BOXAI_API_KEY`.  
- Prefer `https://you-box.com` as canonical host in prose; runtime samples may
  substitute `status.server_address` like today.  
- Call out non-retryable vs retryable errors explicitly.  
- When UI labels are localized, refer to **meaning** (“API Keys page”) and show
  the `vi` label in the Vietnamese file.  

---

## 6. Content pipeline (technical)

### 6.1 Directory layout

```
web/default/
  content/
    docs/
      meta.ts                 # section labels, rail config, core-path list
      en/
        start/
          what-is-boxai.md
          getting-started.md
          first-request.md
        console/
          api-keys.md
          ...
        api/
          overview.md
          streaming.md
          errors.md
          auth.md
        clients/
          desktop.md
          ...
        playground/
          ...
        concepts/
          ...
      vi/
        start/...
        console/...
        ...
  public/
    docs/
      screenshots/
        console/
          api-keys-create.en.webp
          api-keys-create.en-480.webp
          api-keys-create.en-960.webp
          api-keys-create.en-1536.webp
        ...
      docs-manifest.json          # generated
      docs-search.en.json         # generated
      docs-search.vi.json         # generated
      llms.txt                    # generated (P1)
  scripts/
    docs/
      build-content.mjs           # parse MD → JSON modules + manifest + search
      validate-content.mjs
  src/features/docs/
    index.tsx                     # shell (evolves from current)
    home.tsx                      # audience rails
    article.tsx                   # MD article renderer
    protocol-page.tsx             # IntegrationProfile pages (from current ProfileContent)
    components/
      doc-figure.tsx
      doc-steps.tsx
      doc-callout.tsx
      doc-pager.tsx
      doc-toc.tsx
      doc-search.tsx
      doc-feedback.tsx
      doc-excerpt.tsx             # console drawer
    lib/
      load-doc.ts                 # read generated JSON by path+locale
      nav.ts                      # sidebar from manifest + meta
      redirects.ts
    content.ts                    # DELETE after migration
  src/routes/_public/docs/
    index.tsx                     # home (no blind redirect)
    $.tsx                         # splat: start/getting-started, api/foo, ...
```

### 6.2 Build step

```text
bun run docs:build
  → read content/docs/{en,vi}/**/*.md
  → gray-matter / lightweight frontmatter parse
  → emit src/features/docs/generated/*.json (or importable modules)
  → emit public/doc-assets/docs-manifest.json
  → emit public/doc-assets/docs-search.{en,vi}.json
  → validate core-path vi coverage
```

Wire into:

- `package.json`: `"docs:build": "node scripts/docs/build-content.mjs"`  
- `build` / `build:check`: run `docs:build` first  
- Optional Rsbuild pre-hook  

Do **not** fetch MD over the network at runtime for published pages.

### 6.3 Runtime rendering

1. Route `docs/$` → normalize path → lookup manifest.  
2. Resolve locale: `i18n.language` → `vi` | `en` fallback.  
3. If guide page: render HTML from prebuilt body **or** MD string through
   existing `Markdown` + custom block post-process.  
4. If path matches `IntegrationProfile.docs_slug` under `/docs/api/…`: render
   `protocol-page` (samples + notes).  
5. Unknown → existing empty state.  

**Custom blocks** (MD directives, P0 subset):

```markdown
:::callout type="warning"
Never put API keys in frontend code or screenshots.
:::

:::steps
1. Open **API Keys**
2. Click **Create**
3. Copy the secret once
:::

![Create API key dialog](/doc-assets/screenshots/console/api-keys-create.en.webp "1. Console → API Keys → Create")
```

Implementation options (pick one in P0 impl):

- **A (preferred):** preprocess directives → HTML/components in `build-content.mjs`  
- **B:** thin runtime parser on fenced `::: ` blocks before `marked`  

Avoid full MDX (`jsx` in markdown) in P0.

### 6.4 Components

| Component | Role |
|-----------|------|
| `DocFigure` | `srcset` WebP, caption, optional `%` annotations overlay |
| `DocSteps` | Numbered steps; pairs text + optional figure |
| `DocCallout` | `info` \| `warning` \| `danger` \| `tip` |
| `DocPager` | Prev/next from manifest order |
| `DocToc` | IntersectionObserver active heading |
| `DocSearch` | Client MiniSearch over `docs-search.{locale}.json` |
| `DocFeedback` | Y/N + optional note |
| `CodeBlock` | Reuse; inject base URL |
| Protocol tabs | Reuse current language tabs + `buildIntegrationSample` |

### 6.5 Routing detail

- Replace flat `$slug` with splat `docs/$` (or `_public/docs/$` + path join).  
- Home: `/docs/` renders rails; **do not** only redirect.  
- Legacy redirects table in one module used by router `beforeLoad`.  

### 6.6 SEO

| Layer | Action |
|-------|--------|
| `common/seo.go` `PublicSEOPages` | Generate from manifest **or** maintain a generated Go/JSON include in P1; P0 manually extend list for core paths |
| `LookupSEOPage` | Prefer manifest titles/descriptions; keep generic fallback |
| `web/default/src/lib/seo.ts` | Mirror core paths; client `useSeo` reads frontmatter via page loader |
| `noindex` | drafts + admin |
| OG image | per-page `og_image` or section default |

Sitemap: include every `status: published` path × locale strategy (if locale is
path-less and depends on Accept-Language/UI, sitemap stays language-neutral URLs
with hreflang only if we later add `/vi/docs` — **P0 keeps single URL, client
locale**, same as the rest of the SPA).

---

## 7. Internationalization

| Content | Mechanism |
|---------|-----------|
| Shell (nav labels, search placeholder, feedback) | `t('...')` + locale JSON |
| Guide body | Parallel files `en/**/*.md`, `vi/**/*.md` |
| Missing `vi` | Show `en` + banner “This page is not fully translated yet” |
| Protocol profile names | Existing `name_key` i18n |
| Screenshots | Share EN UI shots until VI UI differs; then `*.vi.webp` |

**Core path** (must have `vi` at publish):

- All of `start/*`  
- `console/api-keys`, `console/model-hub`, `console/billing-topup`, `console/usage-logs`  
- `api/overview`, `api/streaming`, `api/errors`, `api/auth`  
- `clients/desktop`  

Other locales (zh, ja, fr, ru): P2 opportunistic; do not block P0.

---

## 8. Screenshot system

### 8.1 Standards

| Rule | Spec |
|------|------|
| Viewport | 1440×900 desktop; capture **content region** when possible |
| Theme | Light default; dark optional `*.dark.webp` |
| Format | WebP; widths 480 / 960 / 1536 (match desktop marketing set) |
| Naming | `{area}/{action}.{locale}.webp` and `{action}.{locale}-{width}.webp` |
| PII | Fake email, fake balance, keys like `sk-boxai-••••••••` only |
| Text in image | Prefer English UI for shared assets; VI docs still describe in Vietnamese |
| Annotations | SVG/HTML overlay via `DocFigure` (`annotations: [{x,y,label}]` in %) |
| Alt + caption | Mandatory; caption carries the step instruction |

### 8.2 Storage

```
web/default/public/doc-assets/screenshots/
  start/
  console/
  api/          # rare; prefer diagrams
  clients/
  playground/
```

Git LFS only if sizes become painful; current desktop webps are small enough for
normal git.

### 8.3 Automation (P1)

```
web/default/scripts/doc-assets/screenshots/
  playwright.config.ts
  auth.setup.ts              # seed user via env, never commit secrets
  scenarios/
    console-api-keys.ts
    console-model-hub.ts
    console-billing.ts
    start-first-request-playground.ts
    clients-desktop-marketing-reuse.ts
  README.md
```

Commands:

```bash
bun run docs:screenshots           # local
bun run docs:screenshots --changed # CI: scenarios mapped from git diff paths
```

CI: run on PR when `web/default/src/features/{keys,billing,playground,pricing}/**`
or docs scenarios change; upload artifacts for review; commit updates in a follow-up
or auto-commit policy (team choice — default **manual commit after review**).

### 8.4 P0 manual shot list (must ship)

1. Sign-in / Zalo entry (marketing-safe)  
2. API Keys list empty + create dialog  
3. Key created once (redacted)  
4. Model Hub list + model detail  
5. Playground simple chat success  
6. Top-up / Waffo entry (no real payment data)  
7. Usage logs table with sample rows  
8. Desktop install / session (reuse `desktop-screenshots` where possible)  

---

## 9. API / protocol docs

Keep the current dynamic model:

```
IntegrationProfile (API)
  → sidebar under Protocols / api
  → protocol-page: method, path, auth, streaming, PROFILE_NOTES, multi-lang sample
```

Enhancements:

| Item | When |
|------|------|
| Nest under `/docs/api/{docs_slug}` | P0 |
| “Open in Model Hub” filtered by profile | P0 |
| Link from guide MD via explicit path | P0 |
| Embed OpenAPI operation panel (Scalar or compact tables from `docs/openapi`) | P1 |
| Per-model “Try” deep link into playground with model preselected | P1 |

`PROFILE_NOTES` move from TS map into optional MD fragments
`content/docs/en/api/_notes/{sample_kind}.md` when notes grow; until then TS is fine.

---

## 10. Search

**P0:** client-side MiniSearch (or FlexSearch) loaded from
`/docs/docs-search.{locale}.json` (~small for dozens of pages).

Index fields: `title` (boost), `summary`, `headings`, `body` (plain text stripped).

**P1:** keyboard `⌘K` / `Ctrl+K` docs-scoped command; highlight hash on navigate.

**Not P0:** server Elasticsearch, Algolia (cost + VN tokenization complexity).

Vietnamese: start with unicode-aware tokenization; revisit dedicated VN analyzer
only if recall is poor.

---

## 11. Phased delivery

### P0 — Foundation (shippable docs product)

**Engineering**

1. `content/docs` tree + `meta.ts`  
2. `scripts/docs/build-content.mjs` + validate  
3. Route splat + home rails + redirects  
4. `DocFigure`, `DocSteps`, `DocCallout`, `DocPager`, `DocToc`  
5. Migrate 4 existing pages → MD (en+vi)  
6. Protocol pages nested under `/docs/api/...`  
7. SEO list updated for new core paths  
8. Delete `GLOBAL_DOCS` from `content.ts` after parity  

**Content + screenshots (manual)**

9. Core path pages written en+vi (§7)  
10. Eight manual screenshot sets (§8.4) wired into steps  

**Exit criteria**

- `/docs` home works on mobile  
- Getting started path works end-to-end with figures  
- Old slugs redirect  
- `bun run build` runs `docs:build`  
- vi present for all core paths  

### P1 — Depth and maintainability

1. Playwright screenshot pipeline  
2. Annotation overlays polished  
3. Client search + `⌘K`  
4. Console empty-state + Help drawer excerpts  
5. `docs-manifest` consumed by SEO generation helper  
6. OpenAPI embed or generated endpoint tables  
7. Feedback endpoint  
8. `llms.txt`  
9. Optional admin section (gated)  

### P2 — Platform

1. Additional locales  
2. Docs versioning if/when needed  
3. Feedback analytics → content backlog  
4. Optional subdomain **only** if writing volume or multi-product split demands it  
5. Support bot RAG over manifest + MD (same tree)  

---

## 12. Work breakdown (implementation checklist)

### 12.1 Frontend

- [ ] Add `content/docs/**` and sample pages  
- [ ] `scripts/docs/build-content.mjs`  
- [ ] `package.json` scripts: `docs:build`, `docs:validate`  
- [ ] Routes: home + splat + redirects module  
- [ ] Shell refactor: sidebar from manifest, TOC, pager  
- [ ] Components: figure/steps/callout/search/feedback  
- [ ] Protocol page move + sample base URL  
- [ ] i18n chrome strings (nav section titles, banners)  
- [ ] `useSeo` from page meta  
- [ ] Console deep links (keys, billing, playground empty states)  
- [ ] Tests: redirect table, manifest validate, render smoke for one MD page  

### 12.2 Backend / SEO

- [ ] Extend `PublicSEOPages` for new paths (P0 manual or generated JSON)  
- [ ] Redirect-aware `LookupSEOPage` during transition  
- [ ] Optional `POST /api/docs/feedback` (P1)  
- [ ] Rate limit feedback  

### 12.3 Content

- [ ] en+vi core path set  
- [ ] Glossary alignment pass (`docs/translation-glossary.md`)  
- [ ] Desktop page reuses marketing screenshots  
- [ ] Third-party clients page (Cherry Studio etc. may reuse `docs/images`)  

### 12.4 Tooling / CI

- [ ] PR check: `docs:validate`  
- [ ] Playwright docs screenshots job (P1)  
- [ ] Danger or script: fail if core path missing `vi`  

### 12.5 Agent / ops docs (repo)

- [ ] This file (`docs/product-docs-system.md`) is canonical  
- [ ] Short pointer from root `README.md` → public docs + this design  
- [ ] Do **not** auto-publish repo `docs/*.md`  

---

## 13. Migration plan

1. **Land pipeline empty** — build scripts + empty sections, home rails with placeholders.  
2. **Shadow write** — MD copies of current 4 pages; feature flag or parallel routes.  
3. **Cut over** — splat router reads MD; keep redirects from old slugs.  
4. **Expand core path** — console + first-request with screenshots.  
5. **Remove** `GLOBAL_DOCS` and dead code paths.  
6. **SEO verify** — `curl` sitemap + spot-check `LookupSEOPage`.  
7. **Announce** — footer/docs nav already points to `/docs`; update any hardcoded old slugs in app.  

No DB migration. No production env vars required for P0.

---

## 14. Quality bar and testing

| Layer | What to test |
|-------|----------------|
| Unit | frontmatter parse, slug normalize, redirect map, search index build |
| Component | DocFigure srcset, callout variants, TOC active state |
| Route | legacy redirects, 404, locale fallback banner |
| Content CI | schema + core vi coverage + broken relative links |
| Visual (P1) | Playwright screenshot diff optional; at least scenario smoke |
| A11y | sidebar keyboard, headings order, img alt |
| Perf | docs chunk lazy; search JSON &lt; ~500KB per locale initially |

Backend test rules in `AGENTS.md` still apply: no junk coverage tests.

---

## 15. Metrics

| Metric | Target (directional) |
|--------|----------------------|
| Time-to-first-success (docs-assisted) | ≤ 5 min qualitative UX test |
| Docs → Create key click-through | Track via link `?from=docs` |
| Core path vi coverage | 100% |
| “Page helpful” Yes rate | Baseline then ↑ |
| Support tickets: key/topup/first-call how-to | ↓ over 30–60 days |
| Broken docs links in CI | 0 |
| Screenshot scenarios red on main | 0 (P1+) |

---

## 16. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| MD pipeline stalls on perfect MDX | Directives-only; reuse `marked` |
| Screenshot bitrot after UI churn | P1 Playwright + overlay annotations |
| i18n drift en vs vi | validate core paths; banner on fallback |
| SEO regression on slug change | permanent redirects + dual SEO entries during window |
| Scope creep (admin, videos, subdomain) | Locked non-goals §1.2 |
| Writers blocked on engineering | MD files + preview via `make dev-web` once pipeline lands |
| Leaked secrets in shots | Scenario fixtures + review checklist |

---

## 17. Open questions (resolve during P0 kickoff)

1. Feedback storage: existing form endpoint vs new minimal API?  
2. Should locale ever appear in the path (`/vi/docs/...`) for SEO, or stay SPA-locale-only? **Default: SPA-locale-only.**  
3. Admin docs in P1 or keep internal forever? **Default: P1 gated.**  
4. Who owns content edits (eng vs ops vs support)? Recommend: eng owns shell; any team PRs MD.  

---

## 18. Recommended immediate next implementation slice

Smallest vertical slice that proves the system:

1. `content/docs/en/start/getting-started.md` + `vi/...`  
2. `docs:build` → manifest  
3. `/docs` home + `/docs/start/getting-started` render  
4. One `DocFigure` with real screenshot  
5. Redirect `/docs/getting-started` → new path  
6. Sidebar shows Start section  

Then expand console/api-keys and first-request before bulk migration.

---

## 19. Appendix A — Core path inventory (P0 content)

| Path | en | vi | Figures |
|------|----|----|---------|
| `/docs/start/what-is-boxai` | migrate | yes | optional diagram |
| `/docs/start/getting-started` | migrate+expand | yes | key + hub |
| `/docs/start/first-request` | new | yes | playground + curl |
| `/docs/console/api-keys` | new | yes | 2–3 shots |
| `/docs/console/model-hub` | new | yes | 1–2 shots |
| `/docs/console/billing-topup` | new | yes | Waffo entry |
| `/docs/console/usage-logs` | new | yes | 1 shot |
| `/docs/api/overview` | new | yes | — |
| `/docs/api/auth` | new | yes | — |
| `/docs/api/streaming` | migrate | yes | — |
| `/docs/api/errors` | migrate | yes | — |
| `/docs/api/{profile}` | dynamic | via i18n keys | code only |
| `/docs/clients/desktop` | new | yes | reuse desktop webps |

## 20. Appendix B — Terminology (public)

| Term | Meaning |
|------|---------|
| BoxAI | Product name (one word) |
| you-box.com | Official site and API host |
| Gateway | BoxAI API entry (`/v1/...`) |
| Model Hub | Public pricing/catalog UI (`/pricing`) |
| Group | Access/billing group for models and rates |
| API key | Bearer (or profile-specific) credential |
| Quota | Remaining usage budget |
| Playground | In-browser chat / tools UI |
| Desktop | BoxAI Desktop client |
| Connect | BoxAI Connect configurator |

## 21. Appendix C — Explicit non-publish list

Do not add to public nav without a dedicated user-facing rewrite:

- `docs/document-artifacts.md`  
- `docs/environment.md`  
- `docs/desktop-integration.md` (internal integration; user install is separate)  
- `docs/playground-p1-p3.md`  
- `deploy/README.md`  
- `.agents/**`  
- `pkg/billingexpr/expr.md`  

---

## 22. Document history

| Date | Change |
|------|--------|
| 2026-08-04 | Initial complete scheme: in-app docs, MD pipeline, screenshots, AI manifest, P0–P2 |
