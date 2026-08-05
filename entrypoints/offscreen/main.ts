import { createBrowserTabAudioPipeline } from '../../src/audio/browser-tab-audio-pipeline';
import {
  createDeepgramSession,
  OffscreenCaptureController,
} from '../../src/audio/offscreen-capture-controller';
import type { ExtensionMessage } from '../../src/core/messages';

const controller = new OffscreenCaptureController({
  createPipeline: createBrowserTabAudioPipeline,
  createSession: createDeepgramSession,
  emitDisconnect: () => {
    void chrome.runtime.sendMessage<ExtensionMessage>({
      target: 'background',
      type: 'CAPTURE_DISCONNECTED',
    });
  },
  emitTranscript: (event) => {
    void chrome.runtime.sendMessage<ExtensionMessage>({
      target: 'background',
      type: 'TRANSCRIPT_EVENT',
      payload: event,
    });
  },
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.target !== 'offscreen') return false;
    const operation =
      message.type === 'CAPTURE_START'
        ? controller.start(message.payload)
        : controller.stop();
    void operation.then(
      () => sendResponse({ ok: true }),
      (error: unknown) =>
        sendResponse({
          error: error instanceof Error ? error.message : 'Unknown audio error',
          ok: false,
        }),
    );
    return true;
  },
);
