# SlideDown Design and Development Roadmap

Status: Draft for review  
Last updated: 2026-07-30  
Primary implementation: `slidedown.html`  
User documentation: `slidedown-authoring-guide.md`

## 1. Purpose of this document

This document is the working design, roadmap, and phase handoff for SlideDown. It is intended to:

- record the desired behavior and architectural direction;
- divide the work into phases that can be implemented and reviewed independently;
- preserve open questions instead of silently turning assumptions into permanent design decisions;
- provide acceptance criteria for deciding when a phase is complete; and
- contain enough context that it can be supplied to a new Codex task without reconstructing the project history.

This is an engineering document, not the PSL authoring guide. When a phase changes public syntax or behavior, the built-in help, sample deck, and `slidedown-authoring-guide.md` must be updated as part of that phase.

## 2. Product vision

SlideDown is a portable, Markdown-inspired presentation system with a text-first authoring language, live browser preview, programmable diagrams, and step-based animation. It should remain approachable for simple decks while scaling toward richer editing, collaboration, and presentation-control workflows.

The long-term product should support four complementary ways of working:

1. Writing PSL directly in a capable, context-aware editor.
2. Visually arranging and editing the same scene without abandoning the text representation.
3. Collaborating on a deck with other authors.
4. Presenting from a browser while controlling the show from another device.

The plain-text deck remains the source of truth. Visual tools should edit that source through a structured document model rather than create a separate proprietary representation.

## 3. Guiding principles

### 3.1 Preserve a portable distribution

The preferred release artifact remains a single `slidedown.html` file that can be hosted statically or opened locally. Development sources may be split into modules and assembled by a build step. A build system must not make ordinary deck viewing dependent on a server-side runtime.

### 3.2 Maintain backward compatibility deliberately

Existing PSL decks should continue to work unless a breaking change is explicitly approved. New explicit syntax may coexist with legacy shorthand. Deprecations should produce actionable diagnostics before old behavior is removed.

### 3.3 Separate language, scene, rendering, and application state

The parser should produce a typed document/scene representation. Rendering should consume that representation without reinterpreting source text. Presentation state, editor state, storage, and UI dialogs should not be hidden in parser or renderer globals.

### 3.4 Make errors local and actionable

Diagnostics should identify severity, slide, source range, cause, and a suggested correction where possible. Invalid input must not silently become a different effect or leave presentation playback permanently busy.

### 3.5 Optimize measured bottlenecks

Correct incremental behavior and reduced DOM work come before language rewrites undertaken solely for speed. Performance work should use representative benchmarks and browser profiling.

### 3.6 Keep the C++/WebAssembly option open

C++/WebAssembly is a possible implementation for the pure language core, not a current commitment. DOM rendering, browser UI, editor integration, media, and collaboration remain browser-facing JavaScript/TypeScript responsibilities. See Section 8 for decision criteria.

## 4. Current-state summary

The current application is approximately 3,350 lines in one HTML file containing CSS, markup, PSL parsing, expression evaluation, rendering, animation, persistence, presentation mode, dialogs, imports, a sample deck, and PowerPoint conversion.

Strengths include:

- a compact portable application;
- a readable text format with useful diagram and animation features;
- graceful fallback for several optional browser libraries;
- a logical 1280 x 720 coordinate space;
- local autosave and checkpoint history;
- presentation, presenter, overview, print, import, and remote-deck modes; and
- a sample deck and substantial authoring documentation.

Known areas requiring attention include:

- stale main-preview caching when an upstream variable, `!all`, or import changes;
- malformed numeric values that can produce `NaN` and hang an animation;
- missing styles for code blocks, tables, HUD controls, and the presenter console;
- restored drafts being marked clean immediately;
- silent failures for unknown animation targets and unsupported animation/property combinations;
- ambiguous implicit units and incomplete unit parsing;
- fixed renderer layers that ignore source order across element types;
- a narrow set of animatable properties;
- limited table styling and no useful default grid styling;
- unsafe active-content behavior for untrusted remote decks and embeds;
- repeated parsing and complete thumbnail reconstruction after edits;
- duplicated conversion, thumbnail, media, and dialog logic; and
- no automated parser or browser regression test suite.

## 5. Target architecture

The exact module format and build tooling remain open, but the responsibilities should converge on the following boundaries:

