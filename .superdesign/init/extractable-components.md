# Extractable Components

The current extension has no cross-page layout component worth turning into a standalone Superdesign project component. Popup and options share CSS but not markup.

## CaptionOverlay

- Source: `src/content/caption-overlay.ts`
- Category: basic
- Description: Shadow DOM bilingual caption card anchored over the largest visible video.
- Extractable props: original text, translated text, status text, font sizes, background opacity.
- Hardcoded: source/translation hierarchy, amber translation color, dark translucent surface, border, radius, shadow.

## RangeField

- Source: `src/popup/PopupApp.tsx`
- Category: basic
- Description: Labelled slider with a live numeric value and unit.
- Extractable props: label, minimum, maximum, step, value, unit.
- Hardcoded: range styling and label/output layout.

## SecretField

- Source: `src/options/OptionsApp.tsx`
- Category: basic
- Description: API-key input with show/hide control.
- Extractable props: label, value, revealed state.
- Hardcoded: field row layout and show/hide control style.

These are page-local patterns, not shared layout primitives; the design workflow should pass their source files directly instead of extracting remote components before the first draft.
