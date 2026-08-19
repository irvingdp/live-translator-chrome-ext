# Shared Layouts

This browser extension has no application-wide React layout, router shell, navigation bar, footer, or reusable sidebar. Each extension surface mounts an independent root.

## Popup root

Path: `entrypoints/popup/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';

import { applyDocumentLanguage } from '../../src/core/i18n';
import { PopupApp } from '../../src/popup/PopupApp';
import { browserPopupApi } from '../../src/popup/browser-api';
import './style.css';

applyDocumentLanguage(document);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopupApp api={browserPopupApi} />
  </React.StrictMode>,
);
```

## Options root

Path: `entrypoints/options/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';

import { applyDocumentLanguage, t } from '../../src/core/i18n';
import { OptionsApp } from '../../src/options/OptionsApp';
import { browserOptionsApi } from '../../src/options/browser-api';
import '../popup/style.css';

document.title = t('optionsTitle');
applyDocumentLanguage(document);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsApp api={browserOptionsApi} />
  </React.StrictMode>,
);
```

## Injected caption shell

The caption surface is not React. `src/content/caption-overlay.ts` creates a fixed, highest-z-index Shadow DOM host over the largest visible video. Its `.stage` fills the video rectangle and bottom-aligns `.captions`; `.viewport > .track > .pair` contains `.original` and `.translation`. The complete implementation is passed directly to Superdesign as target context rather than duplicated here.
