import React from 'react';
import ReactDOM from 'react-dom/client';

import { applyDocumentLanguage, t } from '../../src/core/i18n';
import { SidePanelApp } from '../../src/sidepanel/SidePanelApp';
import { browserSidePanelApi } from '../../src/sidepanel/browser-api';
import './style.css';

document.title = t('sidePanelTitle');
applyDocumentLanguage(document);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SidePanelApp api={browserSidePanelApi} />
  </React.StrictMode>,
);
