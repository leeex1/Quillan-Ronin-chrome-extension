# ⚔️ Quillan-Ronin Chrome Extension

> *"The extension that lets you do anything with AI assistance."*

Browser copilot for the **[Quillan-Ronin](https://github.com/leeex1/Quillan-Ronin)** cognitive architecture. Talks to your local QuillanWorker stack over NVIDIA NIM. Local-first. No accounts. No telemetry.

![mode](https://img.shields.io/badge/modes-standard%20%7C%20architect%20%7C%20full--dive-blue) ![privacy](https://img.shields.io/badge/data-stays%20on%20your%20machine-green) ![workers](https://img.shields.io/badge/worker%20council-45%20registered-gold)

## Features

- **💬 Kernel-persona chat** — Quillan carries his own architecture file as his OS (condensed for fast mode, full distilled kernel on Kimi K3 in Full Dive)
- **👁️ Screen vision** — "what's on my screen?" → real screenshot → vision model → grounded answers about your actual display
- **📄 Explain this page** — reads the active tab (15k chars) and breaks it down
- **🧠 Persistent memory** — "remember X" once, recalled across every future session (junk-filtered, BOM-proof)
- **🤖 Browser task autopilot** — vague goals in, Plan→Act→Verify loops out. Pauses for CAPTCHAs and questions, escalates when stuck instead of flailing
- **♟️ Chess autopilot** — turn-aware autonomous play on chess.com (change-detection gated)
- **✋ Desktop hands** — real clicks/typing/screenshots via MCP bridge (ComputerUse + ChromeDevTools)
- **🕘 Chat history** — auto-saved every turn, reloadable
- **🛡 Router + 45-worker council registry** — requests route to specialist workers; mirrors the Quillan council architecture
- **🔁 Self-healing** — upstream failures retry and cascade models (8B → Mistral → 3B; Deep Dive: K3 → V4 Flash)

## Requirements

1. **QuillanWorker server** running locally (`node server.js` in the QuillanWorker folder, port 7777) — this extension is the face, the server is the kernel
2. **`NVIDIA_API_KEY`** env var on the server machine ([build.nvidia.com](https://build.nvidia.com) free tier works)
3. Optional: ChromeDevTools MCP + ComputerUse MCP for full hands (auto-configured from your MCP config)

## Install (Developer mode)

```
brave://extensions  (or chrome://extensions)
→ Developer mode ON
→ Load unpacked → select this folder
→ Click the ⚔️ icon → side panel opens
```

## Architecture

```
Extension (face/side panel)
   ↕ localhost:7777
QuillanWorker server (kernel: router + 45-worker registry + task engine)
   ↕ NVIDIA NIM (brain: 8B fast / Kimi K3 deep / 11b vision)
MCP bridge (hands: ComputerUse desktop + ChromeDevTools browser)
```

## Privacy

Everything runs between your browser and your machine. The only external calls are the prompts you send to NVIDIA's API. No analytics, no accounts, no phoning home.

## Transparency

Built openly with AI assistance by [@crashoverride_X](https://x.com/Crashoverride_X) — the tool that helps build the tool. That's not a footnote, that's the mission statement.

## Support the build

The hardware running this project was self-funded — literally by Quillan's own earnings program:

❤️ **https://gofund.me/12f726198**

## License

MIT
