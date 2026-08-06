import type {
  CaptionPairEvent,
  CaptureStartRequest,
} from '../audio/offscreen-capture-controller';
import type { TranslationRequest } from '../providers/deepl';
import type { AppSettings } from './settings';
import type { TranscriptEvent } from './transcript-stabilizer';

export type ExtensionMessage =
  | { target: 'offscreen'; type: 'CAPTURE_START'; payload: CaptureStartRequest }
  | { target: 'offscreen'; type: 'CAPTURE_STOP'; payload: { sessionId: string } }
  | {
      target: 'offscreen';
      type: 'TRANSLATE_REQUEST';
      payload: {
        request: TranslationRequest;
        requestId: string;
        sessionId: string;
      };
    }
  | {
      target: 'offscreen';
      type: 'TRANSLATE_CANCEL';
      payload: { requestId: string; sessionId: string };
    }
  | {
      target: 'background';
      type: 'CAPTION_PAIR_EVENT';
      payload: { event: CaptionPairEvent; sessionId: string };
    }
  | {
      target: 'background';
      type: 'CAPTURE_DISCONNECTED';
      payload: { code?: string; sessionId: string };
    }
  | { target: 'background'; type: 'CAPTURE_KEEPALIVE'; payload: { sessionId: string } }
  | { target: 'background'; type: 'CONTENT_READY' }
  | { target: 'background'; type: 'TRANSCRIPT_EVENT'; payload: { event: TranscriptEvent; sessionId: string } }
  | {
      target: 'background';
      type: 'SESSION_START';
      payload: { settings: AppSettings; tabId: number };
    }
  | { target: 'background'; type: 'SESSION_STOP' }
  | { target: 'background'; type: 'SESSION_STATUS' };
