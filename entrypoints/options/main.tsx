import React from 'react';
import ReactDOM from 'react-dom/client';

import { applyDocumentLanguage, t } from '../../src/core/i18n';
import { OptionsApp } from '../../src/options/OptionsApp';
import { browserOptionsApi } from '../../src/options/browser-api';
import '../popup/style.css';

// The HTML <title> and lang cannot carry a __MSG__ placeholder — only the
// manifest resolves those — so the page localises its own shell.
document.title = t('optionsTitle');
applyDocumentLanguage(document);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsApp api={browserOptionsApi} />
  </React.StrictMode>,
);
