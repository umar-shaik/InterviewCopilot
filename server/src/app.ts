import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { ApiError } from "@google/genai";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MockAnswerProvider } from "./providers/mock.js";
import { GeminiProvider, geminiErrorMessage, geminiModelsErrorMessage } from "./providers/gemini.js";
import { ExternalModelProvider, externalProviderErrorMessage, ProviderApiError, type ExternalProviderId } from "./providers/external.js";
import type { GeminiLiveProvider, LiveAnswerRequest } from "./providers/types.js";

const externalProviderIds = ["openai", "anthropic", "xai", "perplexity"] as const;
const providerIds = ["gemini", ...externalProviderIds] as const;
const providerDisplayNames: Record<typeof providerIds[number], string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Claude",
  xai: "Grok",
  perplexity: "Perplexity"
};

const answerSchema = z.object({
  question: z.string().trim().min(1, "Question cannot be empty.").max(2000, "Question must be 2,000 characters or fewer."),
  jobTitle: z.string().max(200, "Job title must be 200 characters or fewer.").default(""),
  jobDescription: z.string().max(4000, "Job description must be 4,000 characters or fewer.").default(""),
  candidateContext: z.string().max(4000, "Candidate context must be 4,000 characters or fewer.").default(""),
  answerLength: z.enum(["concise", "balanced", "detailed"]).default("balanced"),
  provider: z.enum(providerIds).default("gemini"),
  model: z.string().trim().min(1, "Choose a model in Settings.").max(128).default("gemini-flash-lite-latest")
});

const liveAnswerSchema = z.object({
  jobTitle: z.string().max(200, "Job title must be 200 characters or fewer.").default(""),
  jobDescription: z.string().max(4000, "Job description must be 4,000 characters or fewer.").default(""),
  candidateContext: z.string().max(4000, "Candidate context must be 4,000 characters or fewer.").default(""),
  answerLength: z.enum(["concise", "balanced", "detailed"]).default("balanced"),
  provider: z.enum(providerIds).default("gemini"),
  model: z.string().trim().min(1, "Choose a model in Settings.").max(128).default("gemini-flash-lite-latest")
});

const acceptedAudioTypes = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"];

async function transcribeAndAnswer(
  provider: ExternalModelProvider,
  transcriptionProvider: ExternalModelProvider | undefined,
  audio: Uint8Array,
  mimeType: string,
  request: LiveAnswerRequest,
  signal: AbortSignal
) {
  if (!transcriptionProvider) {
    throw new Error("OpenAI is required for microphone transcription with this provider. Add an OpenAI API key in Settings.");
  }
  const transcript = await transcriptionProvider.transcribe(audio, mimeType, signal);
  const result = await provider.answerTranscript(transcript, request, request.model, signal);
  return { transcript, ...result };
}

