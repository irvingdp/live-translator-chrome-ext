import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserSidePanelApi } from '../../src/sidepanel/browser-api';

afterEach(() => vi.unstubAllGlobals());

describe('browserSidePanelApi', () => {
  it('connects through the dedicated side-panel port', async () => {
    const port = {
      disconnect: vi.fn(),
      onDisconnect: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    };
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const connect = vi.fn(() => port);
    vi.stubGlobal('chrome', { runtime: { connect, sendMessage } });

    const connection = browserSidePanelApi.connect();
    const onState = vi.fn();
    connection.onState(onState);

    expect(connect).toHaveBeenCalledWith({ name: 'caption-side-panel' });
    const listener = port.onMessage.addListener.mock.calls[0]![0];
    listener({ type: 'SIDE_PANEL_STATE', payload: { active: true } });
    expect(onState).toHaveBeenCalledWith({ active: true });

    const appearance = {
      backgroundOpacity: 0,
      originalFontSize: 18,
      originalTextColor: '#ffffff',
      translationFontSize: 18,
      translationTextColor: '#fde68a',
    };
    await browserSidePanelApi.updateAppearance(appearance);
    expect(sendMessage).toHaveBeenCalledWith({
      target: 'background',
      type: 'OVERLAY_APPEARANCE_CHANGED',
      payload: { appearance },
    });
  });
});
