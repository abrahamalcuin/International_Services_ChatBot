#!/usr/bin/env python3
"""Fetch configured BYU-Idaho International Services pages and store rich text into markdown docs."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
from pathlib import Path
from typing import Iterable, List, Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup, Tag

REPO_ROOT = Path(__file__).resolve().parents[1]
KNOWLEDGE_DIR = REPO_ROOT / "knowledge"
CONFIG_PATH = KNOWLEDGE_DIR / "sources.json"
MANIFEST_PATH = KNOWLEDGE_DIR / "manifest.json"

ALLOWED_HOST = "www.byui.edu"
USER_AGENT = "InternationalServicesCrawler/2.0 (+https://international-services-chatbot)"


class ConfigError(Exception):
  """Raised when the sources.json file is invalid."""


def load_config() -> list[dict]:
  if not CONFIG_PATH.exists():
    raise ConfigError(f"Missing configuration file: {CONFIG_PATH}")

  try:
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
  except json.JSONDecodeError as exc:
    raise ConfigError(f"Unable to parse {CONFIG_PATH}: {exc}") from exc

  documents = data.get("documents")
  if not isinstance(documents, list) or not documents:
    raise ConfigError("sources.json must contain a non-empty 'documents' list.")

  normalized: list[dict] = []
  for doc in documents:
    output = doc.get("output")
    urls = doc.get("urls")
    if not output or not isinstance(output, str):
      raise ConfigError("Each document needs an 'output' path.")
    if not urls or not all(isinstance(u, str) for u in urls):
      raise ConfigError(f"Document '{output}' requires a non-empty list of URL strings.")

    output_path = (REPO_ROOT / output).resolve()
    if not str(output_path).startswith(str(REPO_ROOT)):
      raise ConfigError(f"Output path '{output}' must live inside the repository.")

    doc_id = doc.get("id") or Path(output).stem
    normalized.append(
      {
        "id": doc_id,
        "title": doc.get("title") or Path(output).stem.replace("-", " ").title(),
        "output_rel": output,
        "output_path": output_path,
        "urls": list(dict.fromkeys(urls)),
        "path_fragment": doc.get("pathFragment"),
      }
    )

  return normalized


def validate_url(url: str, required_fragment: Optional[str] = None) -> str:
  parsed = urlparse(url)
  if parsed.scheme not in {"http", "https"}:
    raise ValueError(f"Unsupported scheme for URL: {url}")
  if parsed.netloc != ALLOWED_HOST:
    raise ValueError(f"URL must be hosted on {ALLOWED_HOST}: {url}")
  if required_fragment and required_fragment not in parsed.path:
    raise ValueError(f"URL path must include '{required_fragment}': {url}")
  return url.rstrip("/")


def fetch(url: str, timeout: int = 30) -> str:
  resp = requests.get(
    url,
    headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
    timeout=timeout,
  )
  resp.raise_for_status()
  return resp.text


def clean_text(element: Tag) -> str:
  text = " ".join(element.stripped_strings)
  return " ".join(text.split())


def element_to_markdown(element: Tag) -> Optional[str]:
  text = clean_text(element)
  if not text:
    return None

  if element.name == "h2":
    return f"### {text}"
  if element.name == "h3":
    return f"#### {text}"
  if element.name in ("p", "div"):
    return text
  if element.name == "li":
    return f"- {text}"
  return None


def find_rich_text_root(container: Tag) -> Tag:
  if not isinstance(container, Tag):
    return container

  priority_classes = (
    "rich-text",
    "richtext",
    "article-content",
    "content-body",
    "article-body",
    "body-copy",
    "wysiwyg",
  )
  for css in priority_classes:
    match = container.find(class_=lambda value, needle=css: value and needle in value)
    if match:
      return match

  candidates = [container] + list(container.find_all(["article", "section", "div"], recursive=True))
  best = container
  best_score = 0.0

  for node in candidates:
    paragraph_count = len(node.find_all("p"))
    list_count = len(node.find_all("li"))
    heading_count = len(node.find_all(["h2", "h3", "h4"]))
    text_length = len(" ".join(node.stripped_strings))
    score = paragraph_count * 5 + list_count * 2 + heading_count * 3 + text_length / 200
    if score > best_score:
      best = node
      best_score = score

  return best


def extract_content(html: str) -> tuple[str, str]:
  soup = BeautifulSoup(html, "html.parser")

  for tag in soup(["script", "style", "noscript"]):
    tag.decompose()

  main = soup.find("main") or soup.find("article") or soup.body or soup
  rich_body = find_rich_text_root(main) if isinstance(main, Tag) else main

  title_text = (
    clean_text(rich_body.find("h1"))
    if isinstance(rich_body, Tag) and rich_body.find("h1")
    else clean_text(soup.find("title")) or "Untitled Page"
  )

  markdown_parts: List[str] = []
  candidates = rich_body.find_all(["h2", "h3", "p", "li", "div"]) if isinstance(rich_body, Tag) else []
  seen_snippets = set()
  for node in candidates:
    snippet = element_to_markdown(node)
    if not snippet:
      continue
    signature = " ".join(snippet.split())
    if signature in seen_snippets:
      continue
    seen_snippets.add(signature)
    markdown_parts.append(snippet)

  body = "\n\n".join(markdown_parts) if markdown_parts else clean_text(rich_body) or ""
  return title_text.strip(), body.strip()


def build_document(doc: dict) -> list[dict]:
  pages = []
  for raw_url in doc["urls"]:
    try:
      url = validate_url(raw_url, doc.get("path_fragment"))
    except ValueError as err:
      print(f"[warn] Skipping invalid URL '{raw_url}': {err}", file=sys.stderr)
      continue

    try:
      html = fetch(url)
    except requests.RequestException as exc:
      print(f"[warn] Failed to fetch {url}: {exc}", file=sys.stderr)
      continue

    title, body = extract_content(html)
    page_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
    pages.append({"url": url, "title": title or url, "body": body, "hash": page_hash})

  return pages


def write_document(doc: dict, pages: list[dict], timestamp: str) -> None:
  doc["output_path"].parent.mkdir(parents=True, exist_ok=True)

  header = [f"# {doc['title']}", f"_Last refreshed: {timestamp}_", ""]
  sections = []
  for page in pages:
    body = page["body"] or "_No text extracted from this page yet._"
    sections.append(
      "\n".join(
        [
          f"<!-- SOURCE START | {page['url']} -->",
          f"## {page['title']}",
          f"_Source: {page['url']}_",
          "",
          body,
          "",
          f"<!-- SOURCE END | {page['url']} -->",
        ]
      )
    )

  contents = "\n\n".join(header + sections) + "\n"
  doc["output_path"].write_text(contents, encoding="utf-8")


def write_manifest(documents: list[dict], doc_results: dict, timestamp_iso: str) -> None:
  payload = {
    "last_run": timestamp_iso,
    "documents": {},
  }

  for doc in documents:
    pages = doc_results.get(doc["id"], [])
    payload["documents"][doc["id"]] = {
      "title": doc["title"],
      "output": doc["output_rel"],
      "last_refreshed": timestamp_iso if pages else None,
      "page_count": len(pages),
      "pages": [
        {"url": page["url"], "title": page["title"], "hash": page["hash"]} for page in pages
      ],
    }

  MANIFEST_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main(argv: Optional[Iterable[str]] = None) -> int:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument(
    "--document",
    help="Only refresh the document whose id/output matches this value.",
  )
  args = parser.parse_args(argv)

  try:
    documents = load_config()
  except ConfigError as exc:
    print(f"[error] {exc}", file=sys.stderr)
    return 1

  target = args.document
  if target:
    documents = [
      doc
      for doc in documents
      if doc["id"] == target or doc["output_rel"] == target or doc["output_path"].name == target
    ]
    if not documents:
      print(f"[error] No document matches '{target}'.", file=sys.stderr)
      return 1

  timestamp_human = dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
  timestamp_iso = dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"

  doc_results: dict[str, list[dict]] = {}
  for doc in documents:
    print(f"[info] Building document '{doc['id']}' -> {doc['output_rel']}")
    pages = build_document(doc)
    doc_results[doc["id"]] = pages
    write_document(doc, pages, timestamp_human)
    print(f"[info]   {len(pages)} page(s) written.")

  write_manifest(documents, doc_results, timestamp_iso)
  print(f"[info] Updated manifest at {MANIFEST_PATH}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
