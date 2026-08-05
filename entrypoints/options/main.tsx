import React from 'react';
import ReactDOM from 'react-dom/client';

import { OptionsApp } from '../../src/options/OptionsApp';
import { browserOptionsApi } from '../../src/options/browser-api';
import '../popup/style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsApp api={browserOptionsApi} />
  </React.StrictMode>,
);
