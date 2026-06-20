"""autosci-ingest — emit parsed SourceRecord text into <vault>/raw/_parsed/ for the TS extractor.

The autosci `SourceReader` parses every `raw/` source (incl. PDFs) into a `SourceRecord` whose `.text`
is the extracted markdown. The TS-side SourceReader skips binary files, so this writes each parsed
record's text as `raw/_parsed/<stem>.md`, which the TS reader then feeds to the paper extractor.

Run via the substrate venv python: `python scripts/autosci_ingest.py --vault <vaultRoot>`.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from autosci_core.adapters import SourceReader


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="autosci-ingest")
    p.add_argument("--vault", default=".", help="vault root (contains raw/)")
    args = p.parse_args(argv)

    vault = Path(args.vault)
    out_dir = vault / "raw" / "_parsed"
    out_dir.mkdir(parents=True, exist_ok=True)

    report = SourceReader(vault).read()
    count = 0
    for rec in report.records:
        text = (rec.text or "").strip()
        if not text:
            continue
        # Skip records that are already plain text under raw/ (the TS reader handles those directly);
        # only emit parsed text for sources the TS reader skips (binaries like PDFs).
        if Path(rec.source_path).suffix.lower() in {".md", ".markdown", ".txt"}:
            continue
        stem = Path(rec.source_path).stem
        (out_dir / f"{stem}.md").write_text(rec.text, encoding="utf-8")
        count += 1
    print(f"ingested {count} parsed record(s) -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
