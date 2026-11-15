#!/bin/sh
# Full rebuild: extract from the corpus, apply effects and errata, regenerate reports.
#
# Usage:  ./build.sh [path-to-corpus/reviewed]
#     or: ARS_CORPUS=/path/to/corpus/reviewed ./build.sh
#
# The corpus is the community transcription of the Open License text and is
# not vendored here. Clone it OUTSIDE this repository (it is 123 MB and would
# otherwise end up published with the site):
#
#   git clone --depth 1 https://github.com/OriginalMadman/Ars-Magica-Open-License.git ~/Sites/ars-corpus
#   ./build.sh ~/Sites/ars-corpus/reviewed
set -e
cd "$(dirname "$0")"

CORPUS="${1:-${ARS_CORPUS:-../corpus/reviewed}}"
CORE="$CORPUS/Ars Magica - Definitive Edition (Core Rules).md"

if [ ! -f "$CORE" ]; then
  echo "Corpus not found at: $CORPUS" >&2
  echo >&2
  echo "Clone it somewhere outside this repository, then pass the path:" >&2
  echo "  git clone --depth 1 https://github.com/OriginalMadman/Ars-Magica-Open-License.git ~/Sites/ars-corpus" >&2
  echo "  ./build.sh ~/Sites/ars-corpus/reviewed" >&2
  echo >&2
  echo "Or set ARS_CORPUS in your shell profile so ./build.sh works bare." >&2
  exit 1
fi

echo "corpus: $CORPUS"
echo "extract:"
python3 tools/ingest/virtues_flaws.py "$CORPUS" data
python3 tools/ingest/core_tables.py    "$CORPUS" data

echo "effects and errata:"
python3 tools/ingest/effects.py data
python3 tools/ingest/errata.py data

echo "reports:"
python3 tools/attribution/generate.py .
python3 tools/errata/report.py .
