# DeepL Compatible Model Selection Design

## Context

The live Chrome test reaches the five-failure circuit while English captions
continue. The configured DeepL API key is active and has ample quota. The
extension currently forces `model_type: latency_optimized`, while DeepL's
standard request format permits the service to select a compatible model.

## Decision

Remove the optional `model_type` field from translation requests. Keep the
existing endpoint selection, authorization header, source and target language
codes, caption lifecycle, retry delays, five-failure circuit, and API-key
handling unchanged.

DeepL will select a model compatible with the requested language pair,
including `EN` to `ZH-HANT`.

## Code Changes

- Update `DeepLClient` so its JSON body contains only `text`, `source_lang`,
  and `target_lang`.
- Update the existing request-body unit-test expectation and description.
- Do not add fallback requests or additional diagnostics in this change.

## Verification Constraint

The user explicitly requested that no tests or Chrome verification be run
after this change. Existing tests will be updated to describe the intended
request shape, but they will not be executed in this task.

## Security

The API key remains only in the `Authorization` header. It is not placed in a
URL, log, persisted retry state, test fixture, or documentation.
