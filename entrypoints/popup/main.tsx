import React from 'react';
import ReactDOM from 'react-dom/client';

import { PopupApp } from '../../src/popup/PopupApp';
import { browserPopupApi } from '../../src/popup/browser-api';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopupApp api={browserPopupApi} />
  </React.StrictMode>,
);
