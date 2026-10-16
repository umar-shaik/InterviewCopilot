export type AnswerLength = "concise" | "balanced" | "detailed";

export interface AnswerRequest {
  question: string;
  jobTitle: string;
  jobDescription: string;
  candidateContext: string;
  answerLength: AnswerLength;
  model: string;
}

export interface SuggestedAnswer {
  id: string;
  title: string;
  text: string;
}

export interface AnswerProvider {
  readonly id: string;
  readonly models: readonly string[];
  generate(request: AnswerRequest): Promise<SuggestedAnswer[]>;
}

export interface LiveAnswerRequest {
  jobTitle: string;
  jobDescription: string;
  candidateContext: string;
  answerLength: AnswerLength;
  model: string;
}

export interface LiveAnswerResult {
  isInterviewQuestion: boolean;
  question: string;
  answer: string;
}

export interface GeminiLiveProvider {
  readonly defaultModel: string;
  listAvailableModels(): Promise<string[]>;
  checkConnection(model?: string): Promise<void>;
  processAudio(audio: Uint8Array, mimeType: string, request: LiveAnswerRequest, signal?: AbortSignal): Promise<LiveAudioResult>;
  answer(question: string, request: LiveAnswerRequest, signal?: AbortSignal): Promise<LiveAnswerResult>;
}

export interface LiveAudioResult extends LiveAnswerResult {
  transcript: string;
}
