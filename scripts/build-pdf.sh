#!/usr/bin/env bash
# Build the English and Macedonian PDFs from their Markdown sources.
set -euo pipefail
cd "$(dirname "$0")/.."

DOCS="$PWD/docs"
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
uri() { python3 -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).as_uri())' "$1"; }

if python3 -c 'import markdown' 2>/dev/null; then
    markdown=(python3 -m markdown)
else
    markdown=(uvx --quiet --from 'markdown==3.7' markdown_py)
fi

build() {
    local name="$1" language="$2" title="$3"
    local html="$WORK/$name.html" body
    body="$("${markdown[@]}" -x fenced_code -o html "$DOCS/$name.md")"

    cat > "$html" <<HTML
<!doctype html>
<html lang="$language">
<head>
<meta charset="utf-8">
<base href="$(uri "$DOCS")/">
<title>$title</title>
<style>
  @page {
    size: A4;
    margin: 16mm 17mm 17mm;
    @bottom-center { content: counter(page); font: 9pt "DejaVu Sans", sans-serif; color: #475569; }
  }
  body { font: 10.2pt/1.4 "DejaVu Sans", sans-serif; color: #18212b; }
  h1, h2, h3 { color: #15283c; line-height: 1.15; break-after: avoid; }
  h1 { font-size: 21pt; margin: 0 0 7pt; letter-spacing: -0.4pt; }
  h2 { font-size: 14pt; margin: 12pt 0 6pt; }
  h3 { font-size: 11pt; margin: 9pt 0 4pt; }
  p { margin: 0 0 6pt; orphans: 2; widows: 2; }
  code { font: 0.87em "DejaVu Sans Mono", monospace; }
  pre {
    font: 9pt/1.38 "DejaVu Sans Mono", monospace; break-inside: avoid;
    background: #f2f5f8; border: 1px solid #d9e1e9; margin: 4pt 0 7pt; padding: 7pt 9pt;
    white-space: pre-wrap;
  }
  pre code { font: inherit; }
  p:has(> img) { break-inside: avoid; break-after: avoid; margin: 7pt 0 3pt; }
  img { display: block; max-width: 100%; height: auto; margin: auto; }
  img[src="architecture.svg"] { width: 155mm; }
  .caption { text-align: center; color: #475569; font-size: 8.5pt; }
  .page-break { break-before: page; }
  .page-break + h2 { margin-top: 0; }
  a { color: #134f7d; text-decoration: underline; }
</style>
</head>
<body>
$body
</body>
</html>
HTML

    "$CHROME" --headless --disable-gpu --no-sandbox --disable-breakpad --disable-crash-reporter \
        --user-data-dir="$WORK/chrome" --allow-file-access-from-files --no-pdf-header-footer \
        --print-to-pdf="$WORK/$name.pdf" "$(uri "$html")"
    mv "$WORK/$name.pdf" "$DOCS/$name.pdf"
    printf 'Wrote docs/%s.pdf\n' "$name"
}

build DOCUMENTATION en 'Homework 1 - NYC traffic incident detection'
build DOCUMENTATION.mk mk 'Домашна задача 1 - Детекција на сообраќајни инциденти во Њујорк'
