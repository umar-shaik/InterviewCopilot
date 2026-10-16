import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { GeminiLiveProvider, LiveAnswerRequest, LiveAnswerResult, LiveAudioResult } from "./types.js";

const resultSchema = z.object({
  transcript: z.string(),
  isInterviewQuestion: z.boolean(),
  question: z.string(),
  answer: z.string()
});

const resultJsonSchema = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING" },
    isInterviewQuestion: { type: "BOOLEAN" },
    question: { type: "STRING" },
    answer: { type: "STRING" }
  },
  required: ["transcript", "isInterviewQuestion", "question", "answer"]
};

function systemPrompt(answerLength: LiveAnswerRequest["answerLength"]): string {
  const lengthGuidance = {
    concise: "Keep a suggested answer to 2-3 sentences, about 35-55 words.",
    balanced: "Keep a suggested answer to about 70-100 words.",
    detailed: "Keep a suggested answer to about 120-160 words."
  }[answerLength];
  return [
    "You are an interview answer coach.",
    "For audio, accurately transcribe only the audible speech in transcript, without adding words.",
    "Decide whether the transcript or supplied question is an interviewer question or a direct prompt asking the candidate to answer.",
    "If there is no clear interview question, set isInterviewQuestion=false and set question and answer to empty strings.",
    "For a question, set isInterviewQuestion=true, put a clean version in question, and give a natural first-person suggested answer in answer.",
    "Ground the answer strictly in the provided candidate context. Never invent a personal story, employer, achievement, credential, or metric. If there is no relevant context, give an honest general framework and invite the candidate to insert a real example.",
    lengthGuidance,
    "Return the requested JSON fields only."
  ].join(" ");
}

export class GeminiProvider implements GeminiLiveProvider {
  readonly defaultModel: string;
  private readonly client: GoogleGenAI;

  constructor(apiKey: string, model = "gemini-flash-lite-latest") {
    this.client = new GoogleGenAI({ apiKey: apiKey.trim() });
    this.defaultModel = normalizeModelName(model) ?? "gemini-flash-lite-latest";
  }

  async listAvailableModels(): Promise<string[]> {
    const models: string[] = [];
    for await (const model of await this.client.models.list()) {
      const name = normalizeModelName(model.name);
      if (name && model.supportedActions?.includes("generateContent") && !/(image|tts|transcribe|live|embedding|robotics|computer-use|nano-banana|omni)/i.test(name)) {
        models.push(name);
      }
    }
    return [...new Set(models)].sort((left, right) => {
      if (left === this.defaultModel) return -1;
      if (right === this.defaultModel) return 1;
      return left.localeCompare(right);
    });
  }

  async checkConnection(model = this.defaultModel): Promise<void> {
    await this.client.models.get({ model: this.requireModel(model) });
  }

  async processAudio(
    audio: Uint8Array,
    mimeType: string,
    request: LiveAnswerRequest,
    signal?: AbortSignal
  ): Promise<LiveAudioResult> {
    const prompt = this.requestContext(request, "Transcribe the provided microphone audio and prepare a suggested interview answer only if it contains an interviewer question.");
    const response = await this.client.models.generateContent({
      model: this.requireModel(request.model),
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: Buffer.from(audio).toString("base64") } },
          { text: prompt }
        ]
      }],
      config: {
        systemInstruction: systemPrompt(request.answerLength),
        responseMimeType: "application/json",
        responseJsonSchema: resultJsonSchema,
        temperature: 0.3,
        abortSignal: signal
      }
    });
    return this.parseResult(response.text);
  }

  async answer(question: string, request: LiveAnswerRequest, signal?: AbortSignal): Promise<LiveAnswerResult> {
    const response = await this.client.models.generateContent({
      model: this.requireModel(request.model),
      contents: this.requestContext(request, `Interview question: ${question}`),
      config: {
        systemInstruction: systemPrompt(request.answerLength),
        responseMimeType: "application/json",
        responseJsonSchema: resultJsonSchema,
        temperature: 0.3,
        abortSignal: signal
      }
    });
    return this.parseResult(response.text);
  }

  private requireModel(model: string): string {
    const normalized = normalizeModelName(model);
    if (!normalized) throw new Error("Choose a valid Gemini model from Settings.");
    return normalized;
  }

  private requestContext(request: LiveAnswerRequest, question: string): string {
    return [
      question,
      `Job title: ${request.jobTitle || "Not specified"}`,
      `Job description: ${request.jobDescription || "Not specified"}`,
      `Candidate experience and context: ${request.candidateContext || "Not specified"}`
    ].join("\n\n");
  }

  private parseResult(text: string | undefined): LiveAudioResult {
    if (!text) throw new Error("Gemini returned an empty response.");
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new Error("Gemini returned a response in an unexpected format.");
    }
    const parsed = resultSchema.safeParse(decoded);
    if (!parsed.success) throw new Error("Gemini returned a response in an unexpected format.");
    return parsed.data;
  }
}

function normalizeModelName(model: string | undefined): string | null {
  const normalized = model?.replace(/^models\//, "").trim();
  return normalized && /^gemini-[a-z0-9.-]+$/i.test(normalized) ? normalized : null;
}

export function geminiErrorMessage(error: ApiError): string {
  if (error.status === 400) return "Gemini rejected the request or audio format. Try speaking a clear, short question.";
  if (error.status === 401 || error.status === 403) return "Google rejected this Gemini API key or project. Create a Gemini API key in Google AI Studio, then replace the key in Settings or the root .env file.";
  if (error.status === 404) return "Google says this API key's project cannot use the selected model. In Settings, click “Load models available to my key” and choose a model Google lists. If Google lists none, create or select a Gemini key in Google AI Studio.";
  if (error.status === 429) return "Gemini's free-tier rate limit or quota was reached. Check active limits in Google AI Studio and try again after they reset.";
  return "Gemini could not process the request. Check your connection and Gemini API status, then try again.";
}

export function geminiModelsErrorMessage(error: ApiError): string {
  if (error.status === 404) return "Google couldn't list models for this key. Create the key in Google AI Studio, then confirm Gemini API access is enabled for its project.";
  return geminiErrorMessage(error);
}
