import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalModelProvider } from "./external.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("external AI providers", () => {
  it("lists only OpenAI chat models available to the key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "gpt-4o-mini" }, { id: "text-embedding-3-small" }, { id: "o3-mini" }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const models = await new ExternalModelProvider("openai", "secret-test-key").listAvailableModels();

    expect(models).toEqual(["gpt-4o-mini", "o3-mini"]);
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
      headers: { authorization: "Bearer secret-test-key" }
    });
  });

  it("uses the Anthropic Messages API to generate an answer", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "x-api-key": "claude-secret", "anthropic-version": "2023-06-01" });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "I would start with the challenge." }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const answer = await new ExternalModelProvider("anthropic", "claude-secret").answer(
      "Tell me about a challenge.",
      { jobTitle: "", jobDescription: "", candidateContext: "", answerLength: "balanced" },
      "claude-test-model"
    );

    expect(answer).toBe("I would start with the challenge.");
    expect(fetchMock).toHaveBeenCalledWith("https://api.anthropic.com/v1/messages", expect.any(Object));
  });

  it("transcribes microphone audio with OpenAI Whisper", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({ authorization: "Bearer openai-secret" });
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response(JSON.stringify({ text: "Tell me about a challenge." }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const transcript = await new ExternalModelProvider("openai", "openai-secret")
      .transcribe(new Uint8Array([1, 2, 3]), "audio/wav");

    expect(transcript).toBe("Tell me about a challenge.");
    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/audio/transcriptions", expect.any(Object));
  });
});
