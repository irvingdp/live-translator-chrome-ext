import type {
  SidePanelApi,
  SidePanelConnection,
  SidePanelSnapshot,
} from './SidePanelApp';

export const browserSidePanelApi: SidePanelApi = {
  connect(): SidePanelConnection {
    const port = chrome.runtime.connect({ name: 'caption-side-panel' });
    return {
      disconnect: () => port.disconnect(),
      onDisconnect(listener) {
        port.onDisconnect.addListener(listener);
      },
      onState(listener) {
        port.onMessage.addListener((message: unknown) => {
          if (
            message &&
            typeof message === 'object' &&
            'type' in message &&
            message.type === 'SIDE_PANEL_STATE' &&
            'payload' in message
          ) {
            listener(message.payload as SidePanelSnapshot);
          }
        });
      },
    };
  },
};