```text
PSL source
   |
   v
Parser + expression evaluator + validator
   |
   v
Typed document / slides / scene items / steps / diagnostics
   |                         |
   |                         +--> language services for the editor
   v
Scene renderer + presentation player
   |
   +--> editor preview and thumbnails
   +--> audience and presenter views
   +--> print/export

Application controller
   +--> document lifecycle and dirty state
   +--> storage and history
   +--> commands, dialogs, imports, and layout
   +--> future collaboration and remote control adapters
```

Likely development modules are:

- `core/units` -- strict numeric and unit parsing and conversion;
- `core/expressions` -- PSL expression parsing and evaluation;
- `core/parser` -- source-to-document parsing with source ranges;
- `core/diagnostics` -- structured errors, warnings, and hints;
- `core/model` -- typed document, scene, style, property, and animation definitions;
- `render/scene` -- ordered visual scene rendering;
- `render/player` -- reveal steps, animation, transitions, and media lifecycle;
- `app/state` -- selected slide, dirty state, presentation state, and commands;
- `app/storage` -- autosave, recovery, checkpoints, and layout settings;
- `ui` -- menus, dialogs, help, diagnostics, and editor integration;
- `import/pptx` -- PowerPoint conversion; and
- `build` -- construction of the portable HTML artifact.

Module extraction should be incremental. A large rewrite that changes every subsystem simultaneously is specifically out of scope.

## 6. Development phases

### Phase 0: Baseline, tests, and stabilization

Goal: make the existing behavior safe to change and eliminate known correctness bugs without redesigning PSL.

Deliverables:

- establish a lightweight build/test entry point while retaining the current HTML artifact;
- add parser/expression unit tests for fences, slide splitting, variables, control flow, imports, geometry, and animation syntax;
- add browser smoke tests for loading, editing, preview, presentation navigation, draft recovery, and printing preparation;
- add large synthetic decks for repeatable performance measurements;
- fix preview invalidation for `!all`, imports, upstream variables, and deck settings;
- strictly validate durations and numeric geometry before values reach the renderer or animation engine;
- surface invalid animation targets and unsupported operations;
- fix draft-recovery dirty-state behavior;
- add the missing table, code, HUD-button, and presenter-console styles;
- decide and consistently support the canonical deck extension, including the file picker; and
- document the trust model and apply basic URL-scheme and embed hardening.

Acceptance criteria:

- the inline application and extracted scripts, if any, pass syntax/build checks;
- automated tests cover every corrected regression;
- malformed input cannot leave a `Player` permanently busy;
- changing shared or imported content refreshes affected slides;
- unknown labels and invalid values produce visible diagnostics;
- code blocks, tables, HUD controls, and presenter status have intentional styles; and
- existing sample and guide decks still load and present.

Non-goals:

- a new scene graph;
- broad new animation properties;
- smart completion or visual editing; and
- a C++/WebAssembly port.

### Phase 1: Typed language core, explicit units, and structured diagnostics

Goal: create a stable language/model boundary that later editors and renderers can depend on.

Deliverables:

- introduce structured diagnostics with severity, code, message, source range, slide, and optional suggestion;
- give parsed items stable identities for the duration of an editing session;
- define a typed schema for element kinds, styles, properties, animation operations, steps, and transitions;
- centralize length parsing and conversion;
- support explicit `px` and `%` units anywhere a length or coordinate is accepted;
- retain existing bare-number behavior for backward compatibility;
- allow explicit units to be mixed, such as `@(320px, 50%)` or `(40%, 180px)`;
- validate unknown style keys and property/element compatibility;
- make parsing return source ranges and slide ranges so the application does not split the deck twice; and
- expose a clean parser interface suitable for either JavaScript or a future Wasm implementation.

Proposed compatibility rule:

- `50%` means half of the relevant axis or span;
- `320px` means 320 logical slide pixels;
- legacy bare values with absolute value at most 1 retain their current fractional interpretation;
- legacy larger bare values retain their pixel interpretation; and
- documentation should prefer explicit units once implemented.

Acceptance criteria:

- all coordinate, dimension, radius, style-length, and animation destinations use one unit parser;
- mixed explicit units work in placement, shape geometry, sizing, and animations;
- invalid units identify their exact source range;
- the renderer consumes typed values rather than parsing raw strings repeatedly;
- diagnostics can be rendered both in the current warning panel and by a future code editor; and
- backward-compatibility fixtures render equivalently.

Non-goals:

- visual dragging;
- collaborative document operations; and
- deciding that the core must be C++.

### Phase 2: Ordered scene graph and layering

Goal: make visual ordering predictable and independent of implementation-specific HTML/SVG containers.

Deliverables:

