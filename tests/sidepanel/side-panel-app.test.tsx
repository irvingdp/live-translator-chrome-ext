import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  SidePanelApp,
  type SidePanelApi,
  type SidePanelSnapshot,
} from '../../src/sidepanel/SidePanelApp';

function createHarness() {
  let stateListener: ((state: SidePanelSnapshot) => void) | undefined;
  const api: SidePanelApi = {
    connect: vi.fn(() => ({
      disconnect: vi.fn(),
      onDisconnect: vi.fn(),
      onState: vi.fn((listener) => { stateListener = listener; }),
    })),
  };
  return {
    api,
    publish(state: SidePanelSnapshot) {
      stateListener?.(state);
    },
  };
}

describe('SidePanelApp', () => {
  it('renders complete bilingual caption history while native mode is active', async () => {
    const harness = createHarness();
    render(<SidePanelApp api={harness.api} />);

    harness.publish({
      active: true,
      appearance: {
        backgroundOpacity: 50,
        originalFontSize: 30,
        originalTextColor: '#e2e8f0',
        translationFontSize: 24,
        translationTextColor: '#facc15',
      },
      pairs: [
        { id: 'one', original: 'First sentence.', translation: '第一句。' },
        { id: 'two', original: 'Second sentence.', translation: '第二句。' },
      ],
      status: { state: 'running', tabId: 42 },
    });

    expect(await screen.findByText('First sentence.')).toHaveStyle({
      color: '#e2e8f0',
      fontSize: '30px',
    });
    expect(screen.getByText('第一句。')).toHaveStyle({
      color: '#facc15',
      fontSize: '24px',
    });
    expect(screen.getByText('Second sentence.')).toBeVisible();
  });

  it('forces the history to the bottom after every caption revision', async () => {
    const harness = createHarness();
    const { container } = render(<SidePanelApp api={harness.api} />);
    harness.publish({
      active: true,
      pairs: [{ id: 'one', original: 'Growing sentence', translation: '' }],
      status: { state: 'running', tabId: 42 },
    });
    await screen.findByText('Growing sentence');
    const history = container.querySelector<HTMLElement>('.caption-history')!;
    Object.defineProperty(history, 'scrollHeight', {
      configurable: true,
      value: 640,
    });
    history.scrollTop = 0;

    harness.publish({
      active: true,
      pairs: [{
        id: 'one',
        original: 'Growing sentence complete.',
        translation: '持續更新的完整句子。',
      }],
      status: { state: 'running', tabId: 42 },
    });

    await waitFor(() => expect(history.scrollTop).toBe(640));
    expect(screen.getByRole('button', { name: '暫停自動捲動' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '有新字幕' }))
      .not.toBeInTheDocument();
  });

  it('pauses from the header and re-enables when the user returns to bottom', async () => {
    const harness = createHarness();
    const { container } = render(<SidePanelApp api={harness.api} />);
    harness.publish({
      active: true,
      pairs: [{ id: 'one', original: 'First sentence.', translation: '第一句。' }],
      status: { state: 'running', tabId: 42 },
    });
    const pause = await screen.findByRole('button', { name: '暫停自動捲動' });
    const history = container.querySelector<HTMLElement>('.caption-history')!;
    Object.defineProperties(history, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 640 },
      scrollTop: { configurable: true, value: 540, writable: true },
    });

    fireEvent.click(pause);
    expect(await screen.findByRole('button', { name: '開啟自動捲動' }))
      .toHaveAttribute('aria-pressed', 'false');
    history.scrollTop = 120;
    fireEvent.scroll(history);

    harness.publish({
      active: true,
      pairs: [{
        id: 'one',
        original: 'First sentence revised.',
        translation: '第一句修訂。',
      }],
      status: { state: 'running', tabId: 42 },
    });
    await screen.findByText('First sentence revised.');
    expect(history.scrollTop).toBe(120);

    history.scrollTop = 540;
    fireEvent.scroll(history);
    expect(await screen.findByRole('button', { name: '暫停自動捲動' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('does not render a manual return-to-floating action', async () => {
    const harness = createHarness();
    render(<SidePanelApp api={harness.api} />);
    harness.publish({
      active: true,
      pairs: [],
      status: { state: 'running', tabId: 42 },
    });

    expect(await screen.findByRole('button', { name: '暫停自動捲動' }))
      .toBeVisible();
    expect(screen.queryByRole('button', { name: '回到浮動字幕' }))
      .not.toBeInTheDocument();
  });

  it('does not offer a minimized webpage state while the panel is inactive', async () => {
    const harness = createHarness();
    render(<SidePanelApp api={harness.api} />);
    harness.publish({
      active: false,
      pairs: [],
      status: { state: 'running', tabId: 42 },
    });

    expect(await screen.findByText(/字幕已回到網頁浮動顯示/)).toBeVisible();
    expect(screen.queryByRole('button', { name: '回到浮動字幕' }))
      .not.toBeInTheDocument();
  });
});
