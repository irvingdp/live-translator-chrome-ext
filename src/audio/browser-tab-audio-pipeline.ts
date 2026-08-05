import type { AudioPipeline } from './offscreen-capture-controller';

interface TabAudioConstraints extends MediaTrackConstraints {
  mandatory: {
    chromeMediaSource: 'tab';
    chromeMediaSourceId: string;
  };
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
  let context: AudioContext | undefined;
  try {
    context = new AudioContext({ latencyHint: 'interactive' });
    const activeContext = context;
    await activeContext.audioWorklet.addModule(
      chrome.runtime.getURL('audio-processor.js'),
    );

    const source = activeContext.createMediaStreamSource(media);
    source.connect(activeContext.destination);

    const worklet = new AudioWorkletNode(activeContext, 'pcm-forwarder');
    const silentOutput = activeContext.createGain();
    silentOutput.gain.value = 0;
    source
      .connect(worklet)
      .connect(silentOutput)
      .connect(activeContext.destination);
    worklet.port.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) {
        onSamples(new Float32Array(event.data));
      }
    };
    const endedListeners = new Set<() => void>();
    const handleTrackEnded = () => {
      for (const listener of endedListeners) listener();
    };
    for (const track of media.getTracks()) {
      track.addEventListener('ended', handleTrackEnded);
    }

    return {
      sampleRate: activeContext.sampleRate,
      onEnded(listener) {
        endedListeners.add(listener);
        return () => endedListeners.delete(listener);
      },
      async close() {
        worklet.port.onmessage = null;
        worklet.disconnect();
        silentOutput.disconnect();
        source.disconnect();
        for (const track of media.getTracks()) {
          track.removeEventListener('ended', handleTrackEnded);
          track.stop();
        }
        endedListeners.clear();
        await activeContext.close();
      },
    };
  } catch (error) {
    for (const track of media.getTracks()) track.stop();
    await context?.close().catch(() => undefined);
    throw error;
  }
}
