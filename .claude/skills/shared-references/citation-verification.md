# Citation Discipline

> Shared reference for skills that generate citations: `/paper-draft`, `/paper-plan`.
> Every citation in an autosci-core output must be **verifiable** — never LLM-generated.

---

## Core Rule

**BibTeX entries must come from authoritative sources, not from LLM memory.**

LLMs hallucinate citation details (wrong year, wrong venue, wrong authors, non-existent papers).
The only acceptable sources for BibTeX are:

1. **DBLP** (`https://dblp.org/`) — primary source for CS venues
2. **CrossRef** (`https://api.crossref.org/`) — primary source for DOI-bearing publications
3. **Semantic Scholar** (`https://api.semanticscholar.org/`) — fallback for preprints
4. **The paper's own .bib file** — if available in `raw/papers/`
5. **The wiki page's own metadata** — `wiki/papers/<slug>.md` frontmatter carries `title`,
   `authors`, `year`, `venue`, `url`; use it to seed the query and to fill fields the fetch misses.

## The [UNCONFIRMED] Protocol

When a BibTeX entry **cannot** be fetched from any authoritative source:

1. Generate a best-effort entry from available information (title, authors, year from the wiki page)
2. Prefix the BibTeX key with `UNCONFIRMED_`: `@article{UNCONFIRMED_smith2024attention, ...}`
3. Add a comment: `% [UNCONFIRMED] BibTeX not confirmed from DBLP/CrossRef — manual check required`
4. The `[UNCONFIRMED]` marker is a **hard blocker** for submission — `/paper-compile` (or the human)
   must flag all remaining `[UNCONFIRMED]` entries

## Fetching BibTeX

### DBLP (preferred for CS)

```bash
# Search by title (WebFetch)
https://dblp.org/search/publ/api?q={url-encoded-title}&format=json&h=3
# Parse: .result.hits.hit[].info contains title, authors, venue, year, url
# Get BibTeX: WebFetch the .url field + ".bib" suffix
```

### CrossRef (preferred for DOI)

```bash
# Search by title (WebFetch)
https://api.crossref.org/works?query.bibliographic={url-encoded-title}&rows=3
# Parse: .message.items[] contains title, author, container-title, DOI
# Construct BibTeX from the structured data
```

### Semantic Scholar (fallback for arXiv preprints)

autosci-core has **no `fetch_s2.py` helper** (unlike the standalone AutoSci wiki). Fetch via WebFetch:

```bash
https://api.semanticscholar.org/graph/v1/paper/search?query={title}&fields=title,authors,year,venue,externalIds
```

The core CAN record inter-paper citation edges (not BibTeX) with:

```bash
uv run python -m kernel add-citation wiki --from papers:<citing-slug> --to papers:<cited-slug> --source semantic_scholar
# or batch from a stdin S2-refs JSON array:
uv run python -m kernel add-citations-batch wiki < refs.json
```

These write to `wiki/graph/citations.jsonl` (the `cites` graph, papers→papers). They are for the
knowledge graph, **not** for `references.bib` — the draft's bibliography is built from the fetched
BibTeX above, keyed off `wiki/papers/` pages.

## Citation Key Convention

```
{first-author-lastname}{year}{first-keyword}
```

Examples:
- `hu2022lora` (Hu et al., 2022, "LoRA: Low-Rank Adaptation...")
- `vaswani2017attention` (Vaswani et al., 2017, "Attention Is All You Need")

## Rules for Skills

### /paper-plan
1. In the citation plan, list all `wiki/papers/` pages that will be cited (surfaced via the
   pipeline→module→`source_papers` / `module_from_paper` / `pipeline_from_paper` traversal and the
   `cites` graph).
2. Pre-fetch BibTeX for each planned citation (fail-fast: identify [UNCONFIRMED] entries early).
3. Report citation coverage: how many are verified vs. [UNCONFIRMED].

### /paper-draft
1. After drafting each section, collect all `\cite{}` references.
2. For each citation: attempt DBLP → CrossRef → S2 in order.
3. Only include entries that are actually cited (`\nocite{*}` is forbidden).
4. Write `references.bib` with fetched entries + [UNCONFIRMED] entries separated at the bottom.

## What NOT To Do

- **Never** generate BibTeX from memory (wrong venue/year is worse than [UNCONFIRMED])
- **Never** cite a paper not in the wiki (all citations trace back to `wiki/papers/`)
- **Never** use `\nocite{*}` (every entry must be explicitly cited)
- **Never** silently drop a [UNCONFIRMED] marker (it must survive until human verification or a successful fetch)
- **Never** fabricate DOIs or arXiv IDs
