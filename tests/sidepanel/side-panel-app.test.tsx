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
    returnToFloating: vi.fn().mockResolvedValue(undefined),
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
        translationFontSize: 24,
      },
      pairs: [
        { id: 'one', original: 'First sentence.', translation: '第一句。' },
        { id: 'two', original: 'Second sentence.', translation: '第二句。' },
      ],
      status: { state: 'running', tabId: 42 },
    });

    expect(await screen.findByText('First sentence.')).toHaveStyle({ fontSize: '30px' });
    expect(screen.getByText('第一句。')).toHaveStyle({ fontSize: '24px' });
    expect(screen.getByText('Second sentence.')).toBeVisible();
  });

  it('returns captions to the floating webpage surface', async () => {
    const harness = createHarness();
    render(<SidePanelApp api={harness.api} />);
    harness.publish({
      active: true,
      pairs: [],
      status: { state: 'running', tabId: 42 },
    });

    fireEvent.click(await screen.findByRole('button', { name: '回到浮動字幕' }));

    await waitFor(() => expect(harness.api.returnToFloating).toHaveBeenCalledOnce());
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
