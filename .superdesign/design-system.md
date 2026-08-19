# Live Translator UI Design System

## Product surfaces

- Chrome extension toolbar popup: fixed 380px dark settings panel.
- In-page bilingual captions: highest-z-index Shadow DOM overlay over the largest visible video.
- New feature target: the same caption surface can float over the page or move into Chrome's native Side Panel.

## Visual language

- Preserve the existing compact, dark, utility-first appearance. This is an evolution of the current UI, not a visual redesign.
- Background `#0b1120`; surfaces `#111827` and `#182235`; field background `#0f172a`.
- Borders `#334155`/`#475569`; white primary text `#f8fafc`; muted text `#a8b3c5`.
- Teal action/focus palette: `#14b8a6`, `#0d9488`, `#5eead4`.
- Caption source text is white; translation is amber `#fde68a`; errors use `#fca5a5`.
- Caption surface is translucent near-black, with a subtle white border, 10px radius, and `0 8px 28px rgba(0,0,0,.34)` shadow.
- Font stack: Inter, system UI fallbacks. Caption source 24px/650 and translation 22px/550 at 1.35 line-height by default.
- Controls use 8–12px radii. Interactive focus uses the existing teal focus ring.

## Interaction requirements for the target draft

- Floating captions have no title bar or dedicated `Drag to move` row. The caption surface itself is draggable and has eight resize affordances; caption text stays click-through so the underlying video remains usable.
- Default floating placement remains centered near the bottom of the largest video, approximately 70% of its width and 180px high.
- The floating rectangle is constrained to the viewport with an 8px safety margin and a 280×120px minimum.
- Increasing height reveals more complete bilingual caption rows automatically; shrinking hides older rows at the top. Never crop half of a bilingual pair.
- A compact corner icon on the floating surface opens Chrome Side Panel without creating a title bar.
- Chrome Side Panel contains the caption history plus one control to return to the floating overlay. When native Side Panel mode is active, the webpage caption overlay is hidden completely.
- Native Side Panel history is scrollable and normally sticks to the newest caption. When the reader scrolls upward, preserve their position and show a small new-caption control.
- In native side-panel mode on Chrome 116, switching away leaves an inactive explanatory state because programmatic close is not universally available.
- Fullscreen video-element mode continues to use the browser's native text-track fallback and exposes no drag handles.

## Settings surface changes

- Preserve provider, language, start/stop, font-size, line-width, background-opacity, privacy, and status UI.
- Remove the caption row-count select. Row count is derived from the resized caption surface height.
- Also remove caption-width and bottom-offset sliders; direct manipulation replaces them.
- Do not add start/stop or language/provider settings to Chrome Side Panel.

## Responsive and accessibility rules

- Maintain strong contrast, keyboard-visible focus, minimum 40px controls, labelled icon buttons, and reduced-motion behavior.
- Dragging/resizing must use clear cursor and resize affordances without adding a title bar, and caption text must not capture page clicks.
- Design two states in one coherent desktop interaction sheet: floating/resizing and Chrome native Side Panel.
