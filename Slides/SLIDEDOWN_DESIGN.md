# SlideDown Design and Development Roadmap

Status: Draft for review  
Last updated: 2026-09-20
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

The long-term product should support five complementary ways of working:

1. Writing PSL directly in a capable, context-aware editor.
2. Editing PSL in VS Code with its native multi-cursor and navigation tools while a synchronized SlideDown preview shows the slide at the active cursor.
3. Visually arranging and editing the same scene without abandoning the text representation.
4. Collaborating on a deck with other authors.
5. Presenting from a browser while controlling the show from another device.

The plain-text deck remains the source of truth. Visual tools should edit that source through a structured document model rather than create a separate proprietary representation.

The immediate product priority is writing course talks efficiently from local files in VS Code. A capable browser editor follows directly after that. Syntax colors, visible color swatches, line numbers, completion, and multiple cursors are near-term authoring requirements. The full language-core redesign and new PSL features must not delay this workflow.

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

The application remains one portable HTML file containing CSS, markup, PSL parsing, rendering, animation, persistence, dialogs, imports, a sample deck, and PowerPoint conversion.

Implemented foundations include:

- a locally packaged VS Code companion (`vscode/`, version 0.2.0) with unsaved preview, context-aware PSL assistance, navigation, mapped diagnostics, and offline preview assets;
- Node parser checks, real-browser regression tests, storage/OAuth mocks, and a parser benchmark; see [tests/README.md](tests/README.md) for setup and commands;
- browser autosave, checkpoints, named documents, recovery, and protection of explicitly saved sample-content decks;
- Dropbox connection, open/save/copy/history, revision conflict handling, and relative linked resources; deployment configuration is documented in [DROPBOX.md](DROPBOX.md);
- File submenus for Dropbox and Local Storage, with storage retry available after failures;
- resolved preview invalidation for shared content and imports, deterministic cross-type layering, named styles, tag selections, and shared selection transforms;
- presentation, presenter notes, overview, print preparation, and remote decks;
- persistent soft wrapping and high-contrast text selection in the browser editor; and
- URL-scheme validation, sandboxed embeds, and inline-content regression coverage.

Remaining work includes:

- product review of VS Code 0.2.0 and the browser editor replacement, reusing the shared language services;
- a typed language core, explicit units, and structured source-range diagnostics;
- completion of the code/math delimiter conformance work;
- product review of the Phase 3 property schema and creation-versus-animation audit;
- reversible image cropping; Phase 3 table styling is implemented;
- measured incremental parsing/rendering and thumbnail virtualization; and
- language composition, visual editing, remote control, and collaboration.

These are implementation records, not declarations that every phase's acceptance criteria have been met. In particular, the latest Dropbox integration does not complete Phase 1 or Phase 4.

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
   +--> VS Code side-by-side current-slide preview
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
- `language` -- shared PSL vocabulary, source context, symbols, completion, hover, and color information, with editor-specific adapters;
- `integration/vscode` -- optional VS Code document/selection bridge and preview packaging;
- `import/pptx` -- PowerPoint conversion; and
- `build` -- construction of the portable HTML artifact.

Module extraction should be incremental. A large rewrite that changes every subsystem simultaneously is specifically out of scope.

For the first VS Code release, extract or package only the existing parser/renderer code and dependencies needed by the preview. Provide a host adapter for source text, primary cursor, resource resolution, diagnostics, and disposal. The preview must not initialize browser storage, Dropbox, or textarea event handlers. Browser and extension builds must consume the same maintained sources; generated bundles may differ. The current `splitSlides`, `slideSectionEndAt`, `PROPERTY_SCHEMA`, and color-detection helpers are starting points, not promises that they already form a clean standalone API. In particular, existing color resolution uses the DOM and needs an appropriate host boundary.

Keep language-service results independent of VS Code and the browser editor. Start with direct extension providers and a small shared JavaScript/TypeScript library; a language server is optional later. Basic highlighting and completion can use a tolerant source-context scanner and the existing vocabulary without waiting for the fully typed model. Add exact source ranges incrementally; retain preview warnings when a diagnostic cannot yet be mapped reliably. Never invent a precise error location.

## 6. Development phases

### Delivery priority as of 2026-09-19

Phase numbers identify work areas and preserve earlier references; they are not execution order. This priority order supersedes the earlier recommendation to finish Phase 1 first.

| Order | Milestone | Usable result and scope boundary |
|:--|:--|:--|
| 1 | Phase 5A.1: Local VS Code authoring — accepted | Install a local VSIX, open a course deck, edit with syntax colors and initial completion, and see unsaved edits in an adjacent preview. Local images/imports and bundled math/code rendering are part of this first usable release. Native line numbers, multiple cursors, wrap, search/replace, undo, and Git remain available. |
| 2 | Phase 5A.2: Rich PSL assistance — implemented, awaiting review | Add context-aware symbol/property completion, color swatches and picker edits, hover help, folding, slide navigation, and reliable diagnostics. Basic color swatches ship in 5A.1; broader palette and color-expression support grows here. |
| 3 | Phase 5B.1–5B.2: Browser editor replacement | Replace the textarea with a mature editor, first delivering editing essentials and then reusing the PSL assistance from VS Code. Preserve preview synchronization, browser documents, recovery, and color tools. |
| 4 | Remaining Phase 1 and Phase 4 work | Complete typed values, explicit units, diagnostic coverage, dependency-aware rendering, and thumbnail virtualization. Pull forward individual correctness or performance fixes when they affect the authoring milestones. |
| 5 | Phase 1B and Phase 3B | Resume language composition and reversible image cropping after the core authoring workflow is usable, prioritizing concrete needs from course decks. |
| 6 | Phases 6–8 | Visual editing, remote presentation control, and collaboration remain later work. |

