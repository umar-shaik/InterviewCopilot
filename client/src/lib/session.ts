export function formatElapsedTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export const sampleQuestions = [
  "Tell me about yourself and your experience.",
  "Describe a challenging project you worked on.",
  "How do you handle competing priorities?",
  "Why are you interested in this role?"
];
