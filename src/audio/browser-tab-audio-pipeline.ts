import type { AudioPipeline } from './offscreen-capture-controller';

interface TabAudioConstraints extends MediaTrackConstraints {
  mandatory: {
    chromeMediaSource: 'tab';
    chromeMediaSourceId: string;
  };
}

export const TRANSCRIPTION_SAMPLE_RATE = 16_000;

interface SilentSinkAudioContext extends AudioContext {
  setSinkId?(sinkId: { type: 'none' }): Promise<void>;
}

async function preferSilentSink(context: AudioContext): Promise<void> {
  const silentContext = context as SilentSinkAudioContext;
  if (!silentContext.setSinkId) return;
  // Chrome 110+ supports a clocked output that renders the graph without using
  // a physical audio device. A zero-gain destination remains connected below
  // as a safe fallback if the device switch is rejected.
  await silentContext.setSinkId({ type: 'none' }).catch(() => undefined);
}

function disconnect(node: AudioNode | undefined): void {
  try {
    node?.disconnect();
  } catch {
    // Partial initialization and repeated browser teardown can leave a node
    // disconnected before our own cleanup reaches it.
  }
}

export async function createBrowserTabAudioPipeline(
  streamId: string,
  onSamples: (samples: Float32Array) => void,
): Promise<AudioPipeline> {
  const media = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    } as TabAudioConstraints,
    video: false,
  });
  const tracks = media.getTracks();
  const endedListeners = new Set<() => void>();
  const handleTrackEnded = () => {
    for (const listener of endedListeners) listener();
  };
  for (const track of tracks) track.addEventListener('ended', handleTrackEnded);

  let playbackContext: AudioContext | undefined;
  let processingContext: AudioContext | undefined;
  let playbackSource: MediaStreamAudioSourceNode | undefined;
  let processingSource: MediaStreamAudioSourceNode | undefined;
  let silentOutput: GainNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let cleanupPromise: Promise<void> | undefined;

  const cleanup = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      if (worklet) worklet.port.onmessage = null;
      disconnect(worklet);
      disconnect(silentOutput);
      disconnect(processingSource);
      disconnect(playbackSource);
      for (const track of tracks) {
        track.removeEventListener('ended', handleTrackEnded);
        track.stop();
      }
      endedListeners.clear();

      const contexts = [processingContext, playbackContext].filter(
        (context): context is AudioContext => context !== undefined,
      );
      const results = await Promise.allSettled(
        contexts.map((context) => context.close()),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failure) throw failure.reason;
    })();
    return cleanupPromise;
  };

  try {
    // Capturing a tab suppresses its normal playback. Keep this graph at the
    // device's native rate so the user does not hear speech degraded to 16 kHz.
    playbackContext = new AudioContext({ latencyHint: 'interactive' });
    playbackSource = playbackContext.createMediaStreamSource(media);
    playbackSource.connect(playbackContext.destination);

    // A MediaStream source is natively resampled to its AudioContext's rate by
    // Web Audio. This replaces the former linear interpolator with Chromium's
    // streaming resampler before the worklet receives each render quantum.
    processingContext = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: TRANSCRIPTION_SAMPLE_RATE,
    });
    if (processingContext.sampleRate !== TRANSCRIPTION_SAMPLE_RATE) {
      throw new Error(
        `Unsupported transcription sample rate: ${processingContext.sampleRate}`,
      );
    }
    await preferSilentSink(processingContext);
    await processingContext.audioWorklet.addModule(
      chrome.runtime.getURL('audio-processor.js'),
    );

    processingSource = processingContext.createMediaStreamSource(media);
    worklet = new AudioWorkletNode(processingContext, 'pcm-forwarder', {
      channelCountMode: 'max',
      channelInterpretation: 'discrete',
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    silentOutput = processingContext.createGain();
    silentOutput.gain.value = 0;
    processingSource
      .connect(worklet)
      .connect(silentOutput)
      .connect(processingContext.destination);
    worklet.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) {
        onSamples(new Float32Array(event.data));
      }
    };

    return {
      sampleRate: processingContext.sampleRate,
      onEnded(listener) {
        endedListeners.add(listener);
        return () => endedListeners.delete(listener);
      },
      close: cleanup,
    };
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
}
