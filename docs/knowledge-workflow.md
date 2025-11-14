# Knowledge Crawl Workflow

## Configure the sources

1. Edit `knowledge/sources.json`.
   - The repo includes a single sample entry (`new-students-admissions`) pointing to several admissions URLs. Duplicate that object to add your own.
   - Fields:
     - `id`: unique handle for targeting runs.
     - `title`: appears at the top of the generated Markdown.
     - `output`: relative path to the Markdown file you want to populate.
     - `urls`: list of BYUI pages to include (add as many as you want).
     - `pathFragment` *(optional)*: ensures links include a specific path snippet (e.g., `/international-services/`).

## Refresh locally

1. Install dependencies once: `python -m pip install -r requirements.txt`
2. Run `npm run crawl` to fetch and regenerate every configured document.
   - Use `npm run crawl -- --document overview` to refresh a single document by `id` or output filename.
3. Commit the updated markdown plus `knowledge/manifest.json`.

Each markdown file receives only the rich-text body of the URLs you specified, so you control exactly where content lands and avoid duplicate boilerplate.

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

Hook your chatbot backend to read whichever markdown files you need (or the manifest) and you’ll always serve the latest curated knowledge.*** End Patch
