import { afterEach, describe, expect, it, vi } from "vitest";
import { convertAudioToWav } from "./audio";

class TestAudioContext {
  close = vi.fn().mockResolvedValue(undefined);
  async decodeAudioData() {
    return {
      length: 4,
      sampleRate: 32000,
      numberOfChannels: 2,
      getChannelData: (channel: number) => channel === 0
        ? new Float32Array([0.25, 0.5, -0.25, -0.5])
        : new Float32Array([0.25, 0.5, -0.25, -0.5])
    } as AudioBuffer;
  }
}

class TestBlob {
  readonly type: string;
  private readonly bytes: Uint8Array;

  constructor(parts: BlobPart[], options?: BlobPropertyBag) {
    this.type = options?.type ?? "";
    const chunks = parts.map((part) => {
      if (part instanceof ArrayBuffer) return new Uint8Array(part);
      if (ArrayBuffer.isView(part)) return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
      if (typeof part !== "string") throw new Error("Unexpected Blob part in audio test.");
      return new TextEncoder().encode(part);
    });
    this.bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      this.bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }

  async arrayBuffer() {
    return this.bytes.slice().buffer;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("convertAudioToWav", () => {
  it("converts microphone audio to mono 16 kHz PCM WAV for Gemini", async () => {
    vi.stubGlobal("AudioContext", TestAudioContext);
    vi.stubGlobal("Blob", TestBlob);
    const recording = { arrayBuffer: async () => new ArrayBuffer(3) } as Blob;

    const wav = await convertAudioToWav(recording);
    const data = new DataView(await wav.arrayBuffer());

    expect(wav.type).toBe("audio/wav");
    expect(data.getUint32(24, true)).toBe(16000);
    expect(data.getUint16(22, true)).toBe(1);
    expect(data.getUint16(34, true)).toBe(16);
    expect(data.getUint32(40, true)).toBe(4);
    expect(data.byteLength).toBe(48);
  });
});
