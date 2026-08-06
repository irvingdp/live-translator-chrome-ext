import React from 'react';
import ReactDOM from 'react-dom/client';

import { applyDocumentLanguage } from '../../src/core/i18n';
import { PopupApp } from '../../src/popup/PopupApp';
import { browserPopupApi } from '../../src/popup/browser-api';
import './style.css';

// The manifest resolves the popup's __MSG__ title for the toolbar tooltip; the
// document still needs its language set for CJK font and line-break rules.
applyDocumentLanguage(document);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopupApp api={browserPopupApi} />
  </React.StrictMode>,
);
