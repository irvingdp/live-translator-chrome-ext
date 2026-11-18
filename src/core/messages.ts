import type {
  CaptionPairUpdate,
  CaptureStartRequest,
} from '../audio/offscreen-capture-controller';
import type { CaptionPair } from './caption-window';
import type { ReadAheadStatusCode } from './capture-session-controller';
import type { AppSettings, CaptionAppearance } from './settings';
import type { OverlayLayout } from './overlay-layout';
import type { LocalWhisperModel } from '../read-ahead/local-whisper';
import type { PlaybackClock } from './word-highlight';

// A model download as the popup shows it (chrome.storage.session).
export interface LocalWhisperDownload {
  error?: string;
  loadedMB: number;
  model: LocalWhisperModel;
  state: 'done' | 'downloading' | 'failed';
  totalMB: number;
  // When the background last heard of it (Date.now()).
  updatedAt: number;
}

export type ExtensionMessage =
  | { target: 'offscreen'; type: 'CAPTURE_START'; payload: CaptureStartRequest }
  | { target: 'offscreen'; type: 'CAPTURE_STOP'; payload: { sessionId: string } }
  | {
      target: 'offscreen';
      type: 'CAPTURE_CONFIG_UPDATE';
      payload: { maxLineWidth: number; sessionId: string };
    }
  // Local Whisper (issue #15), run in the offscreen document: load (and with
  // `download`, fetch) a model; recognize one chunk; free the GPU.
  | {
      target: 'offscreen';
      type: 'LOCAL_WHISPER_LOAD';
      payload: { download: boolean; model: LocalWhisperModel };
    }
  | {
      target: 'offscreen';
      type: 'LOCAL_WHISPER_TRANSCRIBE';
      payload: { audioBase64: string; model: LocalWhisperModel; sourceLanguage?: string };
    }
  | { target: 'offscreen'; type: 'LOCAL_WHISPER_UNLOAD' }
  // The offscreen document's download progress, then its end ('done' or
  // 'failed'), kept by the background for the popup to show. The download is
  // the offscreen document's: the service worker may be restarted meanwhile.
  | {
      target: 'background';
      type: 'LOCAL_WHISPER_PROGRESS';
      payload: Omit<LocalWhisperDownload, 'updatedAt'>;
    }
  // The popup asks for a model's download, once the viewer agreed to its size.
  | {
      target: 'background';
      type: 'LOCAL_WHISPER_DOWNLOAD';
      payload: { model: LocalWhisperModel };
    }
  | {
      target: 'background';
      type: 'CAPTION_PAIR_UPDATES';
      payload: { sessionId: string; updates: CaptionPairUpdate[] };
    }
  | {
      target: 'background';
      type: 'CAPTURE_DISCONNECTED';
      payload: { code?: string; sessionId: string };
    }
  | { target: 'background'; type: 'CAPTURE_KEEPALIVE'; payload: { sessionId: string } }
  | { target: 'background'; type: 'CONTENT_READY' }
  | { target: 'background'; type: 'CLEAR_CAPTIONS' }
  | { target: 'background'; type: 'MEDIA_PLAYING' }
  | {
      target: 'background';
      type: 'BROWSER_FULLSCREEN_FALLBACK';
      payload: { active: boolean };
    }
  | {
      target: 'background';
      type: 'OPEN_SIDE_PANEL';
      payload: { layout: OverlayLayout };
    }
  | {
      target: 'background';
      type: 'OVERLAY_LAYOUT_CHANGED';
      payload: { layout: OverlayLayout };
    }
  | {
      target: 'background';
      type: 'OVERLAY_APPEARANCE_CHANGED';
      payload: { appearance: CaptionAppearance };
    }
  | {
      target: 'background';
      type: 'SESSION_START';
      payload: { settings: AppSettings; tabId: number };
    }
  | {
      target: 'background';
      type: 'SESSION_AUTHORIZE_TAB';
      payload: { tabId: number };
    }
  | { target: 'background'; type: 'SESSION_STOP' }
  | {
      target: 'background';
      type: 'READ_AHEAD_TRANSLATE';
      payload: { audioBase64: string; sessionId: string };
    }
  | {
      target: 'background';
      type: 'READ_AHEAD_WEB_TRANSLATE';
      payload: {
        sessionId: string;
        sourceLanguage?: string;
        targetLanguage: string;
        texts: string[];
        timeoutMs: number;
      };
    }
  | {
      target: 'background';
      type: 'READ_AHEAD_CUE';
      payload: { cue?: CaptionPair; sessionId: string };
    }
  | {
      target: 'background';
      type: 'READ_AHEAD_STATUS';
      payload: { sessionId: string; status?: ReadAheadStatusCode };
    }
  // The overlay's "switch to … Whisper" button, after a recognizer could not
  // serve (Gemini → Groq → Local Whisper, Local Whisper → Groq).
  | {
      target: 'background';
      type: 'READ_AHEAD_SWITCH_RECOGNIZER';
      payload: { recognizer: 'groq' | 'local' };
    }
  // The main player's time, on play, pause, seek, rate change and every few
  // seconds, for word highlight in the side panel.
  | {
      target: 'background';
      type: 'READ_AHEAD_CLOCK';
      payload: { clock: PlaybackClock; sessionId: string };
    }
  // The caption-track notice's "改用語音辨識" button (issue #18): stop
  // preferring caption tracks and recognize from where the viewer is.
  | { target: 'background'; type: 'READ_AHEAD_USE_RECOGNIZER' }
  // The "允許這個網站" button (ADR 0009): opens the popup to allow the site.
  | { target: 'background'; type: 'READ_AHEAD_OPEN_SITE_ACCESS' }
  | { target: 'background'; type: 'SESSION_STATUS' };