export function createApp(options: {
  geminiProvider?: GeminiLiveProvider | null;
  auth?: { username: string; password: string };
} = {}) {
  const app = express();
  const allowedOrigin = process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173";
  const demoProvider = new MockAnswerProvider();
  const auth = options.auth ?? (process.env.APP_USERNAME && process.env.APP_PASSWORD
    ? { username: process.env.APP_USERNAME, password: process.env.APP_PASSWORD }
    : null);
  if (process.env.NODE_ENV === "production" && !auth) {
    throw new Error("APP_USERNAME and APP_PASSWORD are required in production.");
  }
  let geminiProvider = options.geminiProvider === undefined
    ? process.env.GEMINI_API_KEY
      ? new GeminiProvider(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest")
      : null
    : options.geminiProvider;
  const externalProviders = new Map<ExternalProviderId, ExternalModelProvider>();
  for (const id of externalProviderIds) {
    const key = process.env[`${id === "xai" ? "XAI" : id.toUpperCase()}_API_KEY`];
    if (key) externalProviders.set(id, new ExternalModelProvider(id, key));
  }
  const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (acceptedAudioTypes.some((type) => file.mimetype.toLowerCase().startsWith(type))) callback(null, true);
      else callback(new Error("Unsupported audio format. Use a browser recording in WebM, Ogg, MP4, WAV, or MP3 format."));
    }
  });

  app.use(cors({ origin: allowedOrigin }));
  app.use(express.json({ limit: "32kb" }));

  if (auth) {
    const expectedUsername = createHash("sha256").update(auth.username).digest();
    const expectedPassword = createHash("sha256").update(auth.password).digest();
    app.use((request, response, next) => {
      if (request.path === "/api/health") {
        next();
        return;
      }
      const authorization = request.get("authorization");
      const match = authorization?.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
      if (!match) {
        response.set("WWW-Authenticate", 'Basic realm="InterviewCopilot", charset="UTF-8"');
        response.status(401).send("Authentication required.");
        return;
      }
      const [username, ...passwordParts] = Buffer.from(match[1], "base64").toString("utf8").split(":");
      const suppliedUsername = createHash("sha256").update(username ?? "").digest();
      const suppliedPassword = createHash("sha256").update(passwordParts.join(":")).digest();
      if (!timingSafeEqual(expectedUsername, suppliedUsername) || !timingSafeEqual(expectedPassword, suppliedPassword)) {
        response.set("WWW-Authenticate", 'Basic realm="InterviewCopilot", charset="UTF-8"');
        response.status(401).send("Authentication required.");
        return;
      }
      next();
    });
  }

  app.get("/api/health", (_request, response) => {
    const configuredProviders = [
      ...(geminiProvider ? ["gemini"] : []),
      ...externalProviders.keys()
    ];
    response.json({
      status: "ok",
      mode: geminiProvider ? "demo-and-gemini" : configuredProviders.length ? "demo-and-ai" : "demo",
      geminiConfigured: Boolean(geminiProvider),
      configuredProviders
    });
  });

  app.post("/api/providers/:provider/key", (request, response) => {
    const provider = z.enum(providerIds).safeParse(request.params.provider);
    if (!provider.success) {
      response.status(400).json({ error: "Choose a supported AI provider." });
      return;
    }
    const parsed = z.object({
      apiKey: z.string().trim().min(1, "Enter an API key.").max(512, "API key is too long.")
    }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid API key.",
        details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }))
      });
      return;
    }
    if (provider.data === "gemini") {
      geminiProvider = new GeminiProvider(parsed.data.apiKey, geminiProvider?.defaultModel);
    } else {
      externalProviders.set(provider.data, new ExternalModelProvider(provider.data, parsed.data.apiKey));
    }
    response.json({ configured: true });
  });

  app.post("/api/gemini-key", (request, response) => {
    const parsed = z.object({
      apiKey: z.string().trim().min(1, "Enter a Gemini API key.").max(512, "Gemini API key is too long.")
    }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid Gemini API key." });
      return;
    }
    geminiProvider = new GeminiProvider(parsed.data.apiKey, geminiProvider?.defaultModel);
    response.json({ configured: true });
  });

  app.get("/api/providers/:provider/models", async (request, response, next) => {
    const parsedProvider = z.enum(providerIds).safeParse(request.params.provider);
    if (!parsedProvider.success) {
      response.status(400).json({ error: "Choose a supported AI provider." });
      return;
    }
    if (parsedProvider.data === "gemini" && !geminiProvider || parsedProvider.data !== "gemini" && !externalProviders.has(parsedProvider.data)) {
      response.status(503).json({ error: `No ${parsedProvider.data} API key is configured. Add the key in Settings or configure it in the server environment.` });
      return;
    }
    try {
      const models = parsedProvider.data === "gemini"
        ? await geminiProvider!.listAvailableModels()
        : await externalProviders.get(parsedProvider.data)!.listAvailableModels();
      response.json({ models });
    } catch (error) {
      if (error instanceof ApiError) {
        response.status(502).json({ error: geminiModelsErrorMessage(error) });
        return;
      }
      if (error instanceof ProviderApiError) {
        response.status(502).json({ error: externalProviderErrorMessage(error) });
        return;
      }
      next(error);
    }
  });

  app.post("/api/providers/:provider/status", async (request, response, next) => {
    const providerId = z.enum(providerIds).safeParse(request.params.provider);
    const parsed = z.object({ model: z.string().trim().min(1).max(128) }).safeParse(request.body);
    if (!providerId.success || !parsed.success) {
      response.status(400).json({ error: "Choose a supported AI provider and model." });
      return;
    }
    if (providerId.data === "gemini" && !geminiProvider || providerId.data !== "gemini" && !externalProviders.has(providerId.data)) {
      response.status(503).json({ authenticated: false, error: `No ${providerId.data} API key is configured.` });
      return;
    }
    try {
      if (providerId.data === "gemini") {
        const geminiResult = await geminiProvider!.answer(
          "Tell me about a challenging project you worked on and how you handled it.",
          { jobTitle: "", jobDescription: "", candidateContext: "", answerLength: "concise", model: parsed.data.model },
        );
        if (!geminiResult.answer.trim()) throw new Error("Gemini returned an empty answer.");
        response.json({ authenticated: true, message: "Gemini generated a sample answer successfully.", sampleAnswer: geminiResult.answer });
      } else {
        const result = await externalProviders.get(providerId.data)!.answer(
          "Tell me about a challenging project you worked on and how you handled it.",
          { jobTitle: "", jobDescription: "", candidateContext: "", answerLength: "concise" },
          parsed.data.model
        );
        response.json({ authenticated: true, message: `${providerId.data} generated a sample answer successfully.`, sampleAnswer: result });
      }
    } catch (error) {
      if (error instanceof ApiError) {
        response.status(502).json({ authenticated: false, error: geminiErrorMessage(error) });
        return;
      }
      if (error instanceof ProviderApiError) {
        response.status(502).json({ authenticated: false, error: externalProviderErrorMessage(error) });
        return;
      }
      next(error);
    }
  });

  app.get("/api/gemini-models", async (_request, response, next) => {
    if (!geminiProvider) {
      response.status(503).json({
        error: "No Gemini API key is loaded. Add a key in Settings or configure GEMINI_API_KEY in the root .env file."
      });
      return;
    }
    try {
      const models = await geminiProvider.listAvailableModels();
      response.json({ models });
    } catch (error) {
      if (error instanceof ApiError) {
        response.status(502).json({ error: geminiModelsErrorMessage(error) });
        return;
      }
      next(error);
    }
  });

  app.post("/api/gemini-status", async (request, response, next) => {
    if (!geminiProvider) {
      response.status(503).json({
        configured: false,
        authenticated: false,
        error: "No Gemini API key is loaded. Add a key in Settings or configure GEMINI_API_KEY in the root .env file."
      });
      return;
    }
    const parsed = z.object({
      model: z.string().trim().min(1).max(128).regex(/^gemini-[a-z0-9.-]+$/i).optional()
    }).safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid Gemini model.",
        details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }))
      });
      return;
    }
    try {
      const result = await geminiProvider.answer(
        "Tell me about a challenging project you worked on and how you handled it.",
        {
          jobTitle: "",
          jobDescription: "",
          candidateContext: "",
          answerLength: "concise",
          model: parsed.data.model ?? geminiProvider.defaultModel
        }
      );
      if (!result.isInterviewQuestion || !result.answer.trim()) {
        response.status(502).json({
          configured: true,
          authenticated: false,
          error: "Gemini connected but could not generate a sample interview answer. Try again or choose another model."
        });
        return;
      }
      response.json({
        configured: true,
        authenticated: true,
        message: "Gemini generated a sample answer successfully. This test used one AI request and may count toward your Google AI Studio quota.",
        sampleQuestion: result.question,
        sampleAnswer: result.answer
      });
    } catch (error) {
      if (error instanceof ApiError) {
        response.status(502).json({ configured: true, authenticated: false, error: geminiErrorMessage(error) });
        return;
      }
      next(error);
    }
  });

  app.post("/api/answer", async (request, response, next) => {
    const parsed = answerSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid request.",
        details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }))
      });
      return;
    }
    try {
      if (parsed.data.provider === "gemini") {
        if (!geminiProvider) {
          response.status(503).json({ error: "Gemini is not configured. Add a key in Settings or configure GEMINI_API_KEY in the root .env file." });
          return;
        }
        if (!/^gemini-[a-z0-9.-]+$/i.test(parsed.data.model)) {
          response.status(400).json({ error: "Choose a valid Gemini model in Settings." });
          return;
        }
        const result = await geminiProvider.answer(parsed.data.question, parsed.data);
        if (!result.isInterviewQuestion || !result.answer.trim()) {
          response.status(422).json({ error: "The text did not look like an interview question. Try rephrasing it." });
          return;
        }
        response.json({
          simulated: false,
          provider: "gemini",
          question: result.question,
          answers: [{ id: "gemini-answer", title: "Gemini AI answer", text: result.answer }]
        });
        return;
      }
      const provider = externalProviders.get(parsed.data.provider);
      if (!provider) {
        response.status(503).json({ error: `No ${parsed.data.provider} API key is configured. Add the key in Settings.` });
        return;
      }
      const result = await provider.answer(parsed.data.question, parsed.data, parsed.data.model);
      response.json({
        simulated: false,
        provider: parsed.data.provider,
        question: parsed.data.question,
        answers: [{ id: `${parsed.data.provider}-answer`, title: `${parsed.data.provider} AI answer`, text: result }]
      });
    } catch (error) {
      if (error instanceof ApiError) {
        response.status(502).json({ error: geminiErrorMessage(error) });
        return;
      }
      if (error instanceof ProviderApiError) {
        response.status(502).json({ error: externalProviderErrorMessage(error) });
        return;
      }
      next(error);
    }
  });

  app.post(
    "/api/live-answer",
    (request, response, next) => {
      if (!request.is("multipart/form-data") && !geminiProvider) {
        response.status(503).json({ error: "Gemini is not configured. Add a key in Settings or configure GEMINI_API_KEY in the root .env file." });
        return;
      }
      next();
    },
    audioUpload.single("audio"),
    async (request, response, next) => {
      if (!request.file) {
        response.status(400).json({ error: "An audio segment is required." });
        return;
      }
      const parsed = liveAnswerSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Invalid request.",
          details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }))
        });
        return;
      }
      if (parsed.data.provider === "gemini" && !geminiProvider) {
        response.status(503).json({ error: "Gemini is not configured. Add a key in Settings or configure GEMINI_API_KEY in the root .env file." });
        return;
      }
      if (parsed.data.provider !== "gemini" && !externalProviders.has(parsed.data.provider)) {
        response.status(503).json({ error: `No ${parsed.data.provider} API key is configured. Add the key in Settings.` });
        return;
      }
      if (parsed.data.provider !== "gemini" && !externalProviders.has("openai")) {
        response.status(503).json({ error: "OpenAI is required for microphone transcription with this provider. Add an OpenAI API key in Settings." });
        return;
      }
      const cancellation = new AbortController();
      const abortIfDisconnected = () => {
        if (request.aborted || (response.destroyed && !response.writableEnded)) cancellation.abort();
      };
      request.once("aborted", abortIfDisconnected);
      response.once("close", abortIfDisconnected);
      try {
        const result = parsed.data.provider === "gemini"
          ? await geminiProvider!.processAudio(request.file.buffer, request.file.mimetype, parsed.data, cancellation.signal)
          : await transcribeAndAnswer(
            externalProviders.get(parsed.data.provider)!,
            externalProviders.get("openai"),
            request.file.buffer,
            request.file.mimetype,
            parsed.data,
            cancellation.signal
          );
        if (!cancellation.signal.aborted) {
          response.json({
            simulated: false,
            provider: parsed.data.provider,
            transcript: result.transcript,
            isInterviewQuestion: result.isInterviewQuestion,
            question: result.question,
            answers: result.isInterviewQuestion && result.answer.trim()
              ? [{ id: `${parsed.data.provider}-${Date.now()}`, title: `${providerDisplayNames[parsed.data.provider]} AI answer`, text: result.answer }]
              : []
          });
        }
      } catch (error) {
        if (cancellation.signal.aborted) return;
        if (error instanceof ApiError) {
          response.status(502).json({ error: geminiErrorMessage(error) });
          return;
        }
        if (error instanceof ProviderApiError) {
          response.status(502).json({ error: externalProviderErrorMessage(error) });
          return;
        }
        next(error);
      } finally {
        request.removeListener("aborted", abortIfDisconnected);
        response.removeListener("close", abortIfDisconnected);
      }
    }
  );

  app.post("/api/demo-answer", async (request, response, next) => {
    const parsed = answerSchema.extend({
      model: z.enum(["mock-coach", "mock-storyteller", "mock-analyst"]).default("mock-coach")
    }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid request.",
        details: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }))
      });
      return;
    }
    try {
      const answers = await demoProvider.generate(parsed.data);
      response.json({ simulated: true, provider: demoProvider.id, answers });
    } catch (error) {
      next(error);
    }
  });

  if (process.env.NODE_ENV === "production") {
    const clientDist = fileURLToPath(new URL("../../client/dist/", import.meta.url));
    app.use(express.static(clientDist));
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(fileURLToPath(new URL("../../client/dist/index.html", import.meta.url)), (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: "Endpoint not found." });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (response.destroyed || response.headersSent) return;
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      response.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "Audio segment is too large. Use shorter speech segments." : "The audio upload was invalid."
      });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({ error: "Request body must contain valid JSON." });
      return;
    }
    if (error instanceof ApiError) {
      response.status(502).json({ error: geminiErrorMessage(error) });
      return;
    }
    if (error instanceof Error && error.message.startsWith("Unsupported audio format.")) {
      response.status(415).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError) {
      response.status(502).json({ error: "Gemini returned an answer in an unexpected format. Try again." });
      return;
    }
    response.status(500).json({ error: "The local API encountered an unexpected error." });
  };
  app.use(errorHandler);

  return app;
}
