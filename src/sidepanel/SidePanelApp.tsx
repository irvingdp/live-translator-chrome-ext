import { useEffect, useRef, useState } from 'react';

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
  const [unseen, setUnseen] = useState(false);
  const [error, setError] = useState('');
  const historyRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastPairId = snapshot?.pairs.at(-1)?.id;

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

  useEffect(() => {
    const history = historyRef.current;
    if (!history || !lastPairId) return;
    if (!pinnedRef.current) {
      setUnseen(true);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      history.scrollTop = history.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [lastPairId]);

  const updatePinned = () => {
    const history = historyRef.current;
    if (!history) return;
    pinnedRef.current =
      history.scrollHeight - history.scrollTop - history.clientHeight <= 24;
    if (pinnedRef.current) setUnseen(false);
  };

  const jumpToLatest = () => {
    const history = historyRef.current;
    if (!history) return;
    history.scrollTop = history.scrollHeight;
    pinnedRef.current = true;
    setUnseen(false);
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
          <button
            aria-label={t('returnToFloating')}
            className="surface-button"
            title={t('returnToFloating')}
            type="button"
            onClick={() => void returnToFloating()}
          >
            ↗
          </button>
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
            onScroll={updatePinned}
          >
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
          {unseen && (
            <button className="new-captions" type="button" onClick={jumpToLatest}>
              ↓ {t('newCaptions')}
            </button>
          )}
        </>
      )}
      {error && <p className="panel-error" role="status">{error}</p>}
    </main>
  );
}
