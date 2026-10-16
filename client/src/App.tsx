import { useEffect, useRef, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, AudioLines, BriefcaseBusiness,
  Check, ChevronDown, CircleHelp, Clock3, Copy, FileText, Headphones,
  LayoutDashboard, MessageSquareText, Mic, MoreHorizontal, Play, Plus,
  Search, Settings2, ShieldCheck, Sparkles, Square, Target, WandSparkles
} from "lucide-react";
import { formatElapsedTime, sampleQuestions } from "./lib/session";
import { convertAudioToWav } from "./lib/audio";
import { useLiveCapture } from "./hooks/useLiveCapture";

type AnswerLength = "concise" | "balanced" | "detailed";
type ProviderChoice = "demo" | "gemini" | "openai" | "anthropic" | "xai" | "perplexity";
type AiProvider = Exclude<ProviderChoice, "demo">;
type NavItem = "Dashboard" | "Live Session" | "Practice" | "Resume" | "Settings";
type Answer = { id: string; title: string; text: string };
type TranscriptLine = { speaker: string; text: string; time: string; self?: boolean };
type ApiResult = {
  answers?: Answer[];
  error?: string;
  simulated?: boolean;
  transcript?: string;
  isInterviewQuestion?: boolean;
  question?: string;
};

const navItems: { label: NavItem; icon: typeof LayoutDashboard }[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Live Session", icon: AudioLines },
  { label: "Practice", icon: Target },
  { label: "Resume", icon: FileText },
  { label: "Settings", icon: Settings2 }
];

const initialTranscript: TranscriptLine[] = [
  { speaker: "Interviewer", text: "Could you tell me about a project you're particularly proud of?", time: "00:18" },
  { speaker: "You", text: "I recently led a redesign of our onboarding experience...", time: "00:32", self: true },
  { speaker: "Interviewer", text: "What was the biggest challenge you had to work through?", time: "00:46" }
];

const providerDetails: Record<AiProvider, { name: string; keyName: string; placeholder: string; defaultModel: string }> = {
  gemini: { name: "Google Gemini", keyName: "Google AI Studio", placeholder: "Paste your Gemini API key", defaultModel: "gemini-flash-lite-latest" },
  openai: { name: "OpenAI (ChatGPT)", keyName: "OpenAI", placeholder: "Paste your OpenAI API key", defaultModel: "gpt-4o-mini" },
  anthropic: { name: "Anthropic (Claude)", keyName: "Anthropic Console", placeholder: "Paste your Anthropic API key", defaultModel: "claude-3-5-haiku-latest" },
  xai: { name: "xAI (Grok)", keyName: "xAI", placeholder: "Paste your xAI API key", defaultModel: "grok-3-mini" },
  perplexity: { name: "Perplexity", keyName: "Perplexity", placeholder: "Paste your Perplexity API key", defaultModel: "sonar" }
};
const providerKeyUrls: Record<AiProvider, string> = {
  gemini: "https://aistudio.google.com/api-keys",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  xai: "https://console.x.ai/",
  perplexity: "https://www.perplexity.ai/settings/api"
};

function isProviderChoice(value: unknown): value is ProviderChoice {
  return value === "demo" || value === "gemini" || value === "openai" ||
    value === "anthropic" || value === "xai" || value === "perplexity";
}

function providerName(provider: ProviderChoice): string {
  return provider === "demo" ? "Local demo" : providerDetails[provider].name;
}

function loadSettings() {
  try {
    const saved = localStorage.getItem("interview-copilot-settings");
    return saved ? JSON.parse(saved) as { model?: string; answerLength?: AnswerLength; provider?: unknown; answerModel?: string } : {};
  } catch {
    return {};
  }
}

