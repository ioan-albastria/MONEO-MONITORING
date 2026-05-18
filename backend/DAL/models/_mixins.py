"""
Shared timestamp column mixins for SQLAlchemy models.

Why this file exists
--------------------
Eleven model files used to declare their own `created_at` / `updated_at` columns
with the same `default=lambda: datetime.now(timezone.utc)` lambda. That's a DRY
problem and, more importantly, a correctness hazard: any future change to the
default (e.g. moving to `func.now()` server-side) would have to be replicated
in eleven places, and a missed file would silently diverge.

Why there are two variants (naive vs. timezone-aware)
-----------------------------------------------------
The codebase grew in two eras with different timezone conventions:

  * Pre-alerts tables (users, dashboards, dashboard_widgets, sensors, assets)
    were created with `DateTime` — naive, no tz info stored on disk.
  * Alert / annotation / kiosk_token tables (added in migrations 0003–0008)
    use `DateTime(timezone=True)` — timestamptz on disk.

Both conventions are now baked into Alembic migrations that have already been
applied in production. **Changing the column type on either group would require
a data migration**, which is out of scope for the clean-code refactor that
introduced these mixins.

Invariant — pick the variant that matches your table's existing DDL
-------------------------------------------------------------------
When adding `TimestampMixin*` to a model:

  * If the model's `created_at` / `updated_at` were previously declared with
    `DateTime` → use `TimestampMixin`.
  * If they were `DateTime(timezone=True)` → use `TimestampMixinTZ`
    (or `CreatedAtMixinTZ` if the table only has `created_at`).

Mixing variants for the same table will silently change the generated DDL.
The Stage 1 refactor verified byte-identical `CREATE TABLE` output before and
after — keep that guarantee on every future edit.

Why Sensor and Asset are NOT using these mixins
-----------------------------------------------
`Sensor` and `Asset` declare additional columns AFTER their timestamps. Adding
a mixin moves `created_at` / `updated_at` to the end of the table in the
generated DDL, which produces a column-order diff in Alembic autogenerate even
though the schema is functionally equivalent. To avoid noise in future
migrations, those two models keep their inline declarations until a separate
cleanup reorders their columns. Do not "fix" this without that reordering.
"""

from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column


def _utcnow() -> datetime:
    # Module-level callable (not a lambda) so SQLAlchemy can introspect it
    # consistently across mixins and so test fixtures can monkeypatch a single
    # symbol if they ever need deterministic timestamps.
    return datetime.now(timezone.utc)


class TimestampMixin:
    # Naive `DateTime` — matches the older pre-alerts tables. Do NOT switch to
    # `timezone=True` without an accompanying data migration; the on-disk
    # column type would diverge from what every prior Alembic revision
    # established.
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow
    )


class TimestampMixinTZ:
    # `DateTime(timezone=True)` — matches the alert/annotation/kiosk_token
    # tables added from migration 0003 onward.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )


class CreatedAtMixinTZ:
    # For tables that track creation time only (no `updated_at`), e.g. append-
    # only event tables. Same tz convention as `TimestampMixinTZ`.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )
