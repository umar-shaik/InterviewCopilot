import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { geminiErrorMessage } from "./gemini.js";

describe("geminiErrorMessage", () => {
  it("includes Gemini's specific explanation for bad requests", () => {
    const error = new ApiError({ status: 400, message: "Invalid audio format.\nUse WAV." });

    expect(geminiErrorMessage(error)).toBe(
      "Gemini rejected the request (HTTP 400): Invalid audio format. Use WAV."
    );
  });

  it("limits the included bad-request details", () => {
    const error = new ApiError({ status: 400, message: "x".repeat(600) });

    expect(geminiErrorMessage(error)).toHaveLength(
      "Gemini rejected the request (HTTP 400): ".length + 500
    );
  });
});
