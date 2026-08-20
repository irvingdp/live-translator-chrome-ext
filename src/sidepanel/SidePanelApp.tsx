import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { CaptionPair } from '../core/caption-window';
import type { SessionStatus } from '../core/capture-session-controller';
import { t } from '../core/i18n';
import type { CaptionAppearance } from '../core/settings';

export interface SidePanelSnapshot {
  active: boolean;
  appearance?: CaptionAppearance;
  pairs: CaptionPair[];
  status: SessionStatus;
}

export interface SidePanelConnection {
  disconnect(): void;
  onDisconnect(listener: () => void): void;
  onState(listener: (state: SidePanelSnapshot) => void): void;
}

export interface SidePanelApi {
  connect(): SidePanelConnection;
  returnToFloating(): Promise<void>;
}

export function SidePanelApp({ api }: { api: SidePanelApi }) {
  const [snapshot, setSnapshot] = useState<SidePanelSnapshot>();
  const [autoFollow, setAutoFollow] = useState(true);
  const [error, setError] = useState('');
  const forceFrameRef = useRef<number | undefined>(undefined);
  const forcingScrollRef = useRef(false);
  const historyContentRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const contentKey = snapshot?.pairs
    .map(
      (pair) =>
        `${pair.id}\u0000${pair.original}\u0000${pair.translation}`,
    )
    .join('\u0001');

  const scrollToLatest = useCallback(() => {
    const history = historyRef.current;
    if (!history) return;
    forcingScrollRef.current = true;
    history.scrollTop = history.scrollHeight;
    wasAtBottomRef.current = true;
    if (forceFrameRef.current !== undefined) {
      window.cancelAnimationFrame(forceFrameRef.current);
    }
    forceFrameRef.current = window.requestAnimationFrame(() => {
      history.scrollTop = history.scrollHeight;
      wasAtBottomRef.current = true;
      forcingScrollRef.current = false;
      forceFrameRef.current = undefined;
    });
  }, []);

  useEffect(() => {
    let connection: SidePanelConnection | undefined;
    let reconnectTimer: number | undefined;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      connection = api.connect();
      connection.onState(setSnapshot);
      connection.onDisconnect(() => {
        if (!disposed) reconnectTimer = window.setTimeout(connect, 250);
      });
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      connection?.disconnect();
    };
  }, [api]);

  useLayoutEffect(() => {
    if (autoFollow) scrollToLatest();
  }, [autoFollow, contentKey, scrollToLatest]);

  useEffect(() => {
    const history = historyRef.current;
    const content = historyContentRef.current;
    const ResizeObserverConstructor = window.ResizeObserver;
    if (!history || !content || !ResizeObserverConstructor) return;
    const observer = new ResizeObserverConstructor(() => {
      if (autoFollow) scrollToLatest();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [autoFollow, scrollToLatest, snapshot?.active, snapshot?.status.state]);

  useEffect(() => () => {
    if (forceFrameRef.current !== undefined) {
      window.cancelAnimationFrame(forceFrameRef.current);
    }
  }, []);

  const updateAutoFollowFromScroll = () => {
    const history = historyRef.current;
    if (!history || forcingScrollRef.current) return;
    const atBottom =
      history.scrollHeight - history.scrollTop - history.clientHeight <= 24;
    if (atBottom && !wasAtBottomRef.current) setAutoFollow(true);
    if (!atBottom) setAutoFollow(false);
    wasAtBottomRef.current = atBottom;
  };

  const toggleAutoFollow = () => {
    setAutoFollow((current) => {
      const next = !current;
      if (next) {
        scrollToLatest();
      } else {
        if (forceFrameRef.current !== undefined) {
          window.cancelAnimationFrame(forceFrameRef.current);
          forceFrameRef.current = undefined;
        }
        forcingScrollRef.current = false;
      }
      return next;
    });
  };

  const returnToFloating = async () => {
    setError('');
    try {
      await api.returnToFloating();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'surface_change_failed');
    }
  };

  const running = snapshot?.status.state === 'running';
  const appearance = snapshot?.appearance;
  return (
    <main className="side-panel">
      <header className="side-panel-header">
        <div>
          <p className="eyebrow">LIVE CAPTIONS</p>
          <h1>{t('sidePanelTitle')}</h1>
        </div>
        {running && snapshot.active && (
          <div className="header-actions">
            <button
              aria-label={t(
                autoFollow ? 'disableAutoScroll' : 'enableAutoScroll',
              )}
              aria-pressed={autoFollow}
              className={`surface-button auto-scroll-button${
                autoFollow ? ' active' : ''
              }`}
              title={t(
                autoFollow ? 'disableAutoScroll' : 'enableAutoScroll',
              )}
              type="button"
              onClick={toggleAutoFollow}
            >
              ↓
            </button>
            <button
              aria-label={t('returnToFloating')}
              className="surface-button"
              title={t('returnToFloating')}
              type="button"
              onClick={() => void returnToFloating()}
            >
              ↗
            </button>
          </div>
        )}
      </header>

      {!running ? (
        <p className="empty-state">{t('sidePanelWaiting')}</p>
      ) : !snapshot.active ? (
        <p className="inactive-state">{t('sidePanelInactive')}</p>
      ) : (
        <>
          <div
            className="caption-history"
            ref={historyRef}
            onScroll={updateAutoFollowFromScroll}
          >
            <div className="caption-history-content" ref={historyContentRef}>
              {snapshot.pairs.length === 0 ? (
                <p className="empty-state">{t('sidePanelEmpty')}</p>
              ) : snapshot.pairs.map((pair) => (
                <article className="caption-pair" key={pair.id}>
                  <p
                    className="caption-original"
                    style={{ fontSize: appearance?.originalFontSize }}
                  >
                    {pair.original}
                  </p>
                  {pair.translation && (
                    <p
                      className="caption-translation"
                      style={{ fontSize: appearance?.translationFontSize }}
                    >
                      {pair.translation}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </div>
        </>
      )}
      {error && <p className="panel-error" role="status">{error}</p>}
    </main>
  );
}