The first milestone is a practical daily-writing release, not merely an extension demonstration. Test it on a representative course talk with code, math, reveals, and local assets, alongside automated fixtures. Local editing and preview must work without uploading the deck or signing into a service. Required preview libraries and math fonts are packaged; intentionally remote images, imports, and embeds still require network access, and local font fallbacks may differ from online fonts.

Only the shared-preview boundary, local resource handling, and minimal language metadata are prerequisites for 5A.1. Completion of Phase 1, Phase 4, a C++/Wasm decision, and product acceptance of all previously implemented phases are not prerequisites. Review existing functionality while verifying the authoring releases. The known inline code/math delimiter bug remains tracked and should be fixed promptly if exposed by the course-deck fixtures; it is not a reason to postpone the integration for the rest of Phase 1.

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

Scheduling: remaining Phase 1 work follows the initial VS Code and browser authoring milestones. Deliver the small metadata, source mapping, and parser fixes those milestones require within their scope, recording which Phase 1 requirements they satisfy. Full typed-model conversion, generalized units, and stable scene identity are not gates for initial highlighting, completion, or preview.

Deliverables:

- introduce structured diagnostics with severity, code, message, source range, slide, and optional suggestion;
- give parsed items stable identities for the duration of an editing session;
- define a typed schema for element kinds, styles, properties, animation operations, steps, and transitions;
- centralize length parsing and conversion;
- support explicit `px` and `%` units anywhere a length or coordinate is accepted;
- retain existing bare-number behavior for backward compatibility;
- allow explicit units to be mixed, such as `@(320px, 50%)` or `(40%, 180px)`;
- validate unknown style keys and property/element compatibility;
- replace sequential whole-string regular expressions for protected inline constructs with a delimiter-aware, source-order scanner for code spans, inline/display math, and escaped delimiters;
- define code/math delimiter precedence so backticks inside math remain math content, dollar signs inside code remain code content, and an unmatched delimiter cannot consume later constructs or intervening prose;
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
- repeated inline equations containing TeX quote backticks parse independently without losing or restyling the prose between them;
- conformance fixtures cover code containing dollar signs, math containing backticks, adjacent/mixed code and math, escaped delimiters, and unmatched delimiters;
- the renderer consumes typed values rather than parsing raw strings repeatedly;
- diagnostics can be rendered both in the current warning panel and by a future code editor; and
- backward-compatibility fixtures render equivalently.

Non-goals:

- visual dragging;
- collaborative document operations; and
- deciding that the core must be C++.

### Phase 1B: Language composition, collections, and silent computation

Goal: make repeated and computed slide construction concise without turning PSL into an unrestricted general-purpose programming language.

Deliverables:

- add array values with literals, indexing, length, and deterministic iteration;
- allow `!foreach` to iterate arrays and the characters of a string, in addition to its existing numeric-range form;
- define simple user functions for reusable value computations;
- define simple procedures/macros for reusable PSL-producing blocks, including parameters and local scope;
- add an explicit non-rendering statement form for assignment and mathematical computation, so authors do not need to hide or discard printed `${…}` results;
- define lexical scope, argument evaluation, return behavior, name resolution, and interaction with deck variables;
- impose recursion/depth and total-expansion limits so malformed functions or procedures cannot hang parsing;
- retain useful source ranges through procedure expansion so diagnostics identify both the call site and definition; and
- expose collection, function, and procedure symbols to future editor completion and hover services.

Illustrative syntax, subject to review:

```text
!let letters = chars("HELLO")
!let total = 0

!function square(x) = x * x

!procedure letter_box(letter, index)
  [box_${index}] !textbox (${index * 140}, 200) (120, 90) ${letter}
  !let total = total + square(index)
!endprocedure

!foreach letter, index in letters
  !call letter_box(letter, index)
!endfor
```

The final syntax need not use `!let`, `!function`, or `!procedure`, but silent computation must be visibly distinct from text interpolation that intentionally prints a result.

Acceptance criteria:

- arrays can contain numbers and strings and can drive deterministic loops;
- iterating a string can create one scene item per character without manual indexing;
- functions return values without emitting slide content;
- procedures expand reusable PSL while respecting local variables and source diagnostics;
- silent assignments and computations produce no scene item or stray text;
- expansion and recursion limits fail with actionable diagnostics; and
- existing `${…}`, `!set`, and numeric `!foreach` decks remain compatible.

Open design points:

- whether arrays may contain only primitive values initially or also nested arrays and structured values;
- whether string iteration should be built into `!foreach` or exposed through a `chars()` function;
- whether procedure expansion is macro-like source generation or typed model construction; and
- whether silent assignment extends `!set` or uses a distinct statement such as `!let`/`!eval`.

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
- rescan the then-current creation-time properties, geometry, content, and media options so every meaningful capability has a corresponding animated or discrete step-time change, or is explicitly classified and documented as intentionally static;
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

