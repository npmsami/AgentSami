<div align="center">

# AgentSami

**AI-powered desktop assistant for technical interviews and problem solving**

<p align="center">
  <img src="https://img.shields.io/badge/Electron-29.x-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/LLM-OpenAI-412991?style=flat-square&logo=openai&logoColor=white" alt="OpenAI" />
  <img src="https://img.shields.io/badge/Speech-Google%20Cloud%20(optional)-4285F4?style=flat-square&logo=googlecloud&logoColor=white" alt="Google Speech" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="Platform" />
</p>

<p align="center">
  <em>Stealth-oriented overlay UI, screen capture + vision, optional live transcription.</em>
</p>

</div>

---

## Overview

**AgentSami** is an [Electron](https://www.electronjs.org/) desktop app that captures your screen (or listens with a mic) and sends context to **OpenAI** using skill-specific system prompts. Responses stream into a floating **AI Response** window; a separate **Chat** window supports ongoing conversation with session memory.

The app is designed with **stealth-oriented** behavior (e.g. process title / disguise options in config) so overlays can be less conspicuous during screen shares. Use it **ethically** and only where policy allows.

### Demo

https://github.com/user-attachments/assets/896a7140-1e85-405d-bfbe-e05c9f3a816b

---

## What it does

| Capability | Details |
|------------|---------|
| **Vision (screenshots)** | Captures a display via Electron `desktopCapturer`, sends **PNG** to OpenAI with the active **skill prompt** (`processImageWithSkill`). No local OCR engine is required for the main path. |
| **Text & chat** | OpenAI chat completions with streaming; conversation history and skill context from `prompt-loader.js`. |
| **Speech (optional)** | **Google Cloud Speech-to-Text** streaming if `GOOGLE_SPEECH_KEY_FILE` points to a valid service-account JSON. Mic is used from the renderer; audio is sent to the main process. Recording stops with **Alt+R**; accumulated text is then sent to the LLM. |
| **Skills** | Markdown prompts under `prompts/` define interviewer-style behavior per domain (see below). |
| **Settings** | Configure API key and related options in the in-app **Settings** window (`Ctrl`+`,` / `Command`+`,`). |

Default LLM settings live in `src/core/config.js` (e.g. model **`gpt-4o-mini`**, timeouts, generation parameters). Override behavior via code or future settings as exposed in the UI.

---

## Skill prompts (`prompts/`)

Each `.md` file is one skill (filename without extension = skill id):

- `dsa` — data structures & algorithms  
- `programming` — general programming  
- `cloud-engineering` — default skill in app startup (`main.js`: `activeSkill`)  
- `platform-engineering`  
- `devops`  
- `sre`  
- `systems-engineering`  

Programming language hints (e.g. C++, Python) are applied where the prompt loader supports them.

---

## Requirements

- **Node.js** 18+ and npm  
- **OpenAI API key** — required for LLM features (`OPENAI_API_KEY`)  
- **Google Cloud Speech** — optional; service account JSON and Speech-to-Text API enabled for the project  

---

## Configuration

1. Copy the example env file:

   ```bash
   cp env.example .env
   ```

   On Windows (PowerShell):

   ```powershell
   Copy-Item env.example .env
   ```

2. Edit **`.env`** in the project root:

   | Variable | Required | Purpose |
   |----------|----------|---------|
   | `OPENAI_API_KEY` | **Yes** (for AI features) | OpenAI API key |
   | `GOOGLE_SPEECH_KEY_FILE` | No | Absolute or project-relative path to Google **service account** JSON for Speech-to-Text |

3. **Secrets**: Never commit `.env` or credential JSON. They are excluded from builds via `package.json` `build.files` (`!.env*`).

> **Note:** If you use `setup.sh`, it may still mention legacy Gemini-oriented wording. For this fork, follow **`env.example`** and this README so `OPENAI_API_KEY` matches `src/services/llm.service.js`.

---

## Run from source

```bash
npm install
npm start
```

Development helper (e.g. GPU flags on Linux):

```bash
npm run dev
```

Optional: `./setup.sh` installs dependencies and can create a `.env` — verify keys match OpenAI + Google Speech as above.

---

## Keyboard shortcuts (global)

| Shortcut | Action |
|----------|--------|
| `Ctrl`+`Shift`+`S` / `Cmd`+`Shift`+`S` | Trigger screenshot → vision / LLM pipeline |
| `Ctrl`+`Shift`+`V` / `Cmd`+`Shift`+`V` | Toggle window visibility |
| `Ctrl`+`Shift`+`I` / `Cmd`+`Shift`+`I` | Toggle interaction mode |
| `Ctrl`+`Shift`+`C` / `Cmd`+`Shift`+`C` | Switch to Chat window |
| `Ctrl`+`Shift`+`\` / `Cmd`+`Shift`+`\` | Clear session memory |
| `Ctrl`+`,` / `Cmd`+`,` | Open Settings |
| `Alt`+`A` | Toggle interaction |
| `Alt`+`R` | Start/stop speech recording (if speech is configured) |
| `Ctrl`+`Shift`+`T` / `Cmd`+`Shift`+`T` | Force always-on-top for windows |
| `Ctrl`+`Shift`+`Alt`+`T` | Debug always-on-top test (logged) |
| `Ctrl`+`↑` `↓` `←` `→` | Context-sensitive navigation (see `main.js`) |

Exact behavior may vary slightly by OS; Electron registers **global** shortcuts.

---

## Build distributables

Uses [electron-builder](https://www.electron.build/). Examples:

```bash
npm run build:win
npm run build:mac
npm run build:linux
npm run build:all
```

Output goes to `dist/` per `package.json` `build.directories.output`.

---

## Project layout (high level)

| Path | Role |
|------|------|
| `main.js` | App lifecycle, IPC, shortcuts, orchestration |
| `preload.js` | Secure bridge to renderer |
| `src/services/llm.service.js` | OpenAI chat + vision + streaming |
| `src/services/speech.service.js` | Google Cloud Speech streaming |
| `src/services/capture.service.js` | Screen capture → PNG buffer |
| `src/managers/window.manager.js` | Multi-window layout |
| `prompt-loader.js` | Loads `prompts/*.md` |

---

## Troubleshooting

- **Blank window / Electron issues (Linux):** try `npm run dev`; ensure a display server is available.  
- **OpenAI errors:** confirm `OPENAI_API_KEY` in `.env`, billing, and model access for `gpt-4o-mini` (or change model in `src/core/config.js`).  
- **Speech disabled:** without `GOOGLE_SPEECH_KEY_FILE` or a valid JSON path, the mic path stays off — this is expected.  
- **macOS screen capture:** grant **Screen Recording** for the app in **System Settings → Privacy & Security**.  
- **Windows SmartScreen:** use development `npm start` or sign built binaries for distribution.  

---

## Privacy & ethics

- **API traffic:** Requests to OpenAI (and Google, if speech is enabled) go over the network; review their terms and your org’s policy.  
- **Local data:** Session behavior is managed in-app; see code for persistence details.  
- **Responsible use:** Do not use to violate interview rules, assessments, or laws.

---

## License

This project is licensed under the **Apache License 2.0** — see [LICENSE](LICENSE).

---

## Acknowledgments

- [OpenAI](https://openai.com/) — LLM APIs  
- [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text) — optional transcription  
- [Electron](https://www.electronjs.org/) — desktop shell  

Upstream lineage and inspiration are credited in prior forks (e.g. community contributions and related interview-assistant projects).

---

<div align="center">

If this project helped you, consider starring the repo.

**AgentSami** — AI problem-solving assistant

</div>
