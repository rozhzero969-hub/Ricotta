"""Extract an import preview from the Ricotta Main Storage stock report.

Usage: python parse_stock_pdf.py input.pdf output.json
The output contains business stock data; keep it outside the public repository.
PDF text can be ambiguous, so this marks unnamed rows as untransferable.
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


NUMBER = re.compile(r"^\s*([0-9][0-9,]*(?:\.[0-9]+)?)")


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip()


def display_unit(raw: str) -> str:
    value = clean(raw)
    if any("\u0600" <= c <= "\u08ff" for c in value):
        # pdfplumber returns the visual glyph order of the RTL unit cells.
        value = value[::-1]
    return clean(value)


def parse_number(raw: str):
    match = NUMBER.match(raw or "")
    return match.group(1).replace(",", "") if match else None


def parse_quantity(raw: str):
    amount = parse_number(raw)
    if amount is None:
        return None, None, None, None
    suffix = raw[NUMBER.match(raw).end():]
    if "(" in suffix and ")" in suffix:
        inside, after = suffix.split("(", 1)[1].split(")", 1)
        base_match = re.search(r"([0-9][0-9,]*(?:\.[0-9]+)?)", inside)
        base_amount = base_match.group(1).replace(",", "") if base_match else None
        base_unit = display_unit(inside[:base_match.start()]) if base_match else None
        unit = display_unit(after)
    else:
        base_amount = base_unit = None
        unit = display_unit(suffix)
    return amount, unit, base_amount, base_unit


def page_names(page):
    chunks = []
    page.extract_text(visitor_text=lambda s, cm, tm, font, size: chunks.append((round(tm[4], 1), round(tm[5], 1), s)))
    starts = [i for i, (x, y, s) in enumerate(chunks) if abs(x - 8) < 0.1 and s.strip() and s != "ITEM"]
    names = []
    for start in starts:
        parts = []
        for x, y, value in chunks[start:]:
            if x == 0 and y == 0 and value.strip() and NUMBER.match(value):
                break
            if x == 0 and y == 0 and value == "\n":
                break
            parts.append(value)
        names.append(clean("".join(parts)))
    return names


def main(input_path: Path, output_path: Path):
    reader = PdfReader(input_path)
    records = []
    with pdfplumber.open(input_path) as pdf:
        if len(pdf.pages) != len(reader.pages):
            raise ValueError("PDF page counts disagree")
        for page_index, (visual, logical) in enumerate(zip(pdf.pages, reader.pages), 1):
            rows = [row for table in visual.extract_tables() for row in table
                    if len(row) == 4 and row[3] in ("Out of stock", "Plenty in stock")]
            names = page_names(logical)
            if len(names) != len(rows):
                raise ValueError(f"Page {page_index}: {len(names)} names for {len(rows)} rows")
            for name, row in zip(names, rows):
                amount, unit, base_amount, base_unit = parse_quantity(row[1])
                warn_amount, _, _, _ = parse_quantity(row[2])
                if amount is None or not unit:
                    raise ValueError(f"Page {page_index}: cannot parse quantity: {row!r}")
                ordinal = len(records) + 1
                records.append({
                    "id": f"pdf-{ordinal:03d}",
                    "name": name,
                    "counting_unit": unit,
                    "starting_quantity": amount,
                    "usage_unit": base_unit,
                    "usage_total": base_amount,
                    "warning_quantity": warn_amount,
                    "needs_name_review": name == "-",
                    "pdf_page": page_index,
                })
    if len(records) != 342:
        raise ValueError(f"Expected 342 report items; found {len(records)}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({
        "source": input_path.name,
        "generated_at": "2026-09-29T17:23:35+03:00",
        "storage": "Main Storage",
        "items": records,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(records)} items; {sum(x['needs_name_review'] for x in records)} unnamed rows need review")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: parse_stock_pdf.py input.pdf output.json")
    main(Path(sys.argv[1]), Path(sys.argv[2]))
