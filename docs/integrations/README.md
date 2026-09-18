# Integration status

Checked 2026-09-17. Interfaces are account- and version-dependent.

| Source | Shipped mode | Evidence |
|---|---|---|
| Codex | Automatic via official local app server, or manual | [Adapter notes](codex.md) |
| OpenRouter | Automatic key allowance/usage, or manual | [Adapter notes](openrouter.md) |
| Claude, ChatGPT, Gemini chat | Manual | Provider-visible observations only |
| Copilot, Cursor | Automatic personal AI credits / team spend, or manual | [Key integration notes](key-providers.md) |
| Anthropic/OpenAI API, Mistral, DeepSeek API | Automatic reported costs / limit status / balance, or manual | [Key integration notes](key-providers.md) |
| Groq, Gemini API, Vertex | Manual | No reporting adapter implemented |
| Cline | Manual managed balance, or track upstream BYOK provider | No duplicate upstream collector |

No private HTTP endpoints, browser-cookie scraping, or community quota helpers are dependencies.
