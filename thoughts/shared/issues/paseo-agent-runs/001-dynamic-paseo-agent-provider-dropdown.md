# Dynamic Paseo Agent Provider dropdown

Labels: ready-for-agent

## Parent

Paseo Agent Runs PRD: `thoughts/shared/prd/paseo-agent-runs-prd.md`

## What to build

Expose Paseo Agent Providers to the Card details Agent panel. Kanban should read providers from Paseo, filter to available and enabled providers, expose that list through the app API, and render the result in the Agent Provider dropdown with clear empty and error states.

This slice should stop treating Codex and Pi as hardcoded local binaries for provider discovery. The UI should display Paseo provider labels and submit Paseo provider ids.

## Acceptance criteria

- [ ] The Agent Provider dropdown is populated from `paseo provider ls --json`.
- [ ] Only providers with available status and enabled state are shown.
- [ ] The dropdown display text uses Paseo's provider label.
- [ ] The selected value submitted by the renderer uses Paseo's provider id.
- [ ] If Paseo is missing, unavailable, or returns no usable providers, the Agent panel shows a clear disabled state and Run is disabled.
- [ ] Provider discovery is covered by tests using representative Paseo JSON output.
- [ ] Renderer behavior for populated, empty, and error provider states is covered by tests.

## Blocked by

None - can start immediately
