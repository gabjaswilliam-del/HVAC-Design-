"""Embedding client for a local OpenAI-compatible server (`POST {base}/embeddings`).

Configured only from the service's environment, never from the browser:
HVAC_EMBEDDINGS_BASE_URL (for example http://127.0.0.1:8081/v1), HVAC_EMBEDDINGS_MODEL
and, if the server wants one, HVAC_EMBEDDINGS_API_KEY. Without the first two there is
no vector retrieval, and the knowledge service says so.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Mapping


class EmbeddingError(Exception):
    pass


class OpenAICompatibleEmbeddings:
    def __init__(self, base_url: str, model: str, api_key: str | None = None, timeout: float = 30.0, batch: int = 32):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._api_key = api_key
        self.timeout = timeout
        self.batch = batch

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for i in range(0, len(texts), self.batch):
            vectors += self._call(texts[i : i + self.batch])
        return vectors

    def _call(self, texts: list[str]) -> list[list[float]]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        request = urllib.request.Request(
            f"{self.base_url}/embeddings",
            data=json.dumps({"model": self.model, "input": texts}).encode(),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read())
        except urllib.error.HTTPError as e:
            e.close()
            raise EmbeddingError(f"The embedding service answered {e.code}.") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise EmbeddingError("The embedding service could not be reached.") from None
        except ValueError:
            raise EmbeddingError("The embedding service sent a response that is not JSON.") from None
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list) or len(data) != len(texts):
            raise EmbeddingError("The embedding service returned the wrong number of vectors.")
        vectors = [d.get("embedding") if isinstance(d, dict) else None for d in sorted(data, key=lambda d: d.get("index", 0) if isinstance(d, dict) else 0)]
        if not all(isinstance(v, list) and v and all(isinstance(x, (int, float)) for x in v) for v in vectors):
            raise EmbeddingError("The embedding service returned vectors this service cannot read.")
        if len({len(v) for v in vectors}) != 1:  # type: ignore[arg-type]
            raise EmbeddingError("The embedding service returned vectors of different lengths.")
        return vectors  # type: ignore[return-value]


def from_env(env: Mapping[str, str] = os.environ) -> OpenAICompatibleEmbeddings | None:
    base, model = env.get("HVAC_EMBEDDINGS_BASE_URL", "").strip(), env.get("HVAC_EMBEDDINGS_MODEL", "").strip()
    if not base or not model:
        return None
    return OpenAICompatibleEmbeddings(base, model, env.get("HVAC_EMBEDDINGS_API_KEY") or None)