- a fresh creation-versus-animation coverage audit is completed against the implementation as it exists during Phase 3, rather than relying on an earlier fixed inventory;
- the same property vocabulary is used by initial styles and animations;
- interpolated colors and lengths reach exact final values;
- unsupported combinations produce diagnostics instead of no-ops;
- rectangle corner behavior matches the documented decision;
- an unstyled Markdown table is presentation-ready and visibly structured; and
- table styling works consistently in preview, thumbnails, presentation, and print.

### Phase 3B: Reversible image fitting and cropping

Goal: let authors frame images inside SlideDown without destructively cropping the source file beforehand.

Deliverables:

- add a rectangular image viewport whose width and height are independent of the source image's aspect ratio;
- support `contain`, `cover`, and explicit crop-region behavior;
- allow a focal point or position to control which part of a covered image remains visible;
- define an explicit source-relative crop rectangle for precise left/top/width/height cropping;
- keep cropping reversible and non-destructive: PSL stores framing parameters and never rewrites the source bitmap;
- apply identical framing in the main preview, thumbnails, presentation, presenter view, and print;
- preserve clipping and crop state through reveal, move, size, scale, rotate, and layer operations;
- define whether crop position/region becomes animatable under the shared property schema; and
- add crop handles to Phase 6 visual editing once the textual behavior is stable.

Illustrative syntax, subject to review:

```text
{w=42%, h=36%, fit=cover, focus=(65%,30%)} ![speaker](portrait.jpg)
{w=520px, h=300px, crop=(10%,5%,75%,80%)} ![detail](figure.png)
```

Acceptance criteria:

- authors can crop and reframe an image without modifying its file;
- crop coordinates are stable across preview, presentation, thumbnails, and print;
- `contain` never clips, while `cover` fills the requested viewport predictably;
- invalid or empty crop regions produce a source-local diagnostic; and
- legacy images without crop/fitting properties render unchanged.

Open design points:

- whether `crop=(x,y,w,h)` uses source-image percentages exclusively or also accepts source pixels;
- whether an explicit crop rectangle and `focus` may be combined; and
- which crop properties, if any, should animate in the first implementation.

### Phase 4: Incremental rendering and performance

Goal: scale editing and presentation to large decks, guided by measured authoring responsiveness.

Scheduling: measure responsiveness during Phases 5A and 5B and fix demonstrated blockers there. Completion of this entire phase is not a prerequisite for replacing the textarea or shipping VS Code support. Its larger caching and virtualization work follows the initial authoring releases.

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

### Phase 4A: Near-term textarea ergonomics

Goal: correct inexpensive editing pain points without building infrastructure that will be discarded when the textarea is replaced.

Deliverables:

- increase selected-text contrast substantially in both focused and inactive editor states;
- add a persistent text-wrap toggle for the current textarea;
- ensure wrapping does not break caret-to-slide synchronization, thumbnail navigation, color previews, or presenter-notes scrolling; and
- preserve native browser find and all current editing shortcuts.

Explicit deferrals:

- line numbers are deferred to Phase 5B because synchronizing a separate textarea gutter with wrapping, scrolling, and variable line heights would duplicate mature editor functionality;
- first-class search-and-replace is deferred to Phase 5B; and
- multiple cursors are not simulated on top of the native textarea.

Acceptance criteria:

- selected text is unmistakable against the editor background and meets the project's contrast expectations;
- the wrap preference survives reloads and is available from an obvious editor control;
- toggling wrap does not change source text or the selected slide; and
- the temporary improvements do not complicate removal of the textarea in Phase 5B.

### Phase 5A: Local VS Code authoring and synchronized preview

Goal: make local course-talk authoring the first new usable release, with VS Code's native editor, PSL language assistance, and a synchronized SlideDown preview.

Use a normal VS Code text editor plus an adjacent webview preview. VS Code supplies line numbers, multiple cursors, wrapping, search-and-replace, undo/redo, and ordinary file/Git workflows. The extension supplies PSL highlighting, completion, colors, navigation, and rendering. The primary selection controls the preview when multiple cursors exist. Desktop local workspaces are the first supported target.

#### 5A.1: First usable local release — accepted on 2026-09-20

Deliverables:

- create an optional extension for canonical `.psl` and legacy `.sd` files, with a locally installable VSIX and concise installation/update instructions;
- add **SlideDown: Open Preview** beside the active editor, and an obvious command to reveal it again;
- render unsaved document text; synchronize the selected slide and its current `...` reveal section with the primary cursor, matching the browser editor; selecting a slide from preview navigation shows it fully advanced;
- package the shared parser, renderer, and required preview assets, including math/code rendering and math fonts, without starting the browser application controller;
- resolve local images, media, and recursive `!import` paths relative to the declaring document, preserve cycle/error handling, and refresh when dependencies change; use open buffers for imported PSL files that have unsaved edits;
- establish an explicit document-URI/resource adapter using VS Code's workspace and webview APIs; handle spaces, nested directories, CRLF offsets, and missing files without assuming an HTTP-hosted deck;
- add PSL-aware syntax highlighting for directives, labels/tags, styles, variables/expressions, slide/reveal markers, Markdown text, code fences, and math;
- provide initial completion and snippets for common directives, animation verbs, property names, and enumerated values using the supported language vocabulary;
- show swatches for supported literal colors and allow undoable picker edits; preserve existing palette aliases unless an explicit edit replaces them;
- show current parser warnings in the preview; provide editor diagnostics only where a trustworthy source location is available;
- preserve preview state on hide/show, handle switching between multiple decks without mixing content or resources, and discard stale asynchronous results by document/version;
- keep the editor responsive with debounced preview updates and primary-cursor-only navigation; avoid reloading the entire webview for every edit; and
- add extension-host and webview tests plus a walkthrough using a representative local course talk.

