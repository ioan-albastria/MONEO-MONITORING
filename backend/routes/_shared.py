"""Route-layer shared utilities.

Why this file exists:
  Service methods signal a missing resource by raising ValueError with a
  human-readable message.  Routes translate that into HTTP 404 using the
  *exact* detail string from the exception — this is part of the public
  contract: the Angular frontend displays ``detail`` verbatim in some error
  paths.  ``_not_found_on_value_error()`` centralises the translation so
  each call site stays a single line instead of a three-line try/except block.

Invariants future readers must preserve:
  - ``detail`` is always ``str(e)`` — do NOT sanitize, paraphrase, or
    truncate.  The frontend relies on the message text.
  - Status code is always 404.  Different codes require separate helpers.
  - Only ``ValueError`` triggers 404.  All other exceptions propagate to
    FastAPI's default handler unmodified.
"""

from contextlib import contextmanager

from fastapi import HTTPException, status


@contextmanager
def _not_found_on_value_error():
    """Translate a service ValueError into HTTP 404.

    Usage::

        with _not_found_on_value_error():
            return _service.get_something(db, resource_id)
    """
    try:
        yield
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
