import { describe, expect, it } from "vitest";
import { formatElapsedTime, sampleQuestions } from "./session";

describe("formatElapsedTime", () => {
  it("formats elapsed time as minutes and seconds", () => {
    expect(formatElapsedTime(0)).toBe("00:00");
    expect(formatElapsedTime(125)).toBe("02:05");
  });
});

describe("sampleQuestions", () => {
  it("provides useful demo interview prompts", () => {
    expect(sampleQuestions.length).toBeGreaterThan(0);
    expect(sampleQuestions[0]).toContain("Tell me about yourself");
  });
});
