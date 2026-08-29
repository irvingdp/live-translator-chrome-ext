import React from 'react';
import ReactDOM from 'react-dom/client';

import { applyDocumentLanguage, t } from '../../src/core/i18n';
import { OnboardingApp } from '../../src/onboarding/OnboardingApp';
import './style.css';

document.title = t('onboardingPageTitle');
applyDocumentLanguage(document);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OnboardingApp />
  </React.StrictMode>,
);
