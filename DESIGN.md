---
name: Bilingual Live Captions (marketing site)
description: A deep navy page with cream type and one orange voice, a beige band where the dark players show the real captions.
colors:
  navy-page: "#0f1f3d"
  navy-hover: "#1a2c50"
  navy-hairline: "#2e4166"
  cream: "#f4efe6"
  mist-muted: "#b4bed0"
  icon-orange: "#ff7744"
  beige-band: "#f3ece0"
  oat-hover: "#e8dfd0"
  sand-hairline: "#d8cdbb"
  ink: "#231f1a"
  walnut-muted: "#5d5548"
  burnt-orange: "#a8401a"
  player-umber: "#1e1b17"
  player-umber-lane: "#2c2823"
  player-edge: "#14120f"
  player-muted: "#b8ae9f"
  caption-white: "#ffffff"
  caption-amber: "#fde68a"
  signal-teal: "#5eead4"
typography:
  display:
    fontFamily: "'BLC Rounded', 'Noto Sans TC', system-ui, sans-serif"
    fontSize: "clamp(34px, 6vw, 60px)"
    fontWeight: 400
    lineHeight: 1.18
    letterSpacing: "0"
  headline:
    fontFamily: "'BLC Rounded', 'Noto Sans TC', system-ui, sans-serif"
    fontSize: "clamp(26px, 3.5vw, 34px)"
    fontWeight: 400
    letterSpacing: "0"
  title:
    fontFamily: "'BLC Rounded', 'Noto Sans TC', system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 400
  title-mode:
    fontFamily: "'BLC Rounded', 'Noto Sans TC', system-ui, sans-serif"
    fontSize: "clamp(22px, 3vw, 28px)"
    fontWeight: 400
  numeral:
    fontFamily: "'BLC Rounded', 'Noto Sans TC', system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: 1
  lead:
    fontFamily: "Inter, 'Noto Sans TC', system-ui, sans-serif"
    fontSize: "clamp(17px, 2.2vw, 20px)"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Inter, 'Noto Sans TC', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, 'Noto Sans TC', system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
rounded:
  hairline: "3px"
  sm: "6px"
  md: "8px"
  btn: "10px"
  player: "14px"
spacing:
  gutter: "16px"
  item-gap-row: "28px"
  item-gap-col: "36px"
  section: "44px"
  container: "1120px"
components:
  button-primary:
    backgroundColor: "{colors.icon-orange}"
    textColor: "{colors.navy-page}"
    rounded: "{rounded.btn}"
    padding: "0 24px"
    height: "50px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.cream}"
    rounded: "{rounded.btn}"
    padding: "0 24px"
    height: "50px"
  button-secondary-hover:
    backgroundColor: "{colors.navy-hover}"
  mode-note:
    textColor: "{colors.burnt-orange}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
  demo-player:
    backgroundColor: "{colors.player-umber}"
    textColor: "{colors.caption-white}"
    rounded: "{rounded.player}"
    padding: "12px"
---

# Design System: Bilingual Live Captions (marketing site)

Scope: this file records the marketing site in `site/` only (the en and zh-tw landing pages and the privacy page). The Chrome extension's own UI (`src/`, `entrypoints/`: popup, caption box, side panel, options, onboarding) has separate, unrelated styles and is not covered here; do not apply these tokens there.

## Overview

**Creative North Star: "The Living Room Screen"**

A deep navy room with a lit screen in it. The page is a calm, flat navy (not black, not a gradient) with warm cream text, one orange voice taken from the 雙 icon, and rounded headings that feel friendly rather than technical. The section that holds the players is a full-bleed beige band; the promo video straddles the edge between the navy hero and that band, and the two mode demos sit dark on the beige. Only inside those players do the product's real caption colours appear: white source line, amber translation.

