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
import { SETTING_RANGES, type CaptionAppearance } from '../core/settings';

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
  updateAppearance(appearance: CaptionAppearance): Promise<void>;
}

function sameAppearance(
  left: CaptionAppearance | undefined,
  right: CaptionAppearance | undefined,
): boolean {
  return Boolean(
    left && right &&
    left.backgroundOpacity === right.backgroundOpacity &&
    left.originalFontSize === right.originalFontSize &&
    left.originalTextColor === right.originalTextColor &&
    left.translationFontSize === right.translationFontSize &&
    left.translationTextColor === right.translationTextColor
  );
}

export function SidePanelApp({ api }: { api: SidePanelApi }) {
  const [snapshot, setSnapshot] = useState<SidePanelSnapshot>();
  const [pendingAppearance, setPendingAppearance] =
    useState<CaptionAppearance>();
  const pendingAppearanceRef = useRef<CaptionAppearance | undefined>(undefined);
  const [autoFollow, setAutoFollow] = useState(true);
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
      connection.onState((state) => {
        setSnapshot(state);
        if (sameAppearance(state.appearance, pendingAppearanceRef.current)) {
          pendingAppearanceRef.current = undefined;
          setPendingAppearance(undefined);
        }
      });
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

  const running = snapshot?.status.state === 'running';
  const appearance = pendingAppearance ?? snapshot?.appearance;
  const adjustFontSize = (delta: number) => {
    if (!appearance) return;
    const next = {
      ...appearance,
      originalFontSize: Math.min(
        SETTING_RANGES.originalFontSize.max,
        Math.max(
          SETTING_RANGES.originalFontSize.min,
          appearance.originalFontSize + delta,
        ),
      ),
      translationFontSize: Math.min(
        SETTING_RANGES.translationFontSize.max,
        Math.max(
          SETTING_RANGES.translationFontSize.min,
          appearance.translationFontSize + delta,
        ),
      ),
    };
    pendingAppearanceRef.current = next;
    setPendingAppearance(next);
    void api.updateAppearance(next).catch(() => {
      if (pendingAppearanceRef.current !== next) return;
      pendingAppearanceRef.current = undefined;
      setPendingAppearance(undefined);
    });
  };
  return (
    <main className="side-panel">
      <header className="side-panel-header">
        <div>
          <p className="eyebrow">LIVE CAPTIONS</p>
          <h1>{t('sidePanelTitle')}</h1>
        </div>
        {running && snapshot.active && (
          <div className="header-actions">
            {appearance && (
              <>
                <button
                  aria-label={t('increaseCaptionFont')}
                  className="surface-button font-size-button"
                  disabled={
                    appearance.originalFontSize >= SETTING_RANGES.originalFontSize.max &&
                    appearance.translationFontSize >= SETTING_RANGES.translationFontSize.max
                  }
                  title={t('increaseCaptionFont')}
                  type="button"
                  onClick={() => adjustFontSize(1)}
                >
                  T+
                </button>
                <button
                  aria-label={t('decreaseCaptionFont')}
                  className="surface-button font-size-button"
                  disabled={
                    appearance.originalFontSize <= SETTING_RANGES.originalFontSize.min &&
                    appearance.translationFontSize <= SETTING_RANGES.translationFontSize.min
                  }
                  title={t('decreaseCaptionFont')}
                  type="button"
                  onClick={() => adjustFontSize(-1)}
                >
                  T−
                </button>
              </>
            )}
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
                    style={{
                      color: appearance?.originalTextColor,
                      fontSize: appearance?.originalFontSize,
                    }}
                  >
                    {pair.original}
                  </p>
                  {pair.translation && (
                    <p
                      className="caption-translation"
                      style={{
                        color: appearance?.translationTextColor,
                        fontSize: appearance?.translationFontSize,
                      }}
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
    </main>
  );
}
