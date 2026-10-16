# InterviewCopilot

InterviewCopilot is a React dashboard and Express API with a local demo mode and optional live AI providers: Google Gemini, OpenAI, Anthropic, xAI, and Perplexity. Live mode records short microphone-only audio segments after you start the session and grant browser permission. The app never captures system audio.

## Requirements

- Windows 10 or 11
- Node.js 20 or newer (the npm installer is included with Node.js)

## Setup on Windows

1. Install Node.js from [nodejs.org](https://nodejs.org/) if it is not already installed.
2. Open PowerShell in the project folder (the folder containing the root `package.json`).
3. Install the project dependencies:

   ```powershell
   npm.cmd install
   ```

4. Copy `.env.example` to `.env` to configure local API settings and optional provider keys:

   ```powershell
   Copy-Item .env.example .env
   ```

5. To use live AI, add the API key(s) for your selected provider in Settings, or configure them in `.env`. Keys entered in Settings are held in backend memory until the API restarts. The local demo works without a key.

If an API key has ever been exposed in a committed file or chat, revoke it in its provider console and create a new one. Do not reuse the exposed key.

## Run in development

From the project folder, run:

```powershell
npm.cmd run dev
```

This starts both applications. Open **http://localhost:5173** in your browser. The API health check is at **http://localhost:3001/api/health**.

To stop both processes, press **Ctrl+C** in the PowerShell window. If you create or change `.env` after starting the API, restart it before checking provider status again.

You can also start them separately in two PowerShell windows:

```powershell
npm.cmd run dev --workspace server
```

```powershell
npm.cmd run dev --workspace client
```

## Deploy a private mobile-accessible instance

The app can be hosted as one protected Render web service. GitHub Pages alone is not supported because it cannot run the Express API.

1. Create a **private** GitHub repository and push this project to it. Ensure `.env` is not committed.
2. In Render, create a new **Blueprint** and connect the private repository. Render will read [render.yaml](./render.yaml).
3. When prompted, set `APP_USERNAME` and a long unique `APP_PASSWORD`. Do not put provider API keys in GitHub; enter them in the app's Settings after deployment if you want AI features.
4. Deploy the Blueprint. Render's assigned `https://...onrender.com` address is the URL to open on your phone. The browser will prompt for the username/password.
5. Render's free instance may sleep while idle, so its first request after inactivity can take longer. Use HTTPS and keep the repository private.

The app requires the deployment login in production and rejects requests without it (except its non-secret health check). Keep the login private; anyone who has it can use the configured provider keys and incur their API charges. A Render account must be authorized to access the private GitHub repository.

## Try local demo mode

1. Open the dashboard and optionally fill in the role and candidate context.
2. Choose one of the sample questions or type your own question.
3. Choose an answer length and select **Generate suggestion**.
4. Copy a suggested answer with its **Copy answer** button.
5. Select **Start Session** to start the demo timer and load sample transcript lines. **Stop Session** ends it.

Demo sessions do not request microphone access or send interview content to a provider. Suggestions are simulated.

## Try an AI provider

Supported providers are Google Gemini, OpenAI (ChatGPT), Anthropic (Claude), xAI (Grok), and Perplexity. Each provider requires its own API key:

- [Google AI Studio](https://aistudio.google.com/api-keys) — Gemini
- [OpenAI API keys](https://platform.openai.com/api-keys) — ChatGPT and transcription
- [Anthropic Console](https://console.anthropic.com/settings/keys) — Claude
- [xAI Console](https://console.x.ai/) — Grok
- [Perplexity API settings](https://www.perplexity.ai/settings/api) — Perplexity

Provider API access and billing are separate from consumer chat subscriptions.

1. Select a provider in **Settings**, select a model, enter its API key, then click **Save key**. API keys entered in the UI are sent only to the local backend, held in memory until restart, and are not saved in browser storage.
2. Click **Load available models** to retrieve the models available to that key. OpenAI, Anthropic, and xAI models are listed from their APIs; Perplexity provides its supported Sonar model choices in the UI.
3. Optionally click **Test connection** to send a sample question and verify the selected model.
4. Return to the dashboard. For a live microphone session, grant browser microphone permission when prompted.

Gemini processes microphone audio directly. For OpenAI, Claude, Grok, and Perplexity sessions, the app uses the OpenAI API (Whisper) to transcribe audio, then sends the transcript and interview context to the selected answer provider. These sessions therefore require both the selected provider's key and an OpenAI key. Typed interview questions only require the selected answer provider's key. `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, and `PERPLEXITY_API_KEY` can alternatively be configured in the root `.env` file.

If a provider rejects its key, replace it in Settings or update the matching `.env` entry. Never share or paste your key into chat.

Only microphone input is captured. Audio from a remote interview playing through headphones is not captured by this microphone-only feature; system/loopback audio capture is not implemented. Browser microphone permissions require `localhost` or HTTPS. Audio and context are sent to the services described above and are not saved by this app. Provider model availability, quotas, terms, and data handling differ; review the provider's current terms before use. Do not use live capture without the other participants' consent where required.

## Tests and production build

Run the automated tests:

```powershell
npm.cmd test
```

Create production builds:

```powershell
npm.cmd run build
```

## Project layout

```text
client/          React, TypeScript, Vite, and browser tests
  src/
server/          Express API, provider interface, and endpoint tests
  src/
```

The server keeps provider credentials out of browser storage; keys entered in Settings are sent only to the local backend and held in its memory until restart. Local demo suggestions remain available without credentials. Gemini handles live audio directly; the other listed providers use OpenAI transcription for live audio and their own API for answer generation. Shared answer-generation and speech-to-text contracts are in `server/src/providers/`.
