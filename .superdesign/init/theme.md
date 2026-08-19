# Theme

## Compact token summary

- Color scheme: dark.
- Page background: `#0b1120`.
- Surface: `#111827`; raised surface: `#182235`; field background: `#0f172a`.
- Border: `#334155`; stronger field border: `#475569`.
- Text: `#f8fafc`; muted: `#a8b3c5`; heading: `#dbeafe`.
- Primary teal: `#14b8a6`; strong teal: `#0d9488`; focus/accent: `#5eead4`.
- Danger: `#f87171`; caption translation: `#fde68a`.
- Font: Inter, system UI fallbacks. Popup title 20px; section title 13px; form labels 12px; eyebrow 11px.
- Spacing: popup 18px padding with 12px gaps; cards 12px padding with 8px gaps.
- Radius: cards 12px; controls 8px; primary button 10px; status pill 999px.
- Caption shadow: `0 8px 28px rgba(0,0,0,.34)`; focus ring: `0 0 0 3px rgba(94,234,212,.28)`.
- Caption typography: source 24px/650; translation 22px/550; line-height 1.35.
- No responsive breakpoint system. Popup is fixed at 380px; options max width 640px.

## Raw source

Path: `entrypoints/popup/style.css`

```css
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --surface: #111827;
  --surface-raised: #182235;
  --border: #334155;
  --text: #f8fafc;
  --muted: #a8b3c5;
  --primary: #14b8a6;
  --primary-strong: #0d9488;
  --danger: #f87171;
  --focus: #5eead4;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 380px; background: #0b1120; color: var(--text); }
button, input, select { font: inherit; }
button, select, input[type="range"] { cursor: pointer; }
.popup { display: grid; gap: 12px; padding: 18px; width: 380px; }
.loading { min-height: 180px; place-items: center; color: var(--muted); }
.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.eyebrow { color: #5eead4; font-size: 11px; font-weight: 750; letter-spacing: .14em; margin: 0 0 4px; }
h1 { font-size: 20px; line-height: 1.25; margin: 0; }
h2 { font-size: 13px; margin: 0 0 10px; color: #dbeafe; }
.status { border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 12px; padding: 5px 9px; white-space: nowrap; }
.status-running { background: rgba(20,184,166,.14); border-color: #0f766e; color: #99f6e4; }
.status-error { background: rgba(248,113,113,.12); border-color: #991b1b; color: #fecaca; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; display: grid; gap: 8px; padding: 12px; }
.grid { grid-template-columns: 1fr 1fr; }
.grid h2 { grid-column: 1 / -1; }
label { color: #dbe4f0; display: block; font-size: 12px; font-weight: 650; margin-bottom: 4px; }
input, select { background: #0f172a; border: 1px solid #475569; border-radius: 8px; color: var(--text); min-height: 42px; outline: none; padding: 9px 10px; width: 100%; }
input:focus-visible, select:focus-visible, button:focus-visible { box-shadow: 0 0 0 3px rgba(94,234,212,.28); border-color: var(--focus); outline: none; }
select:disabled { cursor: not-allowed; opacity: .65; }
.provider-link { color: #5eead4; font-size: 12px; margin-top: -2px; text-decoration: none; }
.provider-link:hover { text-decoration: underline; }
.field { margin-top: 2px; }
.secret-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
.secret-row button, .secondary { background: #243146; border: 1px solid #475569; border-radius: 8px; color: #e2e8f0; min-height: 42px; padding: 0 10px; }
.range-label { display: flex; justify-content: space-between; }
.range-label output { color: #99f6e4; font-size: 12px; font-variant-numeric: tabular-nums; }
input[type="range"] { accent-color: var(--primary); min-height: 28px; padding: 0; }
.privacy { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 0; }
.feedback { background: #172033; border-left: 3px solid var(--primary); border-radius: 6px; color: #dbeafe; font-size: 12px; margin: 0; padding: 8px 10px; }
.primary { background: var(--primary-strong); border: 1px solid #2dd4bf; border-radius: 10px; color: white; font-weight: 750; min-height: 48px; padding: 11px 16px; width: 100%; }
.options { display: grid; gap: 16px; margin: 0 auto; max-width: 640px; padding: 32px 20px; }
.provider-summary { align-items: center; display: flex; justify-content: space-between; gap: 12px; }
```

Path: `src/content/caption-overlay.ts` (`OVERLAY_CSS` token source)

```css
:host { all: initial; }
.stage { display:flex; flex-direction:column; height:100%; justify-content:flex-end; padding:0 5% var(--caption-bottom-offset,8%); pointer-events:none; width:100%; }
.captions { background:rgba(3,7,18,var(--caption-bg-opacity,.78)); border:1px solid rgba(255,255,255,.18); border-radius:10px; box-shadow:0 8px 28px rgba(0,0,0,.34); color:#fff; line-height:1.35; padding:8px 14px; text-align:center; width:var(--caption-width,80%); }
.original { font-size:var(--caption-original-size,24px); font-weight:650; text-shadow:0 1px 2px #000; }
.translation { color:#fde68a; font-size:var(--caption-translation-size,22px); font-weight:550; margin-top:3px; text-shadow:0 1px 2px #000; }
.status-message { color:#fca5a5; font-size:16px; font-weight:600; }
```
