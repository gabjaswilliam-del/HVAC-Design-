"""The error contract every local service answers with (docs/ui-data-contracts.md, Error).

A code the client can act on, a message a person can read, whether retrying can help,
and optional details for the client (an existing document's ID, say). Never a
traceback, a file path or a secret.
"""

from __future__ import annotations

from typing import Any

# code -> HTTP status. The codes match the dashboard's ApiError codes.
STATUS = {
    "INVALID_REQUEST": 400,
    "PERMISSION_DENIED": 403,
    "NOT_FOUND": 404,
    "CONFLICT": 409,
    "TOO_LARGE": 413,
    "UNSUPPORTED": 415,
    "UNAVAILABLE": 503,
}


class ServiceError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False, details: dict[str, Any] | None = None):
        super().__init__(message)
        if code not in STATUS:
            raise ValueError(f"unknown error code {code}")
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or {}

    @property
    def status(self) -> int:
        return STATUS[self.code]

    def to_wire(self) -> dict[str, Any]:
        body: dict[str, Any] = {"code": self.code, "message": self.message, "retryable": self.retryable}
        if self.details:
            body["details"] = self.details
        return {"error": body}
