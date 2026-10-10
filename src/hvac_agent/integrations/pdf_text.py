"""PDF text extraction through the optional `pypdf` package.

The project has no runtime dependencies, so PDF ingestion is off until pypdf is installed
in the service's environment (`pip install pypdf`). Text-based PDFs only: scanned pages
have no text layer and would need OCR, which this build does not have.
"""

from __future__ import annotations

import io


def available() -> tuple[bool, str | None]:
    try:
        import pypdf  # noqa: F401
    except ImportError:
        return False, "PDF text extraction is not configured on this service: install the optional pypdf package (pip install pypdf) and restart it."
    return True, None


def pages(data: bytes) -> list[str]:
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ValueError("encrypted PDF")
    return [page.extract_text() or "" for page in reader.pages]