Acceptance criteria:

- install the VSIX, open an existing course deck from disk, and edit with native line numbers, multiple cursors, search/replace, wrap, and undo;
- unsaved changes update the preview, and primary-cursor movement selects the correct slide/reveal section without saving or switching applications;
- syntax colors, initial directive/property suggestions, and literal color swatches work in that same first release;
- local images and nested imports resolve correctly, including unsaved imported PSL changes, missing dependencies, and filenames with spaces;
- a local fixture with text, math, code, and images renders with network disabled; remote-only content reports an understandable limitation;
- browser and VS Code preview share implementation and PSL regression fixtures, with consistent rendering and reveal behavior;
- switching documents, undoing edits, moving panels, and closing/reopening preview do not lose source changes or display another deck's content; and
- the release includes a documented path from editing the local source to presenting it with the existing browser player. Embedded slideshow playback/export commands may follow later; ordinary authoring does not depend on them.

#### 5A.2: Rich PSL assistance — implemented in 0.2.0, awaiting product review

Deliverables:

- complete labels, tags, named styles, variables, existing functions, and element members from the current document and resolved imports, with correct scope where known;
- filter properties and animation operations by known target kind and the shared schema; handle incomplete source gracefully;
- add hover documentation and examples from shared language metadata;
- extend swatches/color picking to supported palette references, inline color controls, table styles, and animation colors; avoid treating prose, code, or unresolved expressions as editable color literals;
- add slide outline/navigation, label definition/reference navigation, and folding for slides, code fences, and control blocks;
- map additional diagnostics to the Problems panel and editor ranges as source metadata becomes available; and
- strengthen fixtures for mixed Markdown, PSL, code, and math so highlighting and completion respect construct boundaries.

Acceptance criteria:

- after `!anim `, suggest available targets; after a known target, suggest supported operations; within a style block, suggest applicable properties and values;
- changing a label, variable, named style, or palette entry updates suggestions and color information without requiring a saved file;
- malformed or incomplete source does not freeze typing or flood the editor with misleading completions;
- color edits and inserted completions are ordinary undoable text edits, including predictable behavior with multiple selections; and
- language-service behavior is covered by shared fixtures that the browser editor can reuse.

Non-goals for these releases:

- replacing VS Code's native editor with a custom editor;
- porting browser document storage, Dropbox, or autosave UI into VS Code;
- requiring a complete typed parser, a language-server process, or a C++/Wasm rewrite;
- publishing to the VS Code Marketplace before the local extension is useful and tested; and
- supporting remote workspaces, Codespaces, or VS Code for the Web before local desktop authoring is reliable.

### Phase 5B: Capable browser text editor — next authoring priority

Goal: replace the textarea with a mature editor and bring the PSL assistance developed for VS Code into the browser application.

#### Editor choice and integration boundary

Use CodeMirror 6 as the provisional first candidate; validate it with a bounded integration trial before committing. Compare Monaco if the trial reveals material gaps. This is an engineering preference for a configurable editor inside the portable application, not a claim that compatibility or bundle size has already been measured. The choice must not delay VS Code work, which uses the native VS Code editor regardless.

Evaluate both candidates against line numbers, syntax highlighting, completion, multiple selections, keyboard accessibility, input-method composition, undo transactions, wrapping, search/replace, color decorations, startup cost, and offline/single-file packaging. Measure the resulting bundle and representative deck responsiveness. A shared editor brand is not required: reuse PSL language services and rendering through separate host adapters. Do not assume installing Monaco provides the VS Code extension's features automatically.

Replace direct textarea access through an editor adapter for text, selections/primary cursor, transactions, focus, visible position, and change notifications. Preserve browser document lifecycle, source insertion, color picking, presenter-notes navigation, and preview selection. Remove the temporary textarea geometry workarounds as their consumers migrate.

#### 5B.1: Editing essentials

- add line numbers, PSL syntax colors, persistent wrapping, first-class search/replace, multiple cursors/selections, bracket matching, and native editor undo/redo;
- retain high-contrast selections in focused/inactive states and visible keyboard focus;
- port color swatches and the existing picker through normal editor transactions;
- keep preview selection tied to the primary cursor, and define which toolbar/insertion actions apply to all selections versus the primary selection; and
- preserve local file opening/saving, browser autosave, document switching, recovery, checkpoints, Dropbox, and presenter-notes behavior.

#### 5B.2: Shared PSL assistance

- adapt the shared context-aware completion, hover help, symbols, folding/navigation, and trustworthy diagnostics from Phase 5A.2;
- provide inline diagnostic navigation without requiring a full preview redraw;
- ensure color suggestions/picker behavior use the same PSL vocabulary and palette semantics as VS Code; and
- make editor commands discoverable with tooltips/shortcuts and synchronize existing wrap/color controls with editor state.