- represent every visual element as an ordered scene item;
- make later source elements appear in front of earlier elements by default, regardless of type;
- add an explicit persistent layer/order property, provisionally `{z=10}`;
- support discrete step operations such as `front`, `back`, `forward`, `backward`, and explicit `z` assignment;
- ensure shapes, text, images, tables, code, media, and embeds can be interleaved correctly;
- define pointer-event behavior for overlapping interactive elements;
- preserve reveal steps, transforms, media lifecycle, print output, and slide transitions; and
- add visual regression cases for mixed HTML/SVG ordering.

Acceptance criteria:

- source order is the default stacking order across all element types;
- explicit `z` values are deterministic, including ties;
- layer changes take effect at the correct presentation step;
- a text item written after a rectangle appears in front of it by default;
- thumbnails, preview, presentation, presenter view, and print agree on ordering; and
- layering is represented in the model rather than inferred from DOM container order.

Open design point: layer changes are inherently discrete. A duration may be accepted syntactically for consistency, but there is no meaningful interpolation between stacking levels.

### Phase 3: Unified properties, animation coverage, and tables

Goal: make visual properties consistent, discoverable, and broadly animatable.

Deliverables:

- define a registry/schema of properties, accepted value types, defaults, applicable element kinds, and interpolation behavior;
- distinguish `textcolor`, `fill`, and `stroke` instead of overloading `color` ambiguously;
- retain sensible `color` aliases for backward compatibility;
- support animation of at least `fill`, `stroke`, `textcolor`, `opacity`, `thick`, and `round`;
- provide clear diagnostics when a property cannot apply to an element;
- decide whether ordinary rectangles and text boxes should default to square or rounded corners;
- make corner radius explicit and allow `round=0` everywhere relevant;
- give tables useful default typography, padding, borders, and interior grid lines;
- support configurable outer border, interior rules, thickness, line color, cell padding, header fill/text, body fill/text, alternating rows, column widths, and alignment; and
- determine the first supported scope for table styling: whole table, header/body, row, column, and/or cell.

Illustrative syntax, subject to review:

```text
[box] {fill=#1f6f6b, stroke=#173f3d, textcolor=white, round=0} !textbox (10%,20%) (35%,30%) Text
...
!anim box fill #c23b22 0.5s
!anim box textcolor white 0.5s
!anim box round 18px 0.4s
```

Acceptance criteria:

- the same property vocabulary is used by initial styles and animations;
- interpolated colors and lengths reach exact final values;
- unsupported combinations produce diagnostics instead of no-ops;
- rectangle corner behavior matches the documented decision;
- an unstyled Markdown table is presentation-ready and visibly structured; and
- table styling works consistently in preview, thumbnails, presentation, and print.

### Phase 4: Incremental rendering and performance

Goal: scale editing and presentation to large decks before adding substantially heavier editor features.

Deliverables:

- measure parse time, model construction, DOM creation, syntax highlighting, math rendering, layout, and thumbnail creation separately;
- avoid reparsing or rerendering unaffected slides where dependencies permit;
- compute dependency invalidation for global settings, variables, `!all`, and imports;
- cache thumbnails by resolved slide/model revision rather than only raw local source;
- virtualize thumbnail DOM for large decks;
- avoid loading live embeds and media outside active views;
- minimize forced layout during resizing and animation setup; and
- establish performance budgets using synthetic and real decks.

Initial budgets to validate and revise:

- ordinary typing should not block the main thread for more than 50 ms per update;
- the selected-slide preview should normally settle within 100 ms after the edit debounce;
- a 100-slide text-heavy deck should remain comfortable to edit;
- presentation navigation should not wait for unrelated thumbnails; and
- memory should remain stable across repeated preview and presentation rebuilds.

Acceptance criteria:

- benchmarks run repeatably and report subsystem timings;
- editing one local slide does not recreate every unaffected thumbnail;
- imports and shared dependencies still invalidate all affected slides correctly;
- no performance optimization changes rendered or presentation semantics; and
- profiling determines whether parsing is significant enough to reconsider its implementation language.

### Phase 5: Context-aware text editor

Goal: replace the plain textarea with an editor that understands PSL while preserving text-first authoring.

Deliverables:

- evaluate CodeMirror 6, Monaco, or another suitable embeddable editor;
- syntax highlighting based on PSL structure rather than a loose Markdown approximation;
- context-aware completion for directives, labels, animation verbs, properties, functions, variables, and element members;
- inline diagnostics with hover details and quick navigation;
- hover/reference help sourced from the language/property schema;
- matching and folding for code fences, `!if`, loops, and slides;
- safe formatting and insertion commands;
- navigation between an element, its label references, and the selected slide; and
- retention of file loading, autosave, history, and presenter-notes behavior.

