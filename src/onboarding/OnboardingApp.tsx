import { t, type MessageKey } from '../core/i18n';

const AI_STUDIO_KEYS_URL = 'https://aistudio.google.com/api-keys';

type GuideStep = {
  body: MessageKey;
  image?: string;
  imageAlt?: MessageKey;
  title: MessageKey;
};

const steps: GuideStep[] = [
  {
    body: 'onboardingStepSignInBody',
    title: 'onboardingStepSignInTitle',
  },
  {
    body: 'onboardingStepCreateBody',
    image: '/onboarding/ai-studio-create-button.png',
    imageAlt: 'onboardingCreateButtonAlt',
    title: 'onboardingStepCreateTitle',
  },
  {
    body: 'onboardingStepProjectBody',
    image: '/onboarding/ai-studio-create-dialog.png',
    imageAlt: 'onboardingCreateDialogAlt',
    title: 'onboardingStepProjectTitle',
  },
  {
    body: 'onboardingStepCopyBody',
    image: '/onboarding/ai-studio-copy-key.png',
    imageAlt: 'onboardingCopyKeyAlt',
    title: 'onboardingStepCopyTitle',
  },
];

function AiStudioLink() {
  return (
    <a
      className="primary-link"
      href={AI_STUDIO_KEYS_URL}
      rel="noreferrer"
      target="_blank"
    >
      {t('onboardingOpenAiStudio')}
    </a>
  );
}

export function OnboardingApp() {
  return (
    <main className="onboarding">
      <header className="hero">
        <div className="brand">
          <img
            alt=""
            aria-hidden="true"
            className="brand-icon"
            src="/icon/96.png"
          />
          <div>
            <p className="eyebrow">{t('onboardingEyebrow')}</p>
            <h1>{t('onboardingTitle')}</h1>
            <p className="lede">{t('onboardingSubtitle')}</p>
          </div>
        </div>
        <AiStudioLink />
      </header>

      <ol className="steps">
        {steps.map((step, index) => (
          <li className="step" key={step.title}>
            <div className="step-copy">
              <span className="step-number" aria-hidden="true">{index + 1}</span>
              <h2>{t(step.title)}</h2>
              <p>{t(step.body)}</p>
            </div>
            {step.image && step.imageAlt && (
              <img
                alt={t(step.imageAlt)}
                className="screenshot"
                src={step.image}
              />
            )}
          </li>
        ))}
      </ol>

      <section className="notes" aria-label={t('onboardingNotesLabel')}>
        <article className="note note-security">
          <h2>{t('onboardingSecurityTitle')}</h2>
          <p>{t('onboardingSecurityBody')}</p>
        </article>
        <article className="note">
          <h2>{t('onboardingBillingTitle')}</h2>
          <p>{t('onboardingBillingBody')}</p>
        </article>
      </section>

      <div className="footer-action">
        <AiStudioLink />
      </div>
    </main>
  );
}
