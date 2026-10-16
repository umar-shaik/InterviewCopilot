import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import type { GeminiLiveProvider } from "./providers/types.js";

const app = createApp({ geminiProvider: null });
const liveProvider: GeminiLiveProvider = {
  defaultModel: "gemini-flash-lite-latest",
  async listAvailableModels() {
    return ["gemini-flash-lite-latest", "gemini-2.5-flash"];
  },
  async checkConnection(model) {
    if (model) expect(await liveProvider.listAvailableModels()).toContain(model);
  },
  async processAudio(audio) {
    expect(audio.byteLength).toBeGreaterThan(0);
    return {
      transcript: "Tell me about a difficult project.",
      isInterviewQuestion: true,
      question: "Tell me about a difficult project.",
      answer: "I would explain the challenge and the result."
    };
  },
  async answer(question) {
    return { isInterviewQuestion: true, question, answer: "I would explain the challenge and the result." };
  }
};
const liveApp = createApp({ geminiProvider: liveProvider });

describe("API", () => {
  it("reports a healthy demo API", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", mode: "demo", geminiConfigured: false, configuredProviders: [] });
  });

  it("protects the app and API with single-user HTTP Basic authentication", async () => {
    const protectedApp = createApp({
      geminiProvider: null,
      auth: { username: "mobile-user", password: "strong-test-password" }
    });

    const unauthenticated = await request(protectedApp).get("/api/providers/perplexity/models");
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers["www-authenticate"]).toContain("Basic");

    const health = await request(protectedApp).get("/api/health");
    expect(health.status).toBe(200);

    const authorized = await request(protectedApp)
      .get("/api/providers/perplexity/models")
      .auth("mobile-user", "strong-test-password");
    expect(authorized.status).toBe(503);
    expect(authorized.body.error).toContain("No perplexity API key");
  });

  it("returns clearly simulated suggestions for a valid question", async () => {
    const response = await request(app).post("/api/demo-answer").send({
      question: "Tell me about yourself",
      jobTitle: "Product Designer",
      candidateContext: "I led a user research project.",
      answerLength: "balanced",
      model: "mock-coach"
    });
    expect(response.status).toBe(200);
    expect(response.body.simulated).toBe(true);
    expect(response.body.provider).toBe("demo");
    expect(response.body.answers).toHaveLength(3);
    expect(response.body.answers[0].text).toContain("Product Designer");
  });

  it("changes response length when a different answer length is requested", async () => {
    const answers = await Promise.all(["concise", "balanced", "detailed"].map(async (answerLength) => {
      const response = await request(app).post("/api/demo-answer").send({
        question: "How do you handle a challenge?",
        answerLength,
        model: "mock-coach"
      });
      expect(response.status).toBe(200);
      return response.body.answers[0].text as string;
    }));
    expect(answers[0].length).toBeLessThan(answers[1].length);
    expect(answers[1].length).toBeLessThan(answers[2].length);
  });

  it("rejects empty and oversized question input with a useful message", async () => {
    const empty = await request(app).post("/api/demo-answer").send({ question: "   " });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toContain("empty");

    const oversized = await request(app).post("/api/demo-answer").send({ question: "q".repeat(2001) });
    expect(oversized.status).toBe(400);
    expect(oversized.body.error).toContain("2,000");
  });

  it("returns a structured not-found response", async () => {
    const response = await request(app).get("/api/missing");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Endpoint not found.");
  });

  it("explains when live Gemini is not configured", async () => {
    const response = await request(app).post("/api/live-answer");
    expect(response.status).toBe(503);
    expect(response.body.error).toContain("GEMINI_API_KEY");
  });

  it("explains when a Gemini connection test is attempted without a key", async () => {
    const response = await request(app).post("/api/gemini-status");
    expect(response.status).toBe(503);
    expect(response.body.authenticated).toBe(false);
    expect(response.body.error).toContain("root .env");
  });

  it("accepts a Gemini API key without returning or exposing it in health status", async () => {
    const configuredApp = createApp({ geminiProvider: null });
    const apiKey = "test-gemini-key";
    const saved = await request(configuredApp).post("/api/gemini-key").send({ apiKey });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ configured: true });
    expect(JSON.stringify(saved.body)).not.toContain(apiKey);

    const health = await request(configuredApp).get("/api/health");
    expect(health.body.geminiConfigured).toBe(true);
    expect(JSON.stringify(health.body)).not.toContain(apiKey);
  });

  it("rejects an empty Gemini API key", async () => {
    const response = await request(app).post("/api/gemini-key").send({ apiKey: " " });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Enter a Gemini API key");
  });

  it("stores external-provider keys in memory and lists Perplexity models", async () => {
    const configuredApp = createApp({ geminiProvider: null });
    const apiKey = "test-openai-key";
    const openAiKey = await request(configuredApp).post("/api/providers/openai/key").send({ apiKey });
    expect(openAiKey.status).toBe(200);
    expect(JSON.stringify(openAiKey.body)).not.toContain(apiKey);

    const perplexityKey = await request(configuredApp)
      .post("/api/providers/perplexity/key")
      .send({ apiKey: "test-perplexity-key" });
    expect(perplexityKey.status).toBe(200);

    const models = await request(configuredApp).get("/api/providers/perplexity/models");
    expect(models.status).toBe(200);
    expect(models.body.models).toContain("sonar");

    const health = await request(configuredApp).get("/api/health");
    expect(health.body.configuredProviders).toEqual(expect.arrayContaining(["openai", "perplexity"]));
    expect(JSON.stringify(health.body)).not.toContain(apiKey);
  });

  it("rejects unknown AI provider identifiers", async () => {
    const response = await request(app).post("/api/providers/unknown/key").send({ apiKey: "key" });
    expect(response.status).toBe(400);
  });

  it("checks Gemini model access by generating a sample answer", async () => {
    const response = await request(liveApp).post("/api/gemini-status").send({ model: "gemini-2.5-flash" });
    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(true);
    expect(response.body.authenticated).toBe(true);
    expect(response.body.message).toContain("generated a sample answer");
    expect(response.body.sampleQuestion).toContain("challenging project");
    expect(response.body.sampleAnswer).toContain("challenge");
  });

  it("lists models available to the configured Gemini key", async () => {
    const response = await request(liveApp).get("/api/gemini-models");
    expect(response.status).toBe(200);
    expect(response.body.models).toContain("gemini-flash-lite-latest");
  });

  it("rejects unsupported models in the Gemini connection check", async () => {
    const response = await request(liveApp).post("/api/gemini-status").send({ model: "unsupported-model" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  it("processes a microphone segment and returns a Gemini answer-shaped response", async () => {
    const response = await request(liveApp)
      .post("/api/live-answer")
      .field("answerLength", "balanced")
      .field("model", "gemini-flash-lite-latest")
      .attach("audio", Buffer.from("test audio bytes"), { filename: "segment.webm", contentType: "audio/webm;codecs=opus" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      simulated: false,
      provider: "gemini",
      transcript: "Tell me about a difficult project.",
      isInterviewQuestion: true,
      question: "Tell me about a difficult project."
    });
    expect(response.body.answers[0].text).toContain("challenge");
  });

  it("answers typed questions through the configured live provider", async () => {
    const response = await request(liveApp).post("/api/answer").send({
      question: "Tell me about a difficult project.",
      model: "gemini-flash-lite-latest"
    });
    expect(response.status).toBe(200);
    expect(response.body.simulated).toBe(false);
    expect(response.body.answers[0].text).toContain("challenge");
  });

  it("rejects a live request without an audio segment", async () => {
    const response = await request(liveApp).post("/api/live-answer").field("answerLength", "balanced");
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("audio segment");
  });
});
