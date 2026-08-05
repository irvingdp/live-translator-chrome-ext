import type { CaptureStartRequest } from '../audio/offscreen-capture-controller';
import type { TranscriptEvent } from './transcript-stabilizer';

export type ExtensionMessage =
  | { target: 'offscreen'; type: 'CAPTURE_START'; payload: CaptureStartRequest }
  | { target: 'offscreen'; type: 'CAPTURE_STOP' }
  | { target: 'background'; type: 'CAPTURE_DISCONNECTED' }
  | { target: 'background'; type: 'TRANSCRIPT_EVENT'; payload: TranscriptEvent };
