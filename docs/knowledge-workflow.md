# Knowledge Crawl Workflow

## Configure the sources

1. Edit `knowledge/sources.json`.
   - Duplicate the sample entry to add more documents.
   - Fields:
     - `id`: unique handle for targeting runs (e.g., `current-student`).
     - `title`: shown at the top of the generated markdown file.
     - `output`: relative path to the markdown file you want to populate.
     - `urls`: list of BYU–Idaho pages to include.
     - `pathFragment` *(optional)*: only allow URLs containing this snippet (e.g., `/international-services/`).
     - `category` *(optional)*: used by the chatbot dropdown to filter documents.

## Refresh locally

1. Install dependencies once: `python -m pip install -r requirements.txt`
2. Run `npm run crawl` to regenerate every configured document.
   - Target a single document with `npm run crawl -- --document current-student`.
3. Commit the updated markdown files plus `knowledge/manifest.json`.

Each markdown file only includes the rich-text body from URLs you specify, so you control what content ships to the chatbot.

## Optional GitHub Actions automation

```yaml
name: Refresh knowledge

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  crawl:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: python -m pip install -r requirements.txt
      - run: python scripts/crawl_byui.py
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: refresh international services knowledge"
```

Hook your chatbot backend to whichever markdown files you need (or parse `knowledge/manifest.json`) and you'll always serve the freshest curated knowledge.

## Gemini response guidelines

The backend sends `knowledge/gemini-guidelines.md` to Gemini as its system prompt. Update that file whenever you want to adjust tone, citation expectations, or closing language, but keep the guidance about citing the supplied knowledge so answers stay grounded.