Content is set like a well-made printed brochure, not a SaaS grid. Items sit in ruled columns under a heavy rule, rows are divided by hairlines, and nothing on the page is a rounded, filled, shadowed card. The user rejected boxed cards as looking "too AI"; the purple-blue gradient AI-tool look is equally out. The layout, section order and the orange 雙 icon are kept from the incumbent site for recognisability. History: navy-black (#0b1120) → beige restyle → this deep navy with an orange accent (user's choice, 2026-11-26).

**Key Characteristics:**
- Deep navy page (`navy-page`), cream type; one beige band (`beige-band`) for the players.
- Ruled columns and hairline rows instead of boxed cards.
- Rounded display face (BLC Rounded) for every heading, Inter + Noto Sans TC for text.
- One accent: icon orange (`icon-orange` on navy, `burnt-orange` for text on beige). Amber and bright teal live only inside the players.
- Small radii; one family of drawn line icons.

## Colors

Two grounds sharing one set of roles. `Base.astro` defines the roles (`--bg`, `--surface-2`, `--border`, `--text`, `--muted`, `--accent`, `--accent-ink`, `--on-accent`) for navy on `:root`, and `.band` redefines them for beige, so components use the roles and work on either ground. A separate dark umber palette is scoped to the players.

### Primary
- **Icon Orange** (`icon-orange`, `--accent`): the 雙 icon's orange. The install button fill (with Navy Page text, 6.2:1), and on navy also links, line icons, step numerals, focus rings and the FAQ summary hover (`--accent-ink`). Never a background area larger than a button.
- **Burnt Orange** (`burnt-orange`, `--accent-ink` inside `.band`): the same voice darkened for text on beige (5.2:1): mode taglines, the mode note, links and focus rings in the band.

### Neutral (navy page)
- **Navy Page** (`navy-page`): the body background and `theme-color`; flat, never a gradient.
- **Navy Hover** (`navy-hover`): the secondary button's hover fill and inline `code` background on the privacy page.
- **Navy Hairline** (`navy-hairline`): row dividers in the table and FAQ, the footer rule, privacy table borders, the scrollbar thumb.
- **Cream** (`cream`): text, the heavy 2px rule over ruled columns, the table head rule, the secondary button outline.
- **Mist Muted** (`mist-muted`): leads, body copy under headings, table row labels, footer links; tinted from the navy, not grey.

### Neutral (beige band)
- **Beige Band** (`beige-band`) with **Oat Hover**, **Sand Hairline**, **Ink** and **Walnut Muted** in the same roles as their navy counterparts, only inside `.band`.

### Player palette (scoped to the demos and video frame)
- **Player Umber** (`player-umber`) with **Player Umber Lane** (`player-umber-lane`): the demo frame and its timeline lanes. ModeDemo redefines `--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--bg` on `.demo`, so the dark palette is local and never leaks to the page.
- **Player Edge** (`player-edge`): the 1px border on every dark player.
- **Player Muted** (`player-muted`): timeline labels inside the demo.
- **Caption White** (`caption-white`) and **Caption Amber** (`caption-amber`): the product's real caption colours, source line and translation; amber also marks the word being said and the caption cues on the timeline.
- **Signal Teal** (`signal-teal`): read-ahead progress, the read-ahead zone, the hold spinner and the speaking glow. Bright teal belongs to the dark players only.

The live badge in the demo uses a literal red (`#dc2626`) as the player's own "LIVE" chip; it is a depiction, not a palette colour.

### Named Rules
**The Screen On A Band Rule.** The page is navy; the players sit on the beige band (the promo video half on navy, half on beige). Players stay dark and never turn beige or navy.

**The Caption Colours Rule.** White over amber is how the product's captions look; use it only inside a player, where it depicts the product, never as page decoration.

**The One Voice Rule.** Orange is the only accent: `--accent` for fills, `--accent-ink` for text and lines. White text never sits on orange (2.6:1); the button text is navy.

## Typography

**Display Font:** BLC Rounded (a renamed subset of jf open huninn, SIL OFL), falling back to Noto Sans TC, system-ui
**Body Font:** Inter with Noto Sans TC (Google Fonts), system-ui

**Character:** A soft, hand-friendly rounded face for every heading against a neutral, legible sans for reading. The rounded face carries the warmth; Inter keeps the facts plain.

### Hierarchy
- **Display** (400, clamp(34px, 6vw, 60px), 1.18): the hero headline only, centred, max 16em, balanced.
- **Headline** (400, clamp(26px, 3.5vw, 34px)): section titles (h2).
- **Title** (400, 20px): ruled-column item titles (features, steps). Mode names use **Title Mode** (400, clamp(22px, 3vw, 28px)).
- **Numeral** (400, 40px, line-height 1, accent ink): step numbers in the rounded face.
- **Lead** (400, clamp(17px, 2.2vw, 20px)): the hero lead, Mist Muted, max 40em.
- **Body** (400, 16px, 1.6): all running text.
- **Label** (600, 15px): mode taglines in Burnt Orange, table head cells, footer and language links (15px, regular weight).

FAQ summaries (17px) and the brand name in the top bar (17px) also use the rounded face.

### Named Rules
**The Rounded Headings Rule.** h1, h2, h3 and FAQ summaries are set in BLC Rounded at weight 400 with `font-synthesis: none`. The face has a single weight; never fake bold on it.

**The Subset Maintenance Rule.** `site/public/fonts/blc-rounded.woff2` contains only the characters the site uses. Whenever copy adds characters (new Chinese text especially), rebuild it with `site/scripts/subset-font.py` (source: jf open huninn v2.1) or headings will fall back to Noto Sans TC glyph by glyph. The subset must keep the BLC Rounded name: the OFL reserves "open huninn" and "huninn" for unmodified fonts. Keep `OFL.txt` next to the font.

## Layout

A single centred container, `min(1120px, 100% - 32px)`, giving a 16px gutter on phones. Sections are spaced 44px top and bottom. The modes section sits in a full-bleed `.band`; the promo video pulls into it by `--overlap` (clamp(56px, 13vw, 200px)) with a matching top padding on the band. The hero is centred; everything else is left-aligned.

- **Ruled columns:** features and steps use an auto-fit grid of `minmax(240px, 1fr)` with 28px row and 36px column gaps, so three columns on desktop collapse to one on phones without breakpoints.
- **Mode rows:** each mode is a two-column grid (5fr text, 6fr demo, 40px gap); the second mode mirrors the order. Below 820px they stack, text first.
- **Table:** full width, tabular numerals; above 600px it scrolls horizontally at a 560px minimum; at 600px and below it wraps in place at 14px so the read-ahead column is never cut off.
- The footer is a centred wrapping row of links over a navy hairline.

## Elevation & Depth

The page is flat. Depth exists only to lift the dark players off their ground: a long, soft, ink-tinted drop shadow under the promo video and each mode demo. No content block, button or row carries a shadow.

### Shadow Vocabulary
- **Player lift** (`box-shadow: 0 24px 50px -24px rgba(35, 31, 26, 0.6)`): the promo video frame.
- **Demo lift** (`box-shadow: 0 20px 44px -22px rgba(35, 31, 26, 0.55)`): each mode demo.

### Named Rules
**The Only Screens Float Rule.** Shadows belong to dark players. Everything else sits flat.

## Shapes

Small, quiet radii and lines rather than containers. Ruled items take a 2px `--text` top rule and no corners at all; rows are separated by 1px `--border` hairlines. Radii: 3px for timeline lanes and tiny marks, 6px for the mode note and focus rings, 8px for the demo screen and caption overlay, 10px for buttons, 14px for player frames, 9px for the brand icon. Icons are one family of 24px drawn line icons at 1.7 stroke, round caps and joins, in accent ink. The FAQ disclosure is a drawn chevron (two 2px borders rotated), not a glyph.

## Components

### Buttons
Plain and confident, the same 50px height and 10px radius for both.
- **Primary:** Icon Orange fill, Navy Page 600 Inter text, 0 24px padding. Hover brightens (`filter: brightness(1.08)`).
- **Secondary:** transparent with a 1.5px `--text` outline and text. Hover fills with `--surface-2`.
- **Active:** both press down 1px. Transitions 160ms ease-out.
- **Focus:** 3px `--accent-ink` outline, 3px offset, 6px radius (shared by links, buttons and summaries).

### Ruled Column Item
The site's card replacement, used for features and steps: a 2px `--text` top rule, 18px above the title, a Title heading (with a line icon for features or an orange numeral above it for steps), and muted body. No fill, border box, radius or shadow.

### Hairline Table and FAQ
Both open under a 2px `--text` rule. Table head cells sit on a 1px `--text` line; body rows and FAQ items are divided by 1px `--border` hairlines, the last row without one. FAQ items are native `details` with 18px vertical padding; the summary turns orange on hover and its chevron rotates over 160ms.

### Mode Note
A small outlined chip under each mode's copy: 1px border in currentColor (Burnt Orange, on the band), 6px radius, 4px 10px padding, 14px 600 text. It states the mode's one timing fact.

### Navigation
A top bar with the brand (32px icon at 9px radius, name in BLC Rounded 17px, cream) and a Mist Muted language link on the right. No menu.

### Demo Player (signature)
A dark umber frame (14px radius, 12px padding, 1px Player Edge border, Demo lift) holding a 16:9 screen with an abstract speaker, a caption overlay in white and amber on 66% black, and below it a two-lane timeline (speech in pale grey, captions in amber) with a white playhead. Live shows a red LIVE chip and a warm brown screen; read-ahead shows a cool teal screen, a progress bar and a dashed Signal Teal read-ahead zone. It animates only while on screen and renders one still frame under reduced motion.

## Do's and Don'ts

### Do:
- **Do** set content as ruled columns (2px `--text` top rule) and hairline rows (1px `--border`).
- **Do** keep the page flat Navy Page, the players on the beige band, and every player dark with its palette scoped to the player.
- **Do** use orange as the only accent (`--accent` fills, `--accent-ink` text), and Signal Teal and Caption Amber only inside players.
- **Do** style through the role variables so a component works on navy and inside `.band`.
- **Do** set every heading in BLC Rounded at 400, and rebuild the font subset when copy adds characters.
- **Do** keep the incumbent layout, section order and the orange 雙 icon.
- **Do** draw new icons in the existing line family (24px viewBox, 1.7 stroke, round caps, accent ink).

### Don't:
- **Don't** put content in rounded, filled or shadowed boxed cards; the user rejected them as "too AI".
- **Don't** give the page a purple-blue or dark-gradient AI-tool look: the navy is flat, and the only gradients are the radial ones inside the demo screens, which depict a video.
- **Don't** put white text on orange, or orange text on beige without darkening it to Burnt Orange.
- **Don't** add shadows to anything that is not a dark player.
- **Don't** bold or synthesise weights on BLC Rounded, or rename the subset back to huninn.
- **Don't** carry these styles into the extension's own UI under `src/` or `entrypoints/`.
