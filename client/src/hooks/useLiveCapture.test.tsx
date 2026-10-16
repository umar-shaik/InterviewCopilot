import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveCapture } from "./useLiveCapture";

class TestAnalyser {
  fftSize = 2048;
  getFloatTimeDomainData(samples: Float32Array) { samples.fill(0); }
}

class TestAudioContext {
  createAnalyser() { return new TestAnalyser(); }
  createMediaStreamSource() { return { connect: vi.fn() }; }
  close = vi.fn().mockResolvedValue(undefined);
}

class TestMediaRecorder {
  static isTypeSupported() { return true; }
  state: RecordingState = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.onstop?.(new Event("stop"));
  }
  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useLiveCapture", () => {
  it("requests microphone access only when started and releases it on stop", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    vi.stubGlobal("AudioContext", TestAudioContext);
    vi.stubGlobal("MediaRecorder", TestMediaRecorder);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const { result } = renderHook(() => useLiveCapture(vi.fn(), vi.fn()));
    expect(getUserMedia).not.toHaveBeenCalled();

    await act(async () => { await result.current.startCapture(); });
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(true);

    act(() => result.current.stopCapture());
    expect(track.stop).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(false);
  });
});
