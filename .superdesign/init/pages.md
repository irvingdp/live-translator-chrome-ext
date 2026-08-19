# Page Dependency Trees

## Toolbar popup

Entry: `entrypoints/popup/main.tsx`

- `entrypoints/popup/style.css`
- `src/core/i18n.ts`
- `src/popup/PopupApp.tsx`
  - `src/core/capture-session-controller.ts`
  - `src/core/i18n.ts`
  - `src/core/gemini-languages.ts`
  - `src/core/settings.ts`
    - `src/core/capture-session-controller.ts`
    - `src/core/i18n.ts`
- `src/popup/browser-api.ts`
  - `src/core/capture-session-controller.ts`
  - `src/core/messages.ts`
  - `src/core/settings.ts`

## Options page

Entry: `entrypoints/options/main.tsx`

- `entrypoints/popup/style.css`
- `src/core/i18n.ts`
- `src/options/OptionsApp.tsx`
  - `src/core/i18n.ts`
  - `src/options/browser-api.ts`
- `src/options/browser-api.ts`
  - `src/core/messages.ts`

## Injected caption overlay

Entry: `entrypoints/captions.ts`

- `src/content/caption-overlay.ts`
  - `src/core/caption-window.ts`
  - `src/core/i18n.ts`
  - `src/core/settings.ts`
- `src/core/browser-api.ts`
- `src/core/messages.ts`
- `src/core/settings.ts`

The visual target for this feature is primarily `src/content/caption-overlay.ts`; `src/popup/PopupApp.tsx` supplies the settings-state baseline.
