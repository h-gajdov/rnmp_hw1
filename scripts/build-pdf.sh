#!/usr/bin/env bash
# Builds docs/DOCUMENTATION.pdf from docs/DOCUMENTATION.md:
# Markdown -> HTML (python-markdown via uvx) -> PDF (headless Google Chrome / Chromium).
#   scripts/build-pdf.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DOCS="$PWD/docs"
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"
WORK="$(mktemp -d)"
uri() { python3 -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).as_uri())' "$1"; }
trap 'rm -rf "$WORK"' EXIT

body="$(uvx --quiet --from 'markdown==3.7' markdown_py -x tables -x fenced_code -x toc -x attr_list -o html \
    "$DOCS/DOCUMENTATION.md")"

cat > "$WORK/doc.html" <<EOF
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="$(uri "$DOCS")/">
<title>NYC traffic incident detection with Kafka and Flink</title>
<style>
  @page { size: A4; margin: 16mm 16mm 16mm 16mm; }
  body { font-family: "DejaVu Sans", "Helvetica Neue", Arial, sans-serif; font-size: 9.6pt; line-height: 1.42;
         color: #1d1d1d; }
  h1 { font-size: 17pt; margin: 0 0 2pt; color: #b35900; }
  h2 { font-size: 12.5pt; margin: 14pt 0 4pt; padding-bottom: 2pt; border-bottom: 1.5px solid #e07b00;
       color: #b35900; break-after: avoid; }
  h3 { font-size: 10.5pt; margin: 9pt 0 3pt; break-after: avoid; }
  p { margin: 3pt 0 5pt; }
  ul, ol { margin: 2pt 0 5pt; padding-left: 16pt; }
  li { margin: 1pt 0; }
  code { font-family: "DejaVu Sans Mono", Menlo, monospace; font-size: 8.4pt; background: #f2f2f2;
         padding: 0 2px; border-radius: 2px; }
  pre { background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; padding: 5pt 7pt;
        white-space: pre-wrap; word-break: break-word; break-inside: avoid; margin: 4pt 0 6pt; }
  pre code { background: none; padding: 0; font-size: 7.9pt; line-height: 1.35; }
  table { border-collapse: collapse; margin: 4pt 0 7pt; width: 100%; break-inside: avoid; font-size: 8.8pt; }
  th, td { border: 1px solid #cfcfcf; padding: 2.5pt 5pt; text-align: left; vertical-align: top; }
  th { background: #f3ece4; }
  td code { word-break: break-word; }
  img { max-width: 100%; display: block; margin: 6pt auto; break-inside: avoid; }
  .subtitle { color: #555; margin-bottom: 8pt; }
  .caption { text-align: center; color: #555; font-size: 8.5pt; margin-top: -2pt; }
  .page-break { break-before: page; }
  a { color: #0b5cad; text-decoration: none; }
</style>
</head>
<body>
$body
</body>
</html>
EOF

"$CHROME" --headless --disable-gpu --no-sandbox --allow-file-access-from-files \
    --no-pdf-header-footer --print-to-pdf-no-header \
    --print-to-pdf="$DOCS/DOCUMENTATION.pdf" "$(uri "$WORK/doc.html")" 2>/dev/null
echo "wrote docs/DOCUMENTATION.pdf"
