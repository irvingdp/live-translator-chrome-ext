class PcmForwarderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0] ?? [];
    const firstChannel = channels.find((channel) => channel.length > 0);
    if (!firstChannel) return true;

    // Tab capture is commonly stereo. Average every available channel so
    // speech panned to either side reaches the mono transcription stream while
    // duplicate centre content keeps its original level and cannot clip.
    const mono = new Float32Array(firstChannel.length);
    let channelCount = 0;
    for (const channel of channels) {
      if (channel.length === 0) continue;
      channelCount += 1;
      for (let index = 0; index < mono.length; index += 1) {
        mono[index] += channel[index] ?? 0;
      }
    }
    if (channelCount > 1) {
      for (let index = 0; index < mono.length; index += 1) {
        mono[index] /= channelCount;
      }
    }
    this.port.postMessage(mono.buffer, [mono.buffer]);
    return true;
  }
}

registerProcessor('pcm-forwarder', PcmForwarderProcessor);