Acceptance criteria:

- completion suggestions depend on cursor context and known labels/properties;
- diagnostics point at exact ranges without requiring a full preview refresh;
- large-deck editor performance meets Phase 4 budgets;
- editor actions produce ordinary readable PSL; and
- the plain source remains accessible and exportable without editor-specific metadata.

### Phase 6: Live visual editing

Goal: add direct manipulation without creating a second document format.

Deliverables:

- select elements in the preview and identify their source/model item;
- drag positioned items with snapping, guides, keyboard nudging, and unit-aware updates;
- resize and rotate supported elements with handles;
- edit common style properties through an inspector;
- change stacking order visually;
- preserve or deliberately convert the author's unit choices;
- define behavior for computed geometry and variables that cannot be safely rewritten;
- group visual edits into undoable source transactions; and
- keep source, model, preview, and selection synchronized bidirectionally.

Acceptance criteria:

- a visual move results in a minimal, understandable PSL edit;
- undo/redo treats each manipulation as a coherent operation;
- visual editing never silently destroys expressions it cannot rewrite;
- text and visual selection stay synchronized; and
- hand-authored decks remain fully editable as text.

Important constraint: not every computed PSL element can be freely dragged. The UI must distinguish directly editable literals from geometry derived through variables, loops, members, or expressions.

### Phase 7: Remote presentation control

Goal: allow a phone or another browser to control a presentation safely and reliably.

Deliverables:

- define a small presentation command/state protocol;
- support next, previous, slide jump, blackout, overview/status, and optional notes/timer data;
- pair a controller using a short-lived code or QR code;
- authenticate control commands and prevent accidental cross-session control;
- decide between local-network, hosted relay, WebSocket, WebRTC, or multiple transports;
- handle reconnects and presenter/audience state synchronization; and
- provide an installable web-app experience before considering native phone applications.

Acceptance criteria:

- a phone browser can pair and control a running presentation;
- commands are acknowledged and state remains synchronized after reconnect;
- unauthorized devices cannot control the session;
- the presentation continues locally if the controller disconnects; and
- the transport is isolated behind an adapter rather than coupled to the player.

### Phase 8: Live collaboration

Goal: support simultaneous editing while keeping PSL readable and recoverable.

Deliverables:

- define stable collaborative document operations and presence state;
- evaluate CRDT technology such as Yjs against the PSL/source-editing model;
- synchronize text edits, selections, cursors, and selected slides;
- integrate visual-editor transactions without losing concurrent text changes;
- define document/session identity, persistence, authentication, and sharing;
- handle offline edits and reconnection; and
- retain local export and recovery independent of the collaboration service.

Acceptance criteria:

- two authors can concurrently edit without losing accepted changes;
- text and visual operations converge to the same document;
- local checkpoints/export remain available;
- server or relay failure does not corrupt the local deck; and
- collaboration code is optional for offline/local SlideDown use.

## 7. Cross-cutting requirements

Every phase should consider:

- **Compatibility:** existing decks and published URLs.
- **Accessibility:** keyboard operation, focus management, semantic dialogs/menus, contrast, and reduced motion.
- **Security:** remote PSL, URL schemes, embeds, imported files, collaboration, and controller pairing.
- **Offline behavior:** graceful fallback when CDN assets or network services are unavailable.
- **Documentation:** built-in reference, sample deck, and authoring guide remain synchronized.
- **Testing:** unit, integration, browser, and visual regression coverage appropriate to the change.
- **Print parity:** fully advanced printed slides should match the live renderer where media limitations allow.
- **Observability:** diagnostics and performance measurements should be available without exposing deck content externally.

## 8. C++/WebAssembly decision framework

No phase currently requires C++ or WebAssembly. The architecture should make a future language-core implementation possible through a coarse interface such as:

```text
parseAndValidate(PSL source, options) -> document model + diagnostics + dependency data
```

Good candidates for a C++ core are:

- lexical and syntactic parsing;
- expression evaluation;
- source-range diagnostics;
- typed document/model construction;
- unit conversion and geometric calculations;
- native unit tests, fuzzing, and command-line validation tools.

Poor candidates are:

- DOM construction and updates;
- browser animation and media control;
- CodeMirror/Monaco integration;
- local browser storage and dialogs;
- networking, collaboration UI, and device pairing.

