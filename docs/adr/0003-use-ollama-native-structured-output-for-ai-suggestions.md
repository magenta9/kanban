# Use Ollama-only AI suggestions with native structured outputs

AI suggestions now target Ollama only and use Ollama's native chat API with structured-output support as the primary runtime path. We chose this over continuing OpenAI-compatible provider support because the prompt rebuild depends on schema-constrained outputs, a smaller provider surface, and a tighter feedback loop between runtime behavior and local evaluation. This decision supersedes ADR 0002.

## Considered Options

- Keep OpenAI-compatible providers: broader compatibility, but more provider-specific drift and weaker guarantees for structured outputs.
- Ollama only through the native chat API: smaller runtime surface, direct access to `format` for JSON or JSON Schema, and simpler prompt/eval alignment.
- Ollama only through the OpenAI-compatible interface: keeps one transport shape, but adds an unnecessary abstraction layer on top of an already supported native path.

## Consequences

- Product runtime keeps `baseUrl` and `model`, but no longer needs API key or non-Ollama provider settings.
- Prompt generation and evaluation can share the same schema-constrained output model around Ollama `format` support.
- AI settings, documentation, and tests should stop describing OpenAI-compatible providers as a supported runtime path.
- The app still supports arbitrary Ollama endpoints, not only localhost.