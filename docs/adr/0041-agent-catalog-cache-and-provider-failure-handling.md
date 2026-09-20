# ADR-0041: Independent Assistant Connections and Reliable Model Catalogs

## Status

Accepted

## Date

2026-09-20

## Context

Assistant settings discarded model metadata on unmount, forcing repeated
manual loads despite a saved Composer Models shortlist. OpenRouter model
validation interpreted an unsupported individual-model endpoint's 404 as a
removed model. Streaming requests could wait after the SDK's response-header
timeout, and the runtime treated incomplete provider turns as successful runs.

## Decision

- Keep one connection per provider, using the existing per-provider encrypted
  credential store. Add optional `providerBaseUrls` to version-1 config and
  normalize missing maps on load. Resolve legacy `baseUrl` only for the original
  provider, preserving endpoints when the default changes. The default is a
  provider/model pair; a thread override resolves its own provider endpoint.
- Settings show responsive three-column provider/endpoint/API-key rows, with
  explicit save/cancel/remove actions. Saved keys remain masked; newly typed
  keys are visible and cleared on save/cancel. Model groups use each connected
  provider's independent catalog and shortlist, retaining vendor/free metadata.
- Select controls store plain text label metadata; the selected rich label is
  rendered from current props to avoid retaining stale component trees during
  catalog updates or development hot reloads.

- Main owns a separate, disposable `agent-model-catalogs.json` metadata cache.
  Entries are keyed by provider and effective custom endpoint, reused for one
  hour, and loaded across restarts. Concurrent requests share a fetch. Expired
  metadata remains usable for display while refreshing; explicit refresh
  reports failures without deleting the previous successful catalog.
- Credential changes invalidate that provider's entries and prevent older
  in-flight requests from repopulating them. Credentials, permission grants,
  and conversations are never written into this cache.
- OpenRouter validation uses a successful, fresh catalog rather than assuming
  support for OpenAI's individual-model endpoint. Failure to check availability
  means `unknown`; only absence from a fresh catalog means `not-found`.
- Settings load metadata automatically and preserve saved model IDs when
  metadata is unavailable. Catalog refresh and model selection are independent.
- Chat Completions streams have a 60-second inactivity deadline covering both initial
  response and stream consumption. Interrupted or malformed turns retain their
  partial output and finish with an error. Incomplete tool batches do not run,
  and their outstanding calls reach a terminal state.
- OpenRouter requests containing tools require compatible provider parameters;
  tools are never silently removed. Run diagnostics contain provider/model,
  duration, turn count and terminal reason, without prompts or tool arguments.
- Provider failures do not trigger automatic replay of executed actions or
  substitution of a different model. The selected model and its price tier
  remain under the user's control.

## Consequences

Settings and chat reuse the same catalog without treating a network outage as
model removal. Saved display metadata may lag provider changes by an hour;
explicit refresh requests a current catalog. Free-provider capacity and model
quality remain external constraints, but stalled and incomplete responses no
longer masquerade as successful work.
