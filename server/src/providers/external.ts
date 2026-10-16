export type ExternalProviderId = "openai" | "anthropic" | "xai" | "perplexity";

type ModelListResponse = {
  data?: { id?: string; display_name?: string }[];
};

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
};

export class ProviderApiError extends Error {
  constructor(readonly provider: ExternalProviderId, readonly status: number) {
    super(`${provider} API request failed with status ${status}.`);
  }
}

const modelPrefixes: Record<ExternalProviderId, string> = {
  openai: "gpt-",
  anthropic: "claude-",
  xai: "grok-",
  perplexity: "sonar"
};

const providerNames: Record<ExternalProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  xai: "xAI",
  perplexity: "Perplexity"
};

export class ExternalModelProvider {
  constructor(readonly id: ExternalProviderId, private readonly apiKey: string) {}

  async listAvailableModels(): Promise<string[]> {
    if (this.id === "perplexity") {
      return ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro", "sonar-deep-research"];
    }
    const response = await fetch(this.modelsUrl(), { headers: this.headers() });
    if (!response.ok) throw new ProviderApiError(this.id, response.status);
    const result = await response.json() as ModelListResponse;
    const models = (result.data ?? [])
      .map((model) => model.id)
      .filter((model): model is string => Boolean(
        model && (this.id === "openai"
          ? /^(gpt-|chatgpt-|o[1-9])/i.test(model)
          : model.startsWith(modelPrefixes[this.id]))
      ));
    if (this.id === "anthropic") return models.sort((left, right) => right.localeCompare(left));
    return models.sort((left, right) => left.localeCompare(right));
  }

  async answer(
    question: string,
    context: { jobTitle: string; jobDescription: string; candidateContext: string; answerLength: string },
    model: string,
    signal?: AbortSignal
  ): Promise<string> {
    const system = [
      "You are an interview answer coach. Write only a suggested answer in the candidate's first person voice.",
      "Ground the answer strictly in the provided candidate context. Do not invent personal stories, employers, achievements, credentials, or metrics.",
      "If no relevant experience is provided, give an honest general framework and mark where the candidate should add a real example.",
      `Keep the answer ${context.answerLength === "concise" ? "to 2-3 sentences" : context.answerLength === "detailed" ? "about 120-160 words" : "about 70-100 words"}.`
    ].join(" ");
    const prompt = [
      `Interview question: ${question}`,
      `Job title: ${context.jobTitle || "Not specified"}`,
      `Job description: ${context.jobDescription || "Not specified"}`,
      `Candidate experience and context: ${context.candidateContext || "Not specified"}`
    ].join("\n\n");

    return this.complete(model, system, prompt, signal);
  }

  async answerTranscript(
    transcript: string,
    context: { jobTitle: string; jobDescription: string; candidateContext: string; answerLength: string },
    model: string,
    signal?: AbortSignal
  ): Promise<{ isInterviewQuestion: boolean; question: string; answer: string }> {
    const system = [
      "You are an interview answer coach. Determine whether the supplied transcript contains a clear interviewer question.",
      "Return only a JSON object with isInterviewQuestion (boolean), question (string), and answer (string).",
      "If it is not a clear interview question, set isInterviewQuestion to false and both question and answer to empty strings.",
      "For a question, give a clean version and a natural first-person suggested answer.",
      "Ground the answer strictly in candidate context. Never invent personal stories, employers, achievements, credentials, or metrics.",
      `Keep the answer ${context.answerLength === "concise" ? "to 2-3 sentences" : context.answerLength === "detailed" ? "about 120-160 words" : "about 70-100 words"}.`
    ].join(" ");
    const prompt = [
      `Transcript: ${transcript}`,
      `Job title: ${context.jobTitle || "Not specified"}`,
      `Job description: ${context.jobDescription || "Not specified"}`,
      `Candidate experience and context: ${context.candidateContext || "Not specified"}`
    ].join("\n\n");
    const text = await this.complete(model, system, prompt, signal);
    let decoded: unknown;
    try {
      decoded = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      throw new Error(`${providerNames[this.id]} returned a response in an unexpected format.`);
    }
    if (
      typeof decoded !== "object" || decoded === null ||
      !("isInterviewQuestion" in decoded) || !("question" in decoded) || !("answer" in decoded) ||
      typeof decoded.isInterviewQuestion !== "boolean" ||
      typeof decoded.question !== "string" ||
      typeof decoded.answer !== "string"
    ) {
      throw new Error(`${providerNames[this.id]} returned a response in an unexpected format.`);
    }
    return {
      isInterviewQuestion: decoded.isInterviewQuestion,
      question: decoded.question,
      answer: decoded.answer
    };
  }

  private async complete(model: string, system: string, prompt: string, signal?: AbortSignal): Promise<string> {
    if (this.id === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { ...this.headers(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 512, system, messages: [{ role: "user", content: prompt }] }),
        signal
      });
      if (!response.ok) throw new ProviderApiError(this.id, response.status);
      const result = await response.json() as { content?: { type?: string; text?: string }[] };
      const text = result.content?.find((part) => part.type === "text")?.text?.trim();
      if (!text) throw new Error("Anthropic returned an empty answer.");
      return text;
    }

    const response = await fetch(this.chatUrl(), {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }]
      }),
      signal
    });
    if (!response.ok) throw new ProviderApiError(this.id, response.status);
    const result = await response.json() as ChatResponse;
    const text = result.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error(`${providerNames[this.id]} returned an empty answer.`);
    return text;
  }

  async transcribe(audio: Uint8Array, mimeType: string, signal?: AbortSignal): Promise<string> {
    if (this.id !== "openai") throw new Error("OpenAI is required for microphone transcription with this provider.");
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", new Blob([Buffer.from(audio)], { type: mimeType }), "interview-audio.wav");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: this.headers(),
      body: form,
      signal
    });
    if (!response.ok) throw new ProviderApiError(this.id, response.status);
    const result = await response.json() as { text?: string };
    const text = result.text?.trim();
    if (!text) throw new Error("OpenAI returned an empty transcription.");
    return text;
  }

  private modelsUrl(): string {
    if (this.id === "anthropic") return "https://api.anthropic.com/v1/models";
    if (this.id === "xai") return "https://api.x.ai/v1/models";
    return "https://api.openai.com/v1/models";
  }

  private chatUrl(): string {
    if (this.id === "xai") return "https://api.x.ai/v1/chat/completions";
    if (this.id === "perplexity") return "https://api.perplexity.ai/chat/completions";
    return "https://api.openai.com/v1/chat/completions";
  }

  private headers(): Record<string, string> {
    if (this.id === "anthropic") return { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" };
    return { authorization: `Bearer ${this.apiKey}` };
  }
}

export function externalProviderErrorMessage(error: ProviderApiError): string {
  const name = providerNames[error.provider];
  if (error.status === 401 || error.status === 403) return `${name} rejected this API key or denied access. Check the key and account permissions in ${name}.`;
  if (error.status === 404) return `${name} could not find the selected model. Load the available models for this key and choose another model.`;
  if (error.status === 429) return `${name} rate limit or quota was reached. Check your account limits and try again later.`;
  return `${name} could not process the request. Check your connection and provider status, then try again.`;
}
