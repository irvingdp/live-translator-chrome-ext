import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface WorkletProcessorHarness {
  port: { postMessage: ReturnType<typeof vi.fn> };
  process(inputs: Float32Array[][]): boolean;
}

let Processor: new () => WorkletProcessorHarness;

beforeAll(async () => {
  class FakeAudioWorkletProcessor {
    readonly port = { postMessage: vi.fn() };
  }

  vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor);
  vi.stubGlobal(
    'registerProcessor',
    vi.fn(
      (
        _name: string,
        implementation: new () => WorkletProcessorHarness,
      ) => {
        Processor = implementation;
      },
    ),
  );
  await vi.importActual('../../public/audio-processor.js');
});

afterAll(() => vi.unstubAllGlobals());

describe('PcmForwarderProcessor', () => {
  it('does not post empty render quanta', () => {
    const processor = new Processor();

    expect(processor.process([])).toBe(true);
    expect(processor.port.postMessage).not.toHaveBeenCalled();
  });

  it('copies mono input into a transferable buffer', () => {
    const processor = new Processor();

    expect(processor.process([[Float32Array.from([0.25, -0.5])]])).toBe(true);

    const [buffer, transfer] = processor.port.postMessage.mock.calls[0]!;
    expect(Array.from(new Float32Array(buffer as ArrayBuffer))).toEqual([
      0.25, -0.5,
    ]);
    expect(transfer).toEqual([buffer]);
  });

  it('averages every available input channel into mono', () => {
    const processor = new Processor();

    processor.process([
      [
        Float32Array.from([1, 0.8, -1]),
        Float32Array.from([0, 0.8, 1]),
      ],
    ]);

    const buffer = processor.port.postMessage.mock.calls[0]![0] as ArrayBuffer;
    expect(Array.from(new Float32Array(buffer))).toEqual([
      0.5, 0.800000011920929, 0,
    ]);
  });

  it('uses all channels instead of assuming stereo', () => {
    const processor = new Processor();

    processor.process([
      [
        Float32Array.from([1, 0]),
        Float32Array.from([0, 1]),
        Float32Array.from([0.5, 0.5]),
      ],
    ]);

    const buffer = processor.port.postMessage.mock.calls[0]![0] as ArrayBuffer;
    expect(Array.from(new Float32Array(buffer))).toEqual([0.5, 0.5]);
  });
});
