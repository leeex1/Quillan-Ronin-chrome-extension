# ⚔️ Quillan-Ronin Chrome Extension

## 🧭 Canonical project context

| | |
| :--- | :--- |
| **This repo** | Local-first browser copilot that talks to the QuillanWorker stack over NVIDIA NIM. |
| **Canonical package** | Three deployed models: Quillan-Ronin Flagship (~1B), Quillan-Ronin-Mini (~0.8B) and Quillan-Dragon (~1B). The ONI Python sources are implementation/training only. |
| **Donor design** | Flagship and Mini: Qwen 0.6B + Llama ~1B + BitNet 2B-4T + Falcon3 ~1B **as a group** (cross-match fix in progress). Dragon: Falcon3 with an Ollama system message running Quillan's system prompt. |
| **Reading the scores** | The 95–100% table in the root README is **Track A** — the Quillan harness on a third-party frontier base, not a Quillan checkpoint. Hard-exam cells are pending re-test; ARC-AGI-3 public ~99s, private pending. |
| **Historical framing** | Edo period, rōnin and bushidō are real Japanese history and ethics — not roleplay, game mechanics, or fantasy lore. |
| **Canonical docs** | [Root README](https://github.com/leeex1/Quillan-Ronin#readme) · [Fleet model cards](https://github.com/leeex1/Quillan-Ronin/blob/main/docs/MODEL_CARDS.md) |

<!-- QUILLAN-DOCS-PROVENANCE:BEGIN -->
<details>
<summary><b>📌 Quillan documentation provenance</b> — expand for canonical sources</summary>

> **Documentation provenance.** This repo is part of the Quillan-Ronin ecosystem (CrashOverrideX / `leeex1`). Canonical sources live in the root repository: `README.md` (**READ FIRST** — Track A harness-on-frontier vs. Track B native WSP models vs. Track B′ custom Mini) and `docs/MODEL_CARDS.md` (fleet identity, verified facts, open gaps). The large 95–100% benchmark table in the root README is a **harness-on-frontier** result, not a score of any Quillan-owned checkpoint. Creator artifacts (books, music, game demo) have primary-source links in the root README's **Creator and verifiable artifacts** section.  Four-donor design: Flagship and Mini receive all four donors (Qwen ~0.6B + Llama ~1B + BitNet 2B-4T + Falcon3 ~1B) **as a group**; Dragon is Falcon3 with an Ollama system message running Quillan's system prompt. Cross-match fix in progress.  The canonical package is the three deployed models — Quillan-Ronin Flagship (~1B), Quillan-Ronin-Mini (~0.8B) and Quillan-Dragon (~1B); the ONI Python sources are the implementation/training package, not the shipped product. Canonical official links (site, social, repos, Ollama, HF, Grokipedia, NotebookLM, DeepWiki, Genius, YouTube/Suno) are in the root README's **Official links** directory. Historical framing is real Japanese history (Edo period, rōnin, bushidō) used as an ethical reference frame — not roleplay, game mechanics, or fantasy lore.

</details>

<!-- QUILLAN-DOCS-PROVENANCE:END -->

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

## Transparency & Ecosystem

Built openly with AI assistance by [@crashoverride_X](https://x.com/Crashoverride_X) — the tool that helps build the tool.

- 🌐 **Creator Portfolio**: [digitalroninx.grok.me](https://digitalroninx.grok.me/)
- 👑 **Core Architecture**: [leeex1/Quillan-Ronin](https://github.com/leeex1/Quillan-Ronin)
- 📦 **Hugging Face**: [CrashOverrideX/Quillan-Ronin](https://huggingface.co/CrashOverrideX/Quillan-Ronin)

## Support the build

The hardware running this project was self-funded — literally by Quillan's own earnings program:

❤️ **https://gofund.me/12f726198**


## License

MIT
