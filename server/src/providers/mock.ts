import type { AnswerProvider, AnswerRequest, SuggestedAnswer } from "./types.js";

type Story = { focus: string; action: string; result: string };

const stories: Story[] = [
  {
    focus: "I start by getting clear on the outcome and the people who need to be involved.",
    action: "I break the work into manageable steps, communicate early when priorities shift, and use feedback to adjust.",
    result: "That approach helps me deliver thoughtful work while keeping the team aligned."
  },
  {
    focus: "One example that comes to mind is a project where the team needed to move quickly without losing sight of quality.",
    action: "I clarified the most important user need, partnered with the people closest to the problem, and tested a small solution before scaling it.",
    result: "We made progress with less rework, and I took away a repeatable way to handle ambiguity."
  },
  {
    focus: "I try to approach challenges with curiosity rather than jumping to the first solution.",
    action: "I gather the relevant context, make the trade-offs visible, and take ownership of the next concrete step.",
    result: "It has helped me build trust and turn uncertain situations into measurable progress."
  }
];

function getOpening(question: string, jobTitle: string): string {
  const normalized = question.toLowerCase();
  if (normalized.includes("tell me about yourself")) {
    return jobTitle
      ? `I'm a results-oriented professional whose experience has prepared me well for a ${jobTitle} role.`
      : "I'm a results-oriented professional who enjoys solving meaningful problems and working collaboratively.";
  }
  if (normalized.includes("challenge") || normalized.includes("difficult")) {
    return "A challenging situation I worked through taught me how much clear communication and a structured approach matter.";
  }
  if (normalized.includes("why") && (normalized.includes("role") || normalized.includes("company"))) {
    return jobTitle
      ? `I'm interested in this ${jobTitle} opportunity because it brings together work I'm good at and problems I care about solving.`
      : "I'm interested in this opportunity because it brings together work I'm good at and problems I care about solving.";
  }
  if (normalized.includes("priority") || normalized.includes("competing")) {
    return "When priorities compete, I first make sure I understand the impact and urgency of each commitment.";
  }
  return "I would approach this by combining clear communication, thoughtful prioritization, and ownership of the outcome.";
}

function contextSentence(context: string): string {
  const trimmed = context.trim();
  if (!trimmed) return "";
  const excerpt = trimmed.length > 180 ? `${trimmed.slice(0, 177).trimEnd()}...` : trimmed;
  return ` In my own experience, ${excerpt.replace(/[.!?]+$/, "")}.`;
}

export class MockAnswerProvider implements AnswerProvider {
  readonly id = "demo";
  readonly models = ["mock-coach", "mock-storyteller", "mock-analyst"] as const;

  async generate(request: AnswerRequest): Promise<SuggestedAnswer[]> {
    const modelOffset = Math.max(0, this.models.indexOf(request.model as typeof this.models[number]));
    const selectedStories = [0, 1, 2].map((index) => stories[(index + modelOffset) % stories.length]);
    const opening = getOpening(request.question, request.jobTitle);
    const context = contextSentence(request.candidateContext);

    return selectedStories.map((story, index) => {
      const sections = request.answerLength === "concise"
        ? [opening, story.result]
        : request.answerLength === "detailed"
          ? [
              opening,
              story.focus,
              story.action,
              "I also make the goal and trade-offs explicit, then check in with the people affected as the work moves forward.",
              context.trim(),
              story.result
            ]
          : [opening, story.focus, story.action, context.trim(), story.result];
      const text = sections.filter(Boolean).join(" ");
      return {
        id: `demo-${index + 1}`,
        title: ["Clear and direct", "Example-led", "Reflective"][index],
        text
      };
    });
  }
}
