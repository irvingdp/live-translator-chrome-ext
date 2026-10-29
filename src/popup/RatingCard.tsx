import { useEffect, useState } from 'react';

import {
  MAX_FEEDBACK_LENGTH,
  STORE_RATING_MIN,
  validateFeedback,
  type FeedbackError,
} from '../core/feedback';
import { t, type MessageKey } from '../core/i18n';

// How long a thank-you stays up before the card folds away.
export const THANKS_MS = 2000;

type Phase = 'ask' | 'store' | 'form' | 'sending' | 'sent';

const ERROR_KEYS: Record<FeedbackError | 'failed', MessageKey> = {
  messageRequired: 'feedbackMessageRequired',
  messageTooLong: 'feedbackMessageTooLong',
  emailInvalid: 'feedbackEmailInvalid',
  failed: 'feedbackFailed',
};

export interface RatingCardProps {
  /** "Later" or ×: ask again at a later tab. */
  onLater(): void;
  /** "Don't ask again". */
  onNever(): void;
  /** 4–5 stars: open the store review page. The rating counts as done. */
  onStoreRating(rating: number): void;
  /** 1–3 stars: send the form. Rejects when the request fails. */
  onSendFeedback(rating: number, message: string, email: string): Promise<void>;
  /** The card has finished thanking the user and can go. */
  onClose(): void;
}

export function RatingCard(props: RatingCardProps) {
  const [phase, setPhase] = useState<Phase>('ask');
  const [rating, setRating] = useState(0);
  // The star under the pointer or keyboard focus: previews 1..n before a click.
  const [preview, setPreview] = useState(0);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<FeedbackError | 'failed'>();

  const { onClose } = props;
  useEffect(() => {
    if (phase !== 'store' && phase !== 'sent') return;
    const timer = setTimeout(onClose, THANKS_MS);
    return () => clearTimeout(timer);
  }, [phase, onClose]);

  const rate = (stars: number) => {
    setRating(stars);
    if (stars >= STORE_RATING_MIN) {
      setPhase('store');
      props.onStoreRating(stars);
    } else {
      setPhase('form');
    }
  };

  const submit = async () => {
    const invalid = validateFeedback(message, email);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(undefined);
    setPhase('sending');
    try {
      await props.onSendFeedback(rating, message, email);
      setPhase('sent');
    } catch {
      setError('failed');
      setPhase('form');
    }
  };

  const errorText = error
    ? error === 'messageTooLong'
      ? t(ERROR_KEYS[error], String(MAX_FEEDBACK_LENGTH))
      : t(ERROR_KEYS[error])
    : undefined;

  return (
    <section className="rating-card" aria-labelledby="rating-heading">
      <div className="rating-header">
        <h2 id="rating-heading">{t('ratingTitle', t('extName'))}</h2>
        {(phase === 'ask' || phase === 'form') && (
          <button aria-label={t('closeLabel')} className="rating-close" type="button" onClick={props.onLater}>
            ×
          </button>
        )}
      </div>

      {phase === 'store' && <p className="rating-thanks" role="status">{t('ratingStoreThanks')}</p>}
      {phase === 'sent' && <p className="rating-thanks" role="status">{t('feedbackThanks')}</p>}

      {(phase === 'ask' || phase === 'form' || phase === 'sending') && (
        <div
          className="rating-stars"
          role="group"
          aria-labelledby="rating-heading"
          onMouseLeave={() => setPreview(0)}
        >
          {[1, 2, 3, 4, 5].map((stars) => (
            <button
              key={stars}
              aria-label={t('ratingStarLabel', String(stars))}
              aria-pressed={stars === rating}
              className={`rating-star ${stars <= (preview || rating) ? 'filled' : ''}`}
              disabled={phase === 'sending'}
              type="button"
              onBlur={() => setPreview(0)}
              onClick={() => rate(stars)}
              onFocus={() => setPreview(stars)}
              onMouseEnter={() => setPreview(stars)}
            >
              ★
            </button>
          ))}
        </div>
      )}

      {phase === 'ask' && (
        <div className="rating-actions">
          <button className="rating-link" type="button" onClick={props.onLater}>
            {t('ratingLater')}
          </button>
          <button className="rating-link" type="button" onClick={props.onNever}>
            {t('ratingNever')}
          </button>
        </div>
      )}

      {(phase === 'form' || phase === 'sending') && (
        <form
          className="rating-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="feedback-message">{t('feedbackPrompt')}</label>
          <textarea
            id="feedback-message"
            maxLength={MAX_FEEDBACK_LENGTH}
            readOnly={phase === 'sending'}
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <label htmlFor="feedback-email">{t('feedbackEmailLabel')}</label>
          <input
            autoComplete="email"
            id="feedback-email"
            readOnly={phase === 'sending'}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {errorText && (
            <p className="rating-error" role="alert">
              {errorText}
            </p>
          )}
          <button className="secret-submit rating-submit" disabled={phase === 'sending'} type="submit">
            {t(phase === 'sending' ? 'feedbackSending' : error === 'failed' ? 'feedbackRetry' : 'feedbackSubmit')}
          </button>
          <p className="rating-note">{t('feedbackPrivacyNote')}</p>
        </form>
      )}
    </section>
  );
}
