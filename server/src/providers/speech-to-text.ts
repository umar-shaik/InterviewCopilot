export interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SpeechToTextProvider {
  readonly id: string;
  transcribe(audio: Uint8Array, mimeType: string): Promise<TranscriptSegment[]>;
}
