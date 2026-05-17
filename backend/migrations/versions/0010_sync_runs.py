"""sync_runs and sync_errors observability tables

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-17

Creates two new tables that provide persistent sync observability (Slice 3):
  - sync_runs: one row per poller invocation; tracks status, counts, and cursor.
  - sync_errors: one row per per-sensor error within a run; FK to sync_runs.

downgrade: drop sync_errors first (FK dep), then sync_runs.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sync_runs",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("source", sa.String(40), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("records_in", sa.Integer, nullable=False, server_default="0"),
        sa.Column("records_written", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_cursor", sa.BigInteger, nullable=True),
        sa.Column("error_summary", sa.Text, nullable=True),
    )
    op.create_index(
        "ix_sync_runs_source_started",
        "sync_runs",
        ["source", "started_at"],
    )

    op.create_table(
        "sync_errors",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column(
            "sync_run_id",
            sa.BigInteger,
            sa.ForeignKey("sync_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sensor_id",
            sa.Integer,
            sa.ForeignKey("sensors.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("http_status", sa.Integer, nullable=True),
        sa.Column("message", sa.Text, nullable=False),
    )
    op.create_index("ix_sync_errors_run", "sync_errors", ["sync_run_id"])
    op.create_index("ix_sync_errors_sensor_kind", "sync_errors", ["sensor_id", "kind"])


def downgrade() -> None:
    # Drop sync_errors first to satisfy the FK constraint.
    op.drop_index("ix_sync_errors_sensor_kind", table_name="sync_errors")
    op.drop_index("ix_sync_errors_run", table_name="sync_errors")
    op.drop_table("sync_errors")

    op.drop_index("ix_sync_runs_source_started", table_name="sync_runs")
    op.drop_table("sync_runs")
