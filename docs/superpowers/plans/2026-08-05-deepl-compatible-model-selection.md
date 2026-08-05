# DeepL Compatible Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop forcing DeepL's optional latency model so DeepL can select a model compatible with English-to-Traditional-Chinese translation.

**Architecture:** Keep `DeepLClient` as the single request-construction boundary. Change only the JSON request shape and its existing unit-test expectation; all offscreen transport, retry, circuit, lifecycle, endpoint, and authentication behavior remains unchanged.

**Tech Stack:** TypeScript, Chrome MV3/WXT, Vitest

## Global Constraints

- Remove only the optional `model_type` field from translation requests.
- Keep `text`, `source_lang`, and `target_lang` unchanged.
- Keep the API key only in the `Authorization` header.
- Do not change endpoint selection, retry delays, five-failure circuit, caption lifecycle, or UI messages.
- Per the user's explicit instruction, update the existing test expectation but do not execute tests, compilation, build, or Chrome verification.

---

### Task 1: Use DeepL's Compatible Default Model

**Files:**
- Modify: `tests/providers/deepl.test.ts`
- Modify: `src/providers/deepl.ts`

**Interfaces:**
- Consumes: `DeepLClient.translate(request: TranslationRequest, signal?: AbortSignal): Promise<TranslationResult>`
- Produces: the same interface with a request body containing only `text`, `source_lang`, and `target_lang`

- [ ] **Step 1: Update the request-shape test expectation**

Rename the test to `posts a compatible translation request without exposing the key in the URL` and change its body assertion to:

```ts
expect(JSON.parse(String(request?.body))).toEqual({
  source_lang: 'EN',
  target_lang: 'ZH-HANT',
  text: ['Good morning'],
});
```

Do not run the test, per the user's explicit verification constraint.

- [ ] **Step 2: Remove the optional model selection**

Change the request body in `DeepLClient.translate` to:

```ts
body: JSON.stringify({
  source_lang: request.sourceLanguage,
  target_lang: request.targetLanguage,
  text: [request.text],
}),
```

Do not alter the endpoint, headers, abort signal, response handling, or error mapping.

- [ ] **Step 3: Inspect the scoped diff without executing verification**

Run only the read-only command:

```bash
git diff -- src/providers/deepl.ts tests/providers/deepl.test.ts
```

Confirm the diff contains only the test description, expected request body, and removal of `model_type` from production code.

- [ ] **Step 4: Commit the scoped change**

```bash
git add src/providers/deepl.ts tests/providers/deepl.test.ts
git commit -m "fix: let DeepL select a compatible model"
```
