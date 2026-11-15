# Contributing

By submitting your own contribution you agree that it is licensed under
CC BY-SA 4.0, and — for original application code — additionally under MIT,
at the recipient's choice. See LICENSE for the scope of these grants.

Do not offer third-party game text or character fixtures under MIT. Game-content
contributions, including published examples in `test/golden/`, remain CC BY-SA
4.0 even when embedded in code or test files. Preserve third-party notices and
identify copied or adapted material separately from original implementation.
Contributing to this repository is distinct from privately using the app:
players' records are not contributions merely because the app creates or saves them.

This matters more here than in most projects: the data in this repository is
derived from Atlas Games' copyrighted text under a ShareAlike license. Clean
provenance on every contribution is what keeps the whole repository
distributable.

## Rules for data contributions

1. **Cite the book.** Every record needs a `source` with the book title and
   year. Records without provenance will not be merged.
2. **Mark what you changed.** Set `adaptation` honestly: `verbatim`,
   `abridged`, `restructured`, or `original`.
3. **Only licensed books.** Check the Atlas releases list before ingesting a
   new title. A few older books are not covered.
4. **No artwork, maps, trade dress, or logos.** Text only.
5. **Prefer extraction to transcription.** If a value can be parsed out of the
   corpus, write a parser rather than typing it in. Typos in a rules table are
   much harder to find than bugs in a parser.
6. **Original content is welcome** — new grogs, beasts, and covenants to fill
   gaps in published coverage. Mark it `"adaptation": "original"` with this
   project as the source, and say in the `summary` what gap it fills.

## Rules for code contributions

Extractors should be idempotent and should warn rather than guess. If a heading
does not parse, record a warning; do not silently drop it or invent a default.