Acceptance criteria:

- line numbers, syntax colors, completion, wrapping, search-and-replace, and multiple selections work together without corrupting PSL or preview synchronization;
- insertion, formatting, color edits, and undo preserve all intended selections and form coherent transactions;
- composition input, keyboard navigation, focus changes, and wrapped selection work reliably;
- file loading, saving, document switching, recovery, Dropbox, and presenter-notes regression checks still pass;
- shared completion/color/diagnostic fixtures pass through both VS Code and browser adapters;
- representative course decks and the 100-slide fixture remain comfortable to edit; record measured responsiveness and fix blockers without requiring all Phase 4 optimizations;
- the generated portable HTML still works locally with the editor assets available offline; and
- source remains ordinary PSL, with no editor-specific metadata required to present or export it.

Implementation references checked for this roadmap revision: [VS Code language extensions](https://code.visualstudio.com/api/language-extensions/overview), [programmatic language features including completion and colors](https://code.visualstudio.com/api/language-extensions/programmatic-language-features), [webview preview and resource APIs](https://code.visualstudio.com/api/extension-guides/webview), [CodeMirror system guide](https://codemirror.net/docs/guide/), and [Monaco project](https://github.com/microsoft/monaco-editor). These inform the proposed design; the integration and packaging checks above remain implementation work.

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
- **Shared-core parity:** companion tools such as the VS Code extension must consume the same PSL semantics and conformance fixtures as the browser application.

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
- VS Code extension-host and webview integration;
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

1. Resolved: `.psl` is canonical and `.sd` remains supported as a legacy extension, including in VS Code.
2. Resolved in Phase 3: retain 6px rectangle and 12px textbox defaults for compatibility; use round=0 for square corners.
3. Should a later phase add symbolic named layers on top of the implemented numeric `{z=number}` and `front/back/forward/backward` vocabulary?
4. Phase 3 supports whole-table, header/body, even-row, and column width/alignment controls; individual row/cell selectors remain a future design question.
5. Which module/build tooling best preserves a simple single-file release?
6. Should the development core use JavaScript with JSDoc types, TypeScript, or eventually C++/Wasm?
7. What is the trust model for remote decks, links, embeds, and imported templates?
8. How should stable item identity work across edits, loops, imports, and generated `!all` content?
9. When visual editing encounters computed geometry, should it edit variables, replace the expression with a literal, or decline the operation?
10. Which performance budgets match real intended deck sizes and hardware?
11. Should remote control require a hosted relay, or is local-network-only operation sufficient initially?
12. What collaboration hosting and identity model is acceptable for the project?
13. What declaration, call, return, and scoping syntax should user functions and PSL-producing procedures use?
14. Which collection types belong in the first array implementation, and should strings iterate directly or through `chars()`?
15. Should silent computation extend `!set` or use a visibly distinct statement such as `!let` or `!eval`?
16. Should image crop rectangles use source-relative percentages only, and which crop properties should animate?
17. Resolved for the first release: target local desktop VS Code workspaces. Remote workspaces and VS Code for the Web are later extensions of that scope.
18. Which minimal build layout can share parser/renderer code and bundled assets between `slidedown.html` and the VS Code webview? Resolve during 5A.1 without broad unrelated extraction.
19. Does the CodeMirror 6 integration trial meet the portable browser editor requirements, or does a measured gap justify Monaco?
20. Which remaining diagnostics and computed color expressions need deeper Phase 1 source metadata after the initial authoring releases?

## 10. Phase status

Update this table when work begins or a phase is accepted.

| Phase | Status | Decision/implementation record |
|:--|:--|:--|
| 0. Baseline, tests, stabilization | Implemented | 2026-07-30: Added Node/Playwright checks and a parser benchmark; fixed resolved-preview invalidation, numeric/animation diagnostics, recovery dirty state, missing styles, notice layout, extension support, and basic active-content hardening. 2026-09-07: Integrated Dropbox/storage regression coverage and corrected the obsolete saved-sample deletion expectation. `npm test` runs both suites; setup is in `tests/README.md`. Awaiting product review before `Accepted`. |
| 1. Language core, units, diagnostics | Proposed | Full phase follows initial authoring releases; pull forward the source metadata and correctness fixes needed by 5A/5B. Includes delimiter-aware code/math scanning. |
| 1B. Language composition and collections | Proposed | After initial authoring releases: arrays, string/collection loops, functions/procedures, and silent computation. |
| 2. Ordered scene graph and layering | Implemented | 2026-08-30: Mixed HTML and SVG items now receive deterministic source-order layers; `{z=…}` and discrete `z/front/back/forward/backward` operations work on labels and tag selections. Awaiting product review before `Accepted`. |
| 3. Properties, animation, tables | Implemented | 2026-09-08: Shared property schema and diagnostics, expanded HTML/table styling and animation, table border/header/body/column controls, and creation-versus-animation audit in `PHASE3_PROPERTY_AUDIT.md`. Preserved 6px rectangle / 12px textbox corners; round=0 is supported. First table scope excludes individual row/cell mutation. Awaiting product review. |
| 3B. Image fitting and cropping | Proposed | After initial authoring releases: reversible viewport, cover/contain, focal-point, and explicit crop behavior. |
| 4. Incremental rendering/performance | Proposed | Measure during 5A/5B and fix authoring blockers there; broader dependency caching and virtualization follow. |
| 4A. Near-term textarea ergonomics | Implemented | 2026-09-07: Persistent Wrap text control, explicit selection foreground/background, and browser-measured wrapped caret/color geometry. Line numbers, replace, and multiple cursors remain deferred to Phase 5B. Awaiting product review. |
| 5A. Local VS Code authoring and preview | Implemented | 2026-09-20: User accepted 5A.1. Version 0.2.0 implements 5A.2: parsed-scope completion, validator-filtered operations, imported definitions, hover, current-deck references, Outline/folding, palette-aware colors, and source-mapped line diagnostics. Awaiting review of 0.2.0; next authoring milestone is 5B.1. |
| 5B. Capable browser editor | Proposed | 2026-09-19: Follows 5A; promoted from future work. Trial CodeMirror 6, replace the textarea, and reuse PSL assistance; deliver colors, line numbers, completion, multiple cursors, and search/replace. |
| 6. Live visual editing | Future | |
| 7. Remote presentation control | Future | |
| 8. Live collaboration | Future | |

Suggested status values: `Proposed`, `In progress`, `Blocked`, `Implemented`, and `Accepted`.

## 11. How to start a phase in a new Codex task

VS Code 0.2.0 is built; installation and current limits are in `vscode/README.md`. The next implementation task should use this scope:

> Read `SLIDEDOWN_DESIGN.md`, `vscode/README.md`, and the shared services in `language/`. Start Phase 5B.1: conduct the bounded CodeMirror 6 integration trial, then replace the browser textarea through an editor adapter if the trial succeeds. Deliver line numbers, PSL syntax colors, wrapping, search/replace, multiple selections, coherent undo, and the existing color tools. Preserve document storage/recovery, Dropbox, preview and primary-cursor reveal synchronization, and presenter-notes navigation. Reuse the language services from VS Code rather than maintaining a new PSL vocabulary. Confirm offline/single-file packaging and representative deck responsiveness; keep the VS Code extension working. Update tests, guides, and phase status. Do not require full Phase 1 or Phase 4 completion.

For other work, attach or reference this document and use a request like:

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
| 2026-07-30 | Use `.psl` as the canonical deck extension and continue accepting `.sd` as a legacy extension. | Matches the authoring guide and saved filenames without making existing `.sd` decks harder to open. |
| 2026-07-30 | Treat remote PSL as data, allow only normal navigation schemes for links, and sandbox `!embed` frames without powerful device permissions. | Published decks remain useful while entity-obfuscated active schemes and implicit camera/microphone/clipboard grants are blocked. |
| 2026-08-30 | Use `!style name {…}` and `{$name, local=override}` for reusable styles, with left-to-right composition. | A typed directive is clearer than a generic alias and preserves predictable local overrides. |
| 2026-08-30 | Use `[label:tag1,tag2]`, `@tag` selectors, and timed `!tag add/remove` operations instead of persistent public group nodes. | Each animation resolves a temporary selection, enabling overlapping and changing membership without exposing transform hierarchy to authors. |
| 2026-08-30 | Tag selection scale and rotation are relative; tag `move` places the current bounding-box top-left. | Temporary selections have no stable absolute transform identity, while a top-left move anchor is predictable for precise layout. |
| 2026-08-30 | Simultaneous geometric selections must be disjoint or identical; identical selections may combine different transform channels. | Move-plus-scale-plus-rotate remains expressive, while partial overlaps avoid ambiguous transform composition and require an explicit `>>>` boundary. |
| 2026-08-30 | `!anim target text markdown` is always discrete and treats the full remainder of the line as content. | Text changes retain the scene item's identity and state while avoiding ambiguity when replacement text ends in duration-like content such as `0.5s`. |
| 2026-09-01 | Plan the VS Code integration as an optional side-by-side preview beside VS Code's standard text editor, not as a replacement custom editor. | Authors immediately retain native multiple cursors, line numbers, wrapping, search-and-replace, Git tools, and normal text-file behavior; the initial plan showed the active slide fully advanced (superseded by cursor/reveal synchronization; see 2026-09-19). |
| 2026-09-01 | Make selection contrast and textarea wrapping near-term improvements, but defer browser line numbers, first-class replace, and multiple cursors to the context-aware editor. | Contrast and wrapping are small durable wins; recreating mature editor infrastructure around a temporary textarea would add fragile code that Phase 5B would discard. |
| 2026-09-01 | Replace sequential code/math substitution regexes with a delimiter-aware, source-order inline scanner in Phase 1. | Construct boundaries must remain local: TeX backticks cannot open Markdown code spans, dollar signs in code cannot open math, and malformed delimiters cannot swallow later prose. |
| 2026-09-07 | Preserve saved documents even when their title and text match the sample. | Content equality is not evidence that a saved document is disposable. Untouched starters remain transient. |
| 2026-09-07 | Keep Dropbox deployment settings in the HTML and group storage actions by provider. | Site users connect their account without configuring an API app; local storage retry is available after failures. |
| 2026-09-07 | Store editor wrapping as a browser preference, defaulting to off; use soft wrapping and browser text geometry. | Source, selection, undo, and slide layout remain unchanged; wrapped navigation and color previews follow visual rows. Selection uses gold `#f2c66d` with dark `#10151c` text in focused and inactive states. |
| 2026-09-08 | Complete Phase 3 with a shared property registry and an explicit static-capability inventory. | Unsupported operations now warn instead of silently doing nothing. Chart composition, media identity, and table structure remain static for the reasons recorded in `PHASE3_PROPERTY_AUDIT.md`. |
| 2026-09-08 | Preserve rounded rectangle/textbox defaults and make table style scope explicit. | Existing decks retain appearance; round=0 is square. Table styling covers whole table, header/body, even-row fill, and column widths/alignment; per-cell mutation is deferred. |
| 2026-09-19 | Prioritize local VS Code authoring (5A.1/5A.2), then the browser editor replacement (5B), ahead of full Phase 1 and Phase 4 completion. | Regular course-talk writing is the immediate use case. Deliver only the core extraction, metadata, and targeted fixes needed by those milestones first. Earlier phase numbers no longer imply delivery order. |
| 2026-09-19 | Include syntax colors, completion, and color swatches in VS Code scope; share PSL assistance with the browser editor. | A preview alone does not meet the requested authoring experience. Native VS Code already supplies general text-editing operations. |
| 2026-09-19 | Trial CodeMirror 6 for the browser editor; use separate adapters for native VS Code and browser editing. | Editor selection is independent of the VS Code release. Confirm packaging, interactions, and performance before committing; evaluate Monaco if concrete gaps arise. |
| 2026-09-19 | Ship a local desktop VSIX before Marketplace or remote/web support; require local resources and packaged preview dependencies in the first usable milestone. | The result must support day-to-day course work without upload or sign-in. Preview follows the primary cursor's reveal section, superseding the older fully-advanced-only preview note. |

| 2026-09-19 | Build the first extension directly from the maintained HTML parser/renderer/CSS, with an optional resource adapter and a separate host controller. | Avoids a parser/renderer fork and keeps the portable browser application intact. Shared enum metadata now feeds initial completion; editor-neutral assistance lives in `language/psl.cjs`. |
| 2026-09-19 | Preserve import origins for media/backgrounds, allow quoted import paths with spaces, and detect cycles in the shared parser. | Local templates need predictable file-relative resources. The browser application receives the same behavior. Exact diagnostic ranges after expansion remain future work. |

| 2026-09-20 | Use the shared animation validator to filter completion, and keep language-service results independent of the VS Code API. | Prevents a second compatibility rule set and allows the browser editor to reuse the same services. |
| 2026-09-20 | Capture optional source maps during import expansion and report diagnostics at the original source line. | Includes nested imports and CRLF files without changing parser warning strings or rendering. Warnings with no reliable map remain preview-only. |
| 2026-09-20 | Include imported palette declarations in the document-wide palette and preserve aliases in the color picker unless explicitly replaced. | Swatches agree with preview/browser rendering; editing an imported palette updates unsaved consumers. |

## 13. Change log for this document

- **2026-07-30:** Initial roadmap created from the first code review, authoring feedback, and discussion of possible C++/WebAssembly use.
- **2026-07-30:** Recorded the implemented Phase 0 stabilization slice and its extension/security decisions; product acceptance remains pending review.
- **2026-08-30:** Recorded named styles, dynamic tag selections, collective transforms, unified animated properties, and ordered layering.
- **2026-08-30:** Added instantaneous Markdown text replacement for text-bearing scene items.
- **2026-09-01:** Added roadmap slices for arrays, string iteration, reusable functions/procedures, silent computation, reversible image cropping, near-term editor ergonomics, a synchronized VS Code preview, and the eventual browser editor's line numbers, wrapping, search-and-replace, and multiple selections.
- **2026-09-01:** Added a Phase 3 goal to rescan all then-current creation capabilities for animation or discrete step-time equivalents, without freezing the present detailed gap list into the roadmap.
- **2026-09-01:** Planned delimiter-aware inline code/math scanning and regression fixtures after repeated TeX quote notation exposed cross-equation backtick matching.

- **2026-09-07:** Reconciled the baseline with Dropbox/storage work, consolidated test instructions, replaced obsolete sample-deletion expectations with preservation coverage, and implemented Phase 4A wrapping and selection improvements.

Validation for the September 7 baseline/Phase 4A slice: `npm test` passes 61 parser/browser checks and 30 storage checks. Coverage includes clipping of File submenus, saved sample retention, wrap persistence, unchanged source/selection, wrapped color previews and navigation, and native undo across a wrap toggle. The wrapped editor and gold selection were also visually inspected in Chrome.

- **2026-09-08:** Implemented Phase 3 property validation, additional style animations, and table controls. Added `PHASE3_PROPERTY_AUDIT.md`, updated built-in help/sample and authoring guide, and added rendering/diagnostic regression coverage.

Phase 3 validation (2026-09-08): all 67 parser/browser checks and 30 storage checks pass. New coverage includes default and styled tables, continuous interpolation, discrete controls, source diagnostics, zero borders/corners, media boolean flags and opacity, size aliases, and consistent table rendering across preview/thumbnails/live/print. The built-in sample parses without warnings; the styled table was visually inspected in Chrome.

- **2026-09-09:** Corrected Phase 3 table wrapping: emergency word breaks no longer shrink automatic column minimum widths. The supplied regex reference table keeps Symbol on one line and fits at default settings. Regression checks cover automatic sizing and explicit 15%/85% column widths; all 68 parser/browser and 30 storage checks pass.

- **2026-09-10:** Restored emphasis around inline controls such as `**{{color=blue|Meeting Time}}**`. Generated tags are protected during emphasis parsing rather than splitting the text at tag boundaries. All 70 parser/browser and 30 storage checks pass, including the supplied course-information bullets, nesting, triple emphasis, code literals, and link-attribute protection.

- **2026-09-19:** Reprioritized the roadmap around local course-talk authoring. Added an explicit delivery order, expanded Phase 5A into a usable local VS Code release and richer PSL assistance, promoted Phase 5B to near-term work, specified a provisional CodeMirror 6 trial, and limited Phase 1/4 prerequisites to targeted authoring needs. Updated architecture boundaries, acceptance criteria, open decisions, status, and next-task handoff. This is a planning revision; no implementation or fresh runtime validation is claimed.

- **2026-09-19 (implementation):** Delivered the Phase 5A.1 local VS Code release in `vscode/`. The extension uses the native editor with syntax colors, initial completions/snippets, literal color swatches/picker edits, and an adjacent preview following unsaved text and the primary cursor's reveal section. It handles local/nested imports and unsaved imported buffers, multiple deck panels, dependency refresh, explicit HTTP base URLs, and preview serialization. Preview math/code assets are bundled. Updated the browser help/sample comments and authoring guide for local authoring and import behavior.

Validation: 71 main parser/browser checks and 30 storage/Dropbox checks pass; seven extension unit/grammar checks pass. The packaged browser preview was tested with network blocked for math, code, and local images/imports, CRLF cursor mapping, reveal navigation, rendered-slide reuse, and unsaved text; it also parsed/rendered the existing `ai_curriculum_retreat.psl` deck. A course-style compiler fixture was visually inspected. A synthetic 100-slide preview update took 23 ms including test messaging on this machine (a single observation, not a general performance budget). Real VS Code 1.124.2 host tests in an isolated temporary profile passed activation, completion, colors, multiple cursors, unsaved edits, undo, unsaved imports, two deck panels, and webview render acknowledgment. Packaging produces `vscode/slidedown-0.1.0.vsix` without installing into the normal editor profile or publishing.

Remaining acceptance/product review: try the release on the user's current course talks. Phase 5A.2 remains open for deeper symbol/import completion, hover/navigation, palette-aware color assistance, and editor diagnostics with reliable ranges. This release shows parser warnings in the preview; it does not claim exact Problems-panel locations, remote-workspace support, embedded slideshow playback, or browser-editor replacement. See `vscode/README.md` for install and local presentation instructions.

- **2026-09-20:** Implemented Phase 5A.2 and packaged VS Code 0.2.0. Added shared services for parsed-prefix variable/style/member completion, current-slide label/tag completion, operation compatibility checked by the playback validator, property/definition hover, imported definitions, current-deck references, slide Outline, folding, and literal/palette swatches. Editor Problems use optional original-file/line maps for imports and shared content. Imported palette declarations now work in both the extension and browser renderer. Language features operate without a preview panel and refresh after unsaved dependency edits. User feedback accepted the previous 5A.1 release.

Validation for 0.2.0: 14 language/import/grammar/source-map checks, packaged offline browser preview tests, 71 main browser/parser checks, and 30 storage/Dropbox checks pass. Real VS Code integration tests cover target filtering, imported definitions, hover, palette-safe picker choices, Outline/folding/references, unsaved imported palette updates, original-file diagnostics, native multi-selection text insertion/undo, and all prior preview scenarios. The packaged 100-slide fixture updated in 22 ms including test messaging on this machine; this remains a single measurement. Documentation records line-level diagnostics, literal declaration navigation, current-deck reference scope, conservative completion around unresolved/generated source, and limited CSS color-function support. 0.2.0 is implemented and awaits user review; the next milestone is the browser editor integration trial and Phase 5B.1.

- **2026-10-27:** Added `~~strikethrough~~` inline markup and discrete `!anim target textstyle` operations. Whole-item `bold`, `italic`, `strike`, and `underline` overrides accept `on`, `off`, or `reset`; `textstyle reset` clears all overrides. Off removes existing semantic markup or heading defaults (including browser-default link underlines). Overrides live on rendered items, persist through subsequent text replacement, and reset against the current content's inline markup and theme defaults; replay begins from the source. Targets match text replacement, including tag selections. Partial-text edits continue to use `text` replacement with inline markup. Style changes are instantaneous, with omitted duration or `0s`; continuous style interpolation is outside this change. Updated Insert Animation, built-in help/sample, authoring guides, shared completion, and VS Code grammar/preview coverage.

Validation for text styling: 76 parser/browser checks, 30 storage regressions, 14 extension language/grammar checks, and packaged offline preview tests pass. Coverage includes nested Markdown and protected code/link URLs, invalid style arguments/targets/durations, the Insert Animation dialog, tag-wide toggles, heading defaults, link underlines, per-style/all-style reset, text replacement persistence, clean replay, and intact offline KaTeX markup. A full-size local preview of adding and removing styles was visually inspected.
