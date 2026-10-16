import { useEffect, useRef, useState } from "react";

type CaptureSession = {
  active: boolean;
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  recorder: MediaRecorder | null;
  chunks: BlobPart[];
  speaking: boolean;
  silenceStartedAt: number;
  recorderStartedAt: number;
  frameId: number;
};

const SILENCE_TO_SPLIT_MS = 1100;
const MAX_SEGMENT_MS = 15000;
const SPEECH_LEVEL_THRESHOLD = 0.025;

export function useLiveCapture(
  onSegment: (segment: Blob) => void,
  onError: (message: string) => void
) {
  const [isRecording, setIsRecording] = useState(false);
  const sessionRef = useRef<CaptureSession | null>(null);
  const onSegmentRef = useRef(onSegment);
  const onErrorRef = useRef(onError);
  onSegmentRef.current = onSegment;
  onErrorRef.current = onError;

  function releaseSession(session: CaptureSession) {
    session.active = false;
    window.cancelAnimationFrame(session.frameId);
    if (session.recorder?.state === "recording") session.recorder.stop();
    session.recorder = null;
    session.stream.getTracks().forEach((track) => track.stop());
    void session.context.close();
    if (sessionRef.current === session) sessionRef.current = null;
    setIsRecording(false);
  }

  function startSegment(session: CaptureSession): boolean {
    if (!session.active) return false;
    try {
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(session.stream, mimeType ? { mimeType } : undefined);
      session.recorder = recorder;
      session.chunks = [];
      session.recorderStartedAt = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) session.chunks.push(event.data);
      };
      recorder.onerror = () => onErrorRef.current("The browser could not record microphone audio. Check microphone access and try again.");
      recorder.onstop = () => {
        const segment = new Blob(session.chunks, { type: recorder.mimeType || "audio/webm" });
        session.chunks = [];
        if (session.active && segment.size > 512) onSegmentRef.current(segment);
        if (session.active && !session.recorder && !startSegment(session)) {
          onErrorRef.current("Could not restart microphone recording after processing an audio segment.");
          releaseSession(session);
        }
      };
      recorder.start(250);
      return true;
    } catch {
      onErrorRef.current("This browser could not start audio capture. Try a current version of Edge or Chrome.");
      return false;
    }
  }

  function stopCapture() {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    releaseSession(session);
  }

  async function startCapture() {
    if (sessionRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture requires a secure browser context. Open the app at localhost and try again.");
    }
    if (typeof MediaRecorder === "undefined") {
      throw new Error("This browser does not support microphone recording. Try a current version of Edge or Chrome.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });

    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const session: CaptureSession = {
        active: true,
        stream,
        context,
        analyser,
        recorder: null,
        chunks: [],
        speaking: false,
        silenceStartedAt: 0,
        recorderStartedAt: Date.now(),
        frameId: 0
      };
      sessionRef.current = session;
      if (!startSegment(session)) {
        releaseSession(session);
        throw new Error("Could not start microphone recording. Check your browser's microphone permissions.");
      }
      const samples = new Float32Array(analyser.fftSize);
      const detectSpeech = () => {
        if (!session.active) return;
        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) sumSquares += sample * sample;
        const level = Math.sqrt(sumSquares / samples.length);
        const now = Date.now();
        if (level >= SPEECH_LEVEL_THRESHOLD) {
          session.speaking = true;
          session.silenceStartedAt = 0;
        } else if (session.speaking) {
          if (!session.silenceStartedAt) session.silenceStartedAt = now;
          if (now - session.silenceStartedAt >= SILENCE_TO_SPLIT_MS) {
            session.speaking = false;
            session.silenceStartedAt = 0;
            const recorder = session.recorder;
            session.recorder = null;
            if (recorder?.state === "recording") recorder.stop();
          }
        }
        if (session.speaking && now - session.recorderStartedAt >= MAX_SEGMENT_MS) {
          session.speaking = false;
          const recorder = session.recorder;
          session.recorder = null;
          if (recorder?.state === "recording") recorder.stop();
        }
        session.frameId = window.requestAnimationFrame(detectSpeech);
      };
      session.frameId = window.requestAnimationFrame(detectSpeech);
      setIsRecording(true);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
  }

  useEffect(() => stopCapture, []);

  return { isRecording, startCapture, stopCapture };
}
