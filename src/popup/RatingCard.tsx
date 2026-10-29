import { useEffect, useState } from 'react';

import {
  FEEDBACK_ISSUES,
  MAX_FEEDBACK_LENGTH,
  validateFeedback,
  type FeedbackIssue,
  type FeedbackError,
} from '../core/feedback';
import { t, type MessageKey } from '../core/i18n';

// How long a thank-you stays up before the card folds away.
export const THANKS_MS = 2000;
// Ratings at or above this are sent the moment the star is clicked; below it,
// the form asks what could be better first.
export const QUICK_SEND_MIN = 4;

// quickFailed: a one-click rating did not go through; offer a retry without
// turning it into a form.
type Phase = 'ask' | 'form' | 'sending' | 'sent' | 'quickFailed';

const ERROR_KEYS: Record<FeedbackError | 'failed', MessageKey> = {
  messageTooLong: 'feedbackMessageTooLong',
  failed: 'feedbackFailed',
};

const ISSUE_KEYS: Record<FeedbackIssue, MessageKey> = {
  inaccurate: 'feedbackIssueInaccurate',
  delay: 'feedbackIssueDelay',
  ui: 'feedbackIssueUi',
  other: 'feedbackIssueOther',
};

export interface RatingCardProps {
  /** "Later" or ×: ask again at a later tab. */
  onLater(): void;
  /** "Don't ask again". */
  onNever(): void;
  /** Send the rating with the optional comment. Rejects when the request fails. */
  onSendFeedback(rating: number, issue: FeedbackIssue | undefined, message: string): Promise<void>;
  /** The card has finished thanking the user and can go. */
  onClose(): void;
}

export function RatingCard(props: RatingCardProps) {
  const [phase, setPhase] = useState<Phase>('ask');
  const [rating, setRating] = useState(0);
  // The star under the pointer or keyboard focus: previews 1..n before a click.
  const [preview, setPreview] = useState(0);
  const [issue, setIssue] = useState<FeedbackIssue>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<FeedbackError | 'failed'>();

  const { onClose } = props;
  useEffect(() => {
    if (phase !== 'sent') return;
    const timer = setTimeout(onClose, THANKS_MS);
    return () => clearTimeout(timer);
  }, [phase, onClose]);

  const quick = rating >= QUICK_SEND_MIN;

  const send = async (stars: number, choice: FeedbackIssue | undefined, text: string) => {
    setError(undefined);
    setPhase('sending');
    try {
      await props.onSendFeedback(stars, choice, text);
      setPhase('sent');
    } catch {
      setError('failed');
      setPhase(stars >= QUICK_SEND_MIN ? 'quickFailed' : 'form');
    }
  };

  // Nothing navigates away. 4–5 stars are sent straight away as a bare rating;
  // 1–3 open the form.
  const rate = (stars: number) => {
    setRating(stars);
    if (stars >= QUICK_SEND_MIN) {
      void send(stars, undefined, '');
    } else {
      setError(undefined);
      setPhase('form');
    }
  };

  const submit = async () => {
    const invalid = issue === 'other' ? validateFeedback(message) : undefined;
    if (invalid) {
      setError(invalid);
      return;
    }
    await send(rating, issue, issue === 'other' ? message : '');
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
        {(phase === 'ask' || phase === 'form' || phase === 'quickFailed') && (
          <button aria-label={t('closeLabel')} className="rating-close" type="button" onClick={props.onLater}>
            ×
          </button>
        )}
      </div>

      {phase === 'sent' && <p className="rating-thanks" role="status">{t('feedbackThanks')}</p>}

      {phase !== 'sent' && (
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

      {phase === 'sending' && quick && (
        <p className="rating-note" role="status">
          {t('feedbackSending')}
        </p>
      )}

      {phase === 'quickFailed' && (
        <div className="rating-form">
          <p className="rating-error" role="alert">
            {t('feedbackFailed')}
          </p>
          <button
            className="secret-submit rating-submit"
            type="button"
            onClick={() => void send(rating, undefined, '')}
          >
            {t('feedbackRetry')}
          </button>
        </div>
      )}

      {(phase === 'form' || (phase === 'sending' && !quick)) && (
        <form
          className="rating-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="feedback-issue">{t('feedbackIssueLabel')}</label>
          <select
            disabled={phase === 'sending'}
            id="feedback-issue"
            value={issue ?? ''}
            onChange={(event) => {
              setIssue((event.target.value || undefined) as FeedbackIssue | undefined);
              setError(undefined);
            }}
          >
            <option value="">{t('feedbackIssueNone')}</option>
            {FEEDBACK_ISSUES.map((value) => (
              <option key={value} value={value}>
                {t(ISSUE_KEYS[value])}
              </option>
            ))}
          </select>
          {issue === 'other' && (
            <>
              <label htmlFor="feedback-message">{t('feedbackPrompt')}</label>
              <textarea
                autoFocus
                id="feedback-message"
                maxLength={MAX_FEEDBACK_LENGTH}
                readOnly={phase === 'sending'}
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </>
          )}
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