The first formal decision checkpoint is after Phase 1, when a clean core boundary exists. The second is during Phase 4, after profiling representative decks.

Adopt C++/Wasm if several of the following are true:

- the parser/model has become complex enough that C++ materially improves correctness or development velocity;
- native command-line tooling or reuse outside the browser is valuable;
- fuzzing and typed invariants are easier to maintain in the shared C++ core;
- measured parsing/model construction is a meaningful responsiveness bottleneck;
- the serialized model boundary can remain coarse and stable; and
- build, debugging, and packaging costs are acceptable.

Remain with JavaScript/TypeScript if:

- DOM/rendering work dominates performance;
- language-service integration benefits from direct access to browser/editor data structures;
- model marshalling would be large or highly granular;
- the additional build artifact undermines portability without enough benefit; or
- a typed TypeScript core provides sufficient maintainability and performance.

If Wasm is adopted, avoid per-token or per-element calls across the boundary. Send source/options in one operation and return a complete model or compact serialized representation. Native and Wasm builds should share the same language conformance tests.

## 9. Open design decisions

These questions should remain visible until explicitly resolved:

1. Is `.psl` the sole canonical extension, should `.sd` remain supported, or should both be first-class?
2. Should ordinary rectangles and text boxes default to square corners, or should only explicit `round` styling control this?
3. Is `{z=number}` plus `front/back/forward/backward` the preferred layering vocabulary?
4. How should table row, column, and cell-specific styling be represented without making Markdown tables unreadable?
5. Which module/build tooling best preserves a simple single-file release?
6. Should the development core use JavaScript with JSDoc types, TypeScript, or eventually C++/Wasm?
7. What is the trust model for remote decks, links, embeds, and imported templates?
8. How should stable item identity work across edits, loops, imports, and generated `!all` content?
9. When visual editing encounters computed geometry, should it edit variables, replace the expression with a literal, or decline the operation?
10. Which performance budgets match real intended deck sizes and hardware?
11. Should remote control require a hosted relay, or is local-network-only operation sufficient initially?
12. What collaboration hosting and identity model is acceptable for the project?

## 10. Phase status

Update this table when work begins or a phase is accepted.

| Phase | Status | Decision/implementation record |
|:--|:--|:--|
| 0. Baseline, tests, stabilization | Proposed | |
| 1. Language core, units, diagnostics | Proposed | |
| 2. Ordered scene graph and layering | Proposed | |
| 3. Properties, animation, tables | Proposed | |
| 4. Incremental rendering/performance | Proposed | |
| 5. Context-aware editor | Future | |
| 6. Live visual editing | Future | |
| 7. Remote presentation control | Future | |
| 8. Live collaboration | Future | |

Suggested status values: `Proposed`, `In progress`, `Blocked`, `Implemented`, and `Accepted`.

## 11. How to start a phase in a new Codex task

Attach or reference this document and use a request like:

> Read `SLIDEDOWN_DESIGN.md` and inspect the current implementation. Start Phase N. First reconcile the phase description with the current code and report any decisions that genuinely require my input. Then implement the smallest complete vertical slice, add or update tests and documentation, verify it, and update the phase status and decision record in the design document.

For narrower work:

> Read `SLIDEDOWN_DESIGN.md`. Within Phase N, implement only [deliverable]. Preserve the other phase requirements and record any design decision or scope change in the document.

At the end of every phase task, the handoff should state:

- what behavior changed;
- which files changed;
- tests and manual checks performed;
- compatibility or migration concerns;
- unresolved decisions or follow-up work; and
- whether the phase status or acceptance criteria changed.

## 12. Decision log

Record decisions that affect later phases here. Keep entries concise and link to a more detailed design or commit if one exists.

| Date | Decision | Reason and consequences |
|:--|:--|:--|
| 2026-07-30 | Retain a single portable HTML release as a product goal; allow modular development sources and a build step. | Improves maintainability without giving up static hosting or local portability. |
| 2026-07-30 | Keep C++/WebAssembly open as an option for the pure language core; do not commit before a stable interface and profiling data exist. | Current likely bottlenecks include DOM and thumbnail work that Wasm would not solve. |
| 2026-07-30 | Treat PSL text as the source of truth for future visual and collaborative editing. | Prevents incompatible text and visual document formats. |

## 13. Change log for this document

- **2026-07-30:** Initial roadmap created from the first code review, authoring feedback, and discussion of possible C++/WebAssembly use.
