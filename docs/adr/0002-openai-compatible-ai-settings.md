# Use OpenAI-compatible AI settings with encrypted local secrets

AI suggestions use a user-configured OpenAI-compatible chat API, with the API key stored only on the local machine through Electron safeStorage and non-secret settings stored in the app userData area. We chose this over a fixed provider or local-only model because it keeps the first AI integration broadly compatible while keeping secrets out of renderer code and avoiding a new native keychain dependency.

## Considered Options

- Fixed cloud provider: simpler prompts and documentation, but locks the app to one vendor.
- Local-only model: stronger privacy and offline behavior, but less predictable setup and suggestion quality for a first version.
- Plaintext config file: simplest implementation, but exposes the API key unnecessarily.

## Consequences

- Users must configure a base URL, model, and API key before AI suggestions can run.
- Card context may be sent to the configured API provider, so AI Settings must make the integration boundary visible.
- Completion failures stay quiet in input fields and are diagnosed through AI Settings logs.