export default function App() {
  const saved = loadSettings();
  const [activeNav, setActiveNav] = useState<NavItem>("Dashboard");
  const [selectedProvider, setSelectedProvider] = useState<ProviderChoice>(
    isProviderChoice(saved.provider) ? saved.provider : "gemini"
  );
  const [answerLength, setAnswerLength] = useState<AnswerLength>(saved.answerLength ?? "balanced");
  const [model, setModel] = useState(saved.model ?? "mock-coach");
  const [answerModel, setAnswerModel] = useState(saved.answerModel ?? providerDetails[isProviderChoice(saved.provider) && saved.provider !== "demo" ? saved.provider : "gemini"].defaultModel);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelLoadMessage, setModelLoadMessage] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [candidateContext, setCandidateContext] = useState("");
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [answersSimulated, setAnswersSimulated] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [configuredProviders, setConfiguredProviders] = useState<AiProvider[]>([]);
  const [connectionTest, setConnectionTest] = useState<{ state: "idle" | "testing" | "success" | "failure"; message: string }>({ state: "idle", message: "" });
  const [liveStatus, setLiveStatus] = useState("");
  const providerConfigured = selectedProvider !== "demo" && configuredProviders.includes(selectedProvider);
  const modelLoadSequenceRef = useRef(0);
  const liveSessionRef = useRef(false);
  const liveRequestsRef = useRef(new Set<AbortController>());

  async function handleLiveSegment(segment: Blob) {
    if (!liveSessionRef.current) return;
    const controller = new AbortController();
    liveRequestsRef.current.add(controller);
    setLiveStatus("Transcribing speech...");
    setError("");
    const form = new FormData();
    try {
      const wavAudio = await convertAudioToWav(segment);
      if (!liveSessionRef.current) return;
      form.append("audio", wavAudio, "interview-segment.wav");
    } catch {
      setError("The browser couldn't convert the microphone segment to WAV audio. Try a current version of Edge or Chrome.");
      setLiveStatus("Audio conversion failed");
      return;
    }
    form.append("jobTitle", jobTitle);
    form.append("jobDescription", jobDescription);
    form.append("candidateContext", candidateContext);
    form.append("answerLength", answerLength);
    form.append("model", answerModel);
    form.append("provider", selectedProvider === "demo" ? "gemini" : selectedProvider);
    try {
      const response = await fetch("/api/live-answer", { method: "POST", body: form, signal: controller.signal });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error ?? "The selected AI provider could not process this audio segment.");
      if (!liveSessionRef.current) return;
      if (result.transcript) {
        setTranscript((previous) => [
          ...previous,
          { speaker: "Captured audio", text: result.transcript!, time: formatElapsedTime(elapsed) }
        ].slice(-30));
      }
      if (result.isInterviewQuestion && result.answers?.length) {
        const detectedQuestion = result.question?.trim() || result.transcript?.trim() || "";
        setQuestion(detectedQuestion);
        setAnswers(result.answers);
        setAnswersSimulated(false);
        setHistory((previous) => [detectedQuestion, ...previous.filter((item) => item !== detectedQuestion)].slice(0, 8));
        setLiveStatus("Answer ready");
      } else {
        setLiveStatus(result.transcript ? "Listening for the next question..." : "Listening...");
      }
    } catch (issue) {
      if (issue instanceof DOMException && issue.name === "AbortError") return;
      if (issue instanceof Error && issue.name === "AbortError") return;
      if (!liveSessionRef.current) return;
      const message = issue instanceof Error ? issue.message : "Couldn't process this audio segment.";
      setError(message);
      setLiveStatus("Audio processing failed");
    } finally {
      liveRequestsRef.current.delete(controller);
    }
  }

  function handleCaptureError(message: string) {
    setError(message);
    setLiveStatus("Microphone error");
  }

  const { isRecording, startCapture, stopCapture } = useLiveCapture(handleLiveSegment, handleCaptureError);

  async function refreshApiStatus() {
    try {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error("The local API is not responding.");
      const health = await response.json() as { configuredProviders?: AiProvider[]; geminiConfigured?: boolean };
      const configured = health.configuredProviders ?? (health.geminiConfigured ? ["gemini"] : []);
      setConfiguredProviders(configured);
      if (selectedProvider !== "demo" && configured.includes(selectedProvider)) void loadProviderModels(selectedProvider);
    } catch {
      setConfiguredProviders([]);
    }
  }

  async function loadProviderModels(provider: AiProvider = selectedProvider === "demo" ? "gemini" : selectedProvider) {
    const requestId = ++modelLoadSequenceRef.current;
    setLoadingModels(true);
    setModelLoadMessage("");
    try {
      const response = await fetch(`/api/providers/${provider}/models`);
      const result = await response.json() as { models?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? `Couldn't get the models for ${providerDetails[provider].name}.`);
      const models = result.models ?? [];
      if (requestId !== modelLoadSequenceRef.current) return;
      setAvailableModels(models);
      if (models.length === 0) {
        setModelLoadMessage(`${providerDetails[provider].name} did not list any available models for this key.`);
        return;
      }
      setAnswerModel((current) => models.includes(current) ? current : models[0]);
      setModelLoadMessage(`Found ${models.length} model${models.length === 1 ? "" : "s"} available from ${providerDetails[provider].name}.`);
      setConnectionTest({ state: "idle", message: "" });
    } catch (issue) {
      if (requestId !== modelLoadSequenceRef.current) return;
      const message = issue instanceof Error ? issue.message : `Couldn't get models for ${providerDetails[provider].name}.`;
      setAvailableModels([]);
      setModelLoadMessage(message);
    } finally {
      if (requestId === modelLoadSequenceRef.current) setLoadingModels(false);
    }
  }

  async function saveProviderApiKey() {
    if (selectedProvider === "demo") return;
    const provider = selectedProvider;
    setSavingApiKey(true);
    setModelLoadMessage("");
    try {
      const response = await fetch(`/api/providers/${provider}/key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Couldn't save the ${providerDetails[provider].name} API key.`);
      setApiKey("");
      setConfiguredProviders((current) => current.includes(provider) ? current : [...current, provider]);
      setAvailableModels([]);
      setConnectionTest({ state: "idle", message: "" });
      await loadProviderModels(provider);
    } catch (issue) {
      setModelLoadMessage(issue instanceof Error ? issue.message : `Couldn't save the ${providerDetails[provider].name} API key.`);
    } finally {
      setSavingApiKey(false);
    }
  }

  async function testProviderConnection() {
    if (selectedProvider === "demo") return;
    const provider = selectedProvider;
    setConnectionTest({ state: "testing", message: `Sending a sample question to ${providerDetails[provider].name}...` });
    try {
      const response = await fetch(`/api/providers/${provider}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: answerModel })
      });
      const result = await response.json() as { authenticated?: boolean; error?: string; message?: string; sampleQuestion?: string; sampleAnswer?: string };
      if (!response.ok || !result.authenticated) {
        setConnectionTest({ state: "failure", message: result.error ?? `${providerDetails[provider].name} connection test failed.` });
        return;
      }
      setConnectionTest({
        state: "success",
        message: `${result.message ?? `${providerDetails[provider].name} generated a sample answer.`}${result.sampleAnswer ? ` Sample answer: “${result.sampleAnswer}”` : ""}`
      });
    } catch {
      setConnectionTest({ state: "failure", message: "Could not reach the local API. Make sure both apps are running." });
    }
  }

  useEffect(() => {
    localStorage.setItem("interview-copilot-settings", JSON.stringify({ answerLength, model, provider: selectedProvider, answerModel }));
  }, [answerLength, model, selectedProvider, answerModel]);

  useEffect(() => {
    void refreshApiStatus();
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  async function startSession() {
    if (starting || isActive) return;
    setStarting(true);
    setError("");
    try {
      if (selectedProvider !== "demo") {
        if (!providerConfigured) {
          setError(`${providerDetails[selectedProvider].name} is not configured. Add its API key in Settings, then load available models.`);
          return;
        }
        if (selectedProvider !== "gemini" && !configuredProviders.includes("openai")) {
          setError("OpenAI is required to transcribe microphone audio for this provider. Add an OpenAI API key in Settings.");
          return;
        }
        await startCapture();
        liveSessionRef.current = true;
        setLiveStatus("Listening for interviewer questions...");
        setTranscript([]);
      }
      if (selectedProvider === "demo") {
        setTranscript(initialTranscript);
        setLiveStatus("");
      }
      setIsActive(true);
      setElapsed(0);
      setActiveNav("Live Session");
    } catch (issue) {
      setError(issue instanceof Error && issue.name === "NotAllowedError"
        ? "Microphone access was blocked. Allow microphone access in your browser and try again."
        : issue instanceof Error ? issue.message : "Could not start microphone capture.");
    } finally {
      setStarting(false);
    }
  }

  function stopSession() {
    liveSessionRef.current = false;
    liveRequestsRef.current.forEach((controller) => controller.abort());
    liveRequestsRef.current.clear();
    stopCapture();
    setIsActive(false);
    setLiveStatus("");
  }

  async function generateAnswer(selectedQuestion = question) {
    const cleanQuestion = selectedQuestion.trim();
    if (!cleanQuestion) {
      setError("Enter or select an interview question first.");
      return;
    }
    setError("");
    setGenerating(true);
    setQuestion(cleanQuestion);
    try {
      const isDemo = selectedProvider === "demo";
      const response = await fetch(isDemo ? "/api/demo-answer" : "/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: cleanQuestion,
          jobTitle,
          jobDescription,
          candidateContext,
          answerLength,
          provider: isDemo ? "gemini" : selectedProvider,
          model: isDemo ? model : answerModel
        })
      });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error ?? "Couldn't generate a suggestion. Please try again.");
      if (!result.answers?.length) throw new Error(isDemo ? "The demo provider returned no answer suggestions." : `${providerName(selectedProvider)} returned no answer suggestions.`);
      setAnswers(result.answers);
      setAnswersSimulated(Boolean(result.simulated));
      setHistory((previous) => [cleanQuestion, ...previous.filter((item) => item !== cleanQuestion)].slice(0, 8));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Couldn't reach the local API. Check that the server is running.");
      setAnswers([]);
    } finally {
      setGenerating(false);
    }
  }

  async function copyAnswer(answer: Answer) {
    try {
      await navigator.clipboard.writeText(answer.text);
      setCopied(answer.id);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setError("Clipboard access was blocked. Select and copy the answer text instead.");
    }
  }

  const isSettings = activeNav === "Settings";
  const isResume = activeNav === "Resume";
  const isPractice = activeNav === "Practice";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setActiveNav("Dashboard"); }}>
          <span className="brand-mark"><AudioLines size={20} strokeWidth={2.3} /></span>
          <span>interview<span className="brand-light">copilot</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => (
            <button className={`nav-item ${activeNav === label ? "selected" : ""}`} key={label} onClick={() => setActiveNav(label)}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {label === "Live Session" && isActive && <span className="nav-live-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <div className="upgrade-icon"><Sparkles size={16} /></div>
            <strong>Your practice space</strong>
            <p>Private, local-first interview prep. Your notes stay on this device.</p>
            <button onClick={() => setActiveNav("Settings")}>Explore settings <ArrowUpRight size={14} /></button>
          </div>
          <button className="profile-button" onClick={() => setActiveNav("Settings")}>
            <span className="avatar">JD</span>
            <span className="profile-text"><strong>Jordan Davis</strong><small>Free workspace</small></span>
            <MoreHorizontal size={18} className="muted-icon" />
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-divider">/</span><strong>{activeNav}</strong></div>
          <div className="topbar-right">
            <div className="private-badge"><ShieldCheck size={14} /> {isRecording ? `Mic processed by ${selectedProvider === "gemini" ? "Gemini" : `OpenAI + ${providerName(selectedProvider)}`}` : `${providerName(selectedProvider)}${selectedProvider === "demo" ? "" : " · no capture"}`}</div>
            {isRecording && <button className="stop-button topbar-stop" onClick={stopSession}><Square size={12} fill="currentColor" /> Stop recording</button>}
            <button className="icon-button" aria-label="Help"><CircleHelp size={18} /></button>
            <span className="top-avatar">JD</span>
          </div>
        </header>

        <div className="page-content">
          {isSettings ? (
            <section className="settings-page">
              <div className="page-heading">
                <div><div className="eyebrow">PREFERENCES</div><h1>Settings</h1><p>Choose how your interview workspace behaves.</p></div>
              </div>
              <div className="settings-card">
                <div className="settings-row">
                  <div><strong>AI provider</strong><p>Choose a local demo or connect a hosted AI model provider.</p></div>
                  <select value={selectedProvider} aria-label="AI provider" disabled={isActive || savingApiKey} onChange={(event) => {
                    const nextProvider = event.target.value as ProviderChoice;
                    modelLoadSequenceRef.current += 1;
                    setSelectedProvider(nextProvider);
                    setAvailableModels([]);
                    setApiKey("");
                    setLoadingModels(false);
                    setAnswerModel(nextProvider === "demo" ? "mock-coach" : providerDetails[nextProvider].defaultModel);
                    setModelLoadMessage("");
                    setConnectionTest({ state: "idle", message: "" });
                    if (nextProvider !== "demo" && configuredProviders.includes(nextProvider)) void loadProviderModels(nextProvider);
                  }}>
                    <option value="demo">Local demo · simulated</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI · ChatGPT</option>
                    <option value="anthropic">Anthropic · Claude</option>
                    <option value="xai">xAI · Grok</option>
                    <option value="perplexity">Perplexity</option>
                  </select>
                </div>
                <div className="settings-row">
                  <div><strong>{selectedProvider === "demo" ? "Demo response style" : `${providerDetails[selectedProvider].name} model`}</strong><p>{selectedProvider === "demo" ? "Local simulated response styles do not call an AI service." : selectedProvider === "gemini" ? "Gemini handles microphone transcription and answer generation." : "Models available to this provider key are loaded from its API."}</p></div>
                  {selectedProvider !== "demo"
                    ? <select value={answerModel} onChange={(event) => { setAnswerModel(event.target.value); setConnectionTest({ state: "idle", message: "" }); }} aria-label={`${providerDetails[selectedProvider].name} model`}>{!availableModels.includes(answerModel) && <option value={answerModel}>{formatModelName(answerModel)}</option>}{availableModels.map((availableModel) => <option key={availableModel} value={availableModel}>{formatModelName(availableModel)}</option>)}</select>
                    : <select value={model} onChange={(event) => setModel(event.target.value)} aria-label="Demo model"><option value="mock-coach">Interview Coach</option><option value="mock-storyteller">STAR Story Builder</option><option value="mock-analyst">Concise Analyst</option></select>}
                </div>
                {selectedProvider !== "demo" && <div className="settings-row">
                  <div><strong>{providerDetails[selectedProvider].name} API key</strong><p>Get a key from <a href={providerKeyUrls[selectedProvider]} target="_blank" rel="noreferrer">{providerDetails[selectedProvider].keyName}</a>. The local API holds it only until restart.</p></div>
                  <div className="key-entry">
                    <input type="password" aria-label={`${providerDetails[selectedProvider].name} API key`} autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={providerDetails[selectedProvider].placeholder} />
                    <button className="secondary-button" disabled={!apiKey.trim() || savingApiKey} onClick={() => void saveProviderApiKey()}>{savingApiKey ? "Saving..." : "Save key"}</button>
                  </div>
                </div>}
                <div className="settings-row">
                  <div><strong>{selectedProvider === "demo" ? "AI connection" : `${providerDetails[selectedProvider].name} connection`}</strong><p>{selectedProvider === "demo" ? "Demo responses are generated locally." : providerConfigured ? "An API key is configured on the local server." : "No key detected. Add one above or configure it in the server environment."}</p></div>
                  <span className="status-pill"><span className={`status-dot ${providerConfigured ? "active" : "idle"}`} />{selectedProvider === "demo" ? "Local demo" : providerConfigured ? "Key configured" : "Not configured"}</span>
                </div>
                <div className="settings-row">
                  <div><strong>Microphone permission</strong><p>Audio is captured only when you start a live session. Gemini handles it directly; other providers use OpenAI transcription. System audio is never captured.</p></div>
                  <span className="status-pill"><span className={`status-dot ${isRecording ? "active" : "idle"}`} />{isRecording ? "Recording" : "Not requested"}</span>
                </div>
                <div className="settings-footnote"><ShieldCheck size={16} /> Questions, context, and (in live mode) audio are sent to the selected provider. Non-Gemini live sessions send microphone audio to OpenAI for transcription first. Review each provider's current data terms and quotas.</div>
                {selectedProvider !== "demo" && <div className="connection-actions"><button className="secondary-button" onClick={() => void refreshApiStatus()}>Refresh key status</button><button className="secondary-button" disabled={!providerConfigured || loadingModels} onClick={() => void loadProviderModels()}>{loadingModels ? "Loading models..." : "Load available models"}</button><button className="primary-button" disabled={connectionTest.state === "testing" || !providerConfigured || !availableModels.includes(answerModel)} onClick={() => void testProviderConnection()}>{connectionTest.state === "testing" ? "Generating sample..." : "Test connection"}</button></div>}
                {modelLoadMessage && <p className={`connection-message ${availableModels.length ? "success" : "failure"}`} role={availableModels.length ? "status" : "alert"}>{modelLoadMessage}</p>}
                {connectionTest.message && <p className={`connection-message ${connectionTest.state}`} role={connectionTest.state === "failure" ? "alert" : "status"}>{connectionTest.message}</p>}
              </div>
              {selectedProvider !== "demo" && !providerConfigured && <div className="settings-card setup-card"><strong>Enable {providerDetails[selectedProvider].name}</strong><ol><li>Create an API key in <a href={providerKeyUrls[selectedProvider]} target="_blank" rel="noreferrer">{providerDetails[selectedProvider].keyName}</a>.</li><li>Paste the key in the field above. It is kept in server memory and must be re-entered after restarting the API.</li></ol>{selectedProvider !== "gemini" && <p>Live microphone sessions additionally require an OpenAI API key for transcription.</p>}</div>}
              <div className="settings-card architecture-card">
                <div className="card-heading"><div className="heading-icon"><WandSparkles size={17} /></div><div><strong>Provider architecture</strong><p>API keys stay in the backend. Live transcription uses Gemini or OpenAI, depending on the selected answer provider.</p></div></div>
                <div className="provider-chips"><span className={`provider-chip ${selectedProvider === "demo" ? "active" : ""}`}>Local demo</span>{(Object.keys(providerDetails) as AiProvider[]).map((provider) => <span key={provider} className={`provider-chip ${selectedProvider === provider ? "active" : ""}`}>{providerDetails[provider].name}</span>)}</div>
              </div>
            </section>
          ) : isResume ? (
            <section className="settings-page">
              <div className="page-heading"><div><div className="eyebrow">YOUR MATERIALS</div><h1>Resume context</h1><p>Add experience notes to tailor your practice suggestions.</p></div></div>
              <div className="settings-card">
                <label className="field-label" htmlFor="resume-context">Candidate experience &amp; context</label>
                <textarea id="resume-context" className="large-textarea" value={candidateContext} onChange={(event) => setCandidateContext(event.target.value)} placeholder="Paste a short, non-sensitive summary of your experience, achievements, and strengths..." />
                <p className="field-hint">This context stays in the current page session. It is sent to your selected AI provider with your question to personalize suggestions.</p>
              </div>
            </section>
          ) : (
            <>
              <section className="page-heading dashboard-heading">
                <div><div className="eyebrow">{isActive && isRecording ? `LIVE ${providerName(selectedProvider).toUpperCase()} SESSION` : isPractice ? "GET INTERVIEW-READY" : "MONDAY, OCTOBER 12"}</div><h1>{isPractice ? "Practice your answers" : "Good evening, Jordan"} <span className="wave">✦</span></h1>
                  <p>{isRecording ? "Question detection is active. Suggestions appear after the interviewer pauses." : isPractice ? "Pick a prompt or bring your own. Your coach is ready." : "Your next great opportunity starts with a little practice."}</p>
                </div>
                <div className="heading-actions">
                  <button className="secondary-button" onClick={() => { setQuestion(""); setAnswers([]); setAnswersSimulated(selectedProvider === "demo"); setError(""); }}><Plus size={16} /> New practice</button>
                  {isActive
                    ? <button className="stop-button" onClick={stopSession}><Square size={14} fill="currentColor" /> Stop session</button>
                    : <button className="primary-button" onClick={() => void startSession()} disabled={starting}><Play size={15} fill="currentColor" /> {starting ? "Starting..." : "Start session"}</button>}
                </div>
              </section>

              <section className="status-strip">
                <div className="session-status"><span className={`status-dot ${isRecording ? "recording" : isActive ? "active" : "idle"}`} /><span>{isActive ? isRecording ? "Live session active" : "Demo session active" : "Ready to practice"}</span><span className="status-divider" /><span className="mic-status"><Mic size={14} />{isRecording ? "Mic recording" : "Mic not requested"}</span></div>
                <div className="status-meta"><span><Clock3 size={14} /> {formatElapsedTime(elapsed)}</span><span className="demo-tag">{isRecording ? `${providerName(selectedProvider).toUpperCase()} LIVE` : isActive || selectedProvider === "demo" ? "DEMO MODE" : providerName(selectedProvider).toUpperCase()}</span></div>
              </section>

              {isActive && <div className={`consent-banner ${isRecording ? "recording-banner" : ""}`}><span className="demo-live-dot" /><div><strong>{isRecording ? `MICROPHONE RECORDING — ${selectedProvider === "gemini" ? "GEMINI" : `${providerName(selectedProvider).toUpperCase()} + OPENAI TRANSCRIPTION`}` : "Demo session is running"}</strong><span>{isRecording ? selectedProvider === "gemini" ? "Short microphone-only audio segments and interview context are sent to Google Gemini. No system audio is captured. Stop immediately at any time." : "Short microphone-only audio segments are sent to OpenAI for transcription, then the transcript and interview context are sent to the selected answer provider. No system audio is captured. Stop immediately at any time." : "Sample transcript only — your microphone is not recording. Stop the session at any time."}</span>{isRecording && liveStatus && <span className="processing-status">{liveStatus}</span>}</div><button onClick={stopSession}><Square size={13} fill="currentColor" /> Stop now</button></div>}

              <div className="workspace-grid">
                <div className="center-column">
                  <section className="panel interview-panel">
                    <div className="panel-header">
                      <div className="panel-title"><span className="panel-icon purple"><MessageSquareText size={16} /></span><div><h2>Interview workspace</h2><p>Practice a question and shape your response</p></div></div>
                      <button className="quiet-button" onClick={() => setTranscript(isActive ? initialTranscript : [])}><MoreHorizontal size={19} /></button>
                    </div>
                    <div className="context-fields">
                      <div className="field-wrap"><label htmlFor="job-title">JOB TITLE</label><div className="input-icon"><BriefcaseBusiness size={15} /><input id="job-title" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} placeholder="e.g. Product Designer" /></div></div>
                      <div className="field-wrap"><label htmlFor="job-description">JOB DESCRIPTION <span>OPTIONAL</span></label><textarea id="job-description" value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder="Paste key responsibilities or requirements..." rows={2} /></div>
                    </div>
                    <div className="transcript-area">
                      <div className="subsection-title"><span>SESSION TRANSCRIPT</span>{isActive && <span className="live-label"><span className="demo-live-dot" /> {isRecording ? "LIVE GEMINI" : "LIVE DEMO"}</span>}</div>
                      {transcript.length ? <div className="transcript-list">{transcript.map((line, index) => (
                        <div className={`transcript-line ${line.self ? "self-line" : ""}`} key={`${line.time}-${index}`}>
                          <span className={`speaker-avatar ${line.self ? "you" : ""}`}>{line.self ? "JD" : <Headphones size={13} />}</span>
                          <div className="transcript-copy"><div><strong>{line.speaker}</strong><time>{line.time}</time></div><p>{line.text}</p></div>
                        </div>
                      ))}</div> : <div className="empty-transcript"><div className="empty-icon"><AudioLines size={20} /></div><strong>{isRecording ? "Listening for the next question" : "Your conversation will appear here"}</strong>                      <p>{isRecording ? "Speak clearly near the microphone. A transcript and answer appear after a short pause." : selectedProvider !== "demo" ? "Start a live session to capture microphone audio, transcribe it, and request an AI answer." : "Start a demo session to see sample transcript lines. No audio is captured."}</p>{!isActive && <button className="text-button" onClick={() => void startSession()}><Play size={13} /> Start {selectedProvider === "demo" ? "demo" : "live"} session</button>}</div>}
                    </div>
                    <div className="question-composer">
                      <label htmlFor="question-input">YOUR INTERVIEW QUESTION</label>
                      <textarea id="question-input" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Type or paste a question you'd like to practice..." rows={2} />
                      <div className="composer-bottom">
                        <div className="length-control"><span>ANSWER LENGTH</span>{(["concise", "balanced", "detailed"] as AnswerLength[]).map((length) => <button key={length} className={answerLength === length ? "active" : ""} onClick={() => setAnswerLength(length)}>{length[0].toUpperCase() + length.slice(1)}</button>)}</div>
                        <button className="generate-button" onClick={() => void generateAnswer()} disabled={generating}>{generating ? <><span className="spinner" /> Thinking</> : <><Sparkles size={15} /> Generate suggestion</>}</button>
                      </div>
                    </div>
                  </section>

                  <section className="panel suggestions-panel">
                    <div className="panel-header suggestion-header">
                      <div className="panel-title"><span className="panel-icon mint"><WandSparkles size={16} /></span><div><h2>Suggested answers</h2><p>Use these as a starting point, not a script</p></div></div>
                      <span className={`simulated-badge ${answersSimulated ? "" : "real-ai-badge"}`}><span className="simulated-dot" /> {answersSimulated ? "SIMULATED" : selectedProvider === "demo" ? "AI" : providerDetails[selectedProvider].name.toUpperCase()}</span>
                    </div>
                    {error && <div className="error-message" role="alert">{error}</div>}
                    {answers.length ? <div className="answer-list">{answers.map((answer, index) => (
                      <article className="answer-card" key={answer.id}>
                        <div className="answer-card-top"><div className="answer-title"><span className="answer-number">{String(index + 1).padStart(2, "0")}</span><strong>{answer.title}</strong></div><button className="copy-button" onClick={() => void copyAnswer(answer)}>{copied === answer.id ? <Check size={14} /> : <Copy size={14} />}{copied === answer.id ? "Copied" : "Copy answer"}</button></div>
                        <p>{answer.text}</p>
                      </article>
                    ))}</div> : <div className="empty-answer"><div className="empty-answer-spark"><Sparkles size={18} /></div><div><strong>Your answer suggestions will show up here</strong><p>Choose a sample question or write your own to get started.</p></div></div>}
                    <div className="simulation-note"><ShieldCheck size={14} /><span>{answersSimulated ? "Simulated demo suggestions — not generated by a live AI model." : `AI-generated by ${selectedProvider === "demo" ? "the selected provider" : providerDetails[selectedProvider].name}. Responses can be inaccurate; verify details before using.`}</span></div>
                  </section>
                </div>

                <aside className="right-column">
                  <section className="panel prep-panel">
                    <div className="panel-header compact"><div className="panel-title"><span className="panel-icon amber"><BriefcaseBusiness size={15} /></span><div><h2>Interview prep</h2></div></div><button className="quiet-button"><MoreHorizontal size={18} /></button></div>
                    <div className="prep-job">
                      <span className="company-mark">N</span><div><strong>{jobTitle || "Your next role"}</strong><span>{jobTitle ? "Role context" : "Add a job title to begin"}</span></div>
                    </div>
                    <div className="prep-divider" />
                    <label className="field-label" htmlFor="candidate-context">YOUR EXPERIENCE</label>
                    <textarea id="candidate-context" className="context-textarea" value={candidateContext} onChange={(event) => setCandidateContext(event.target.value)} placeholder="Add a few details about your background to personalize suggestions..." />
                    <div className="prep-tip"><Sparkles size={14} /><span>Answers are more relevant when you include a couple of specific achievements.</span></div>
                  </section>

                  <section className="panel history-panel">
                    <div className="panel-header compact"><div className="panel-title"><span className="panel-icon blue"><Clock3 size={15} /></span><div><h2>Question history</h2></div></div><button className="quiet-button" aria-label="Search history"><Search size={16} /></button></div>
                    <div className="history-list">{history.length ? history.map((item, index) => <button className="history-item" key={item} onClick={() => { setQuestion(item); void generateAnswer(item); }}><span className="history-bullet">{index === 0 ? <ArrowDownRight size={13} /> : <MessageSquareText size={12} />}</span><span>{item}</span><ChevronDown size={13} className="history-chevron" /></button>) : <p className="history-empty">Generated questions will appear here.</p>}</div>
                    {history.length > 0 && <button className="history-footer" onClick={() => setHistory([])}>Clear history</button>}
                  </section>

                  <section className="quick-questions">
                    <div className="quick-heading"><strong>Try a question</strong><span>DEMO PROMPTS</span></div>
                    {sampleQuestions.map((prompt) => <button key={prompt} onClick={() => { setQuestion(prompt); void generateAnswer(prompt); }}><span><MessageSquareText size={13} /></span>{prompt}<ArrowUpRight size={13} className="prompt-arrow" /></button>)}
                  </section>
                  <div className="footer-note"><Activity size={13} /> Your practice stays private on this device.</div>
                </aside>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function formatModelName(model: string): string {
  return model.replace(/^(gemini|gpt|claude|grok|sonar)-/i, "").replace(/-/g, " ");
}
