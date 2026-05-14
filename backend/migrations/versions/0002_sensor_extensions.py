"""Sensor extensions — freshness + range bounds

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-15

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sensors", sa.Column("expected_poll_seconds", sa.Integer(), nullable=True))
    op.add_column("sensors", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sensors", sa.Column("normal_min",   sa.Float(), nullable=True))
    op.add_column("sensors", sa.Column("normal_max",   sa.Float(), nullable=True))
    op.add_column("sensors", sa.Column("warning_min",  sa.Float(), nullable=True))
    op.add_column("sensors", sa.Column("warning_max",  sa.Float(), nullable=True))
    op.add_column("sensors", sa.Column("critical_min", sa.Float(), nullable=True))
    op.add_column("sensors", sa.Column("critical_max", sa.Float(), nullable=True))
    op.add_column(
        "sensors",
        sa.Column(
            "ranges_source",
            sa.String(20),
            nullable=False,
            server_default="manual",
        ),
    )


def downgrade() -> None:
    op.drop_column("sensors", "ranges_source")
    op.drop_column("sensors", "critical_max")
    op.drop_column("sensors", "critical_min")
    op.drop_column("sensors", "warning_max")
    op.drop_column("sensors", "warning_min")
    op.drop_column("sensors", "normal_max")
    op.drop_column("sensors", "normal_min")
    op.drop_column("sensors", "last_seen_at")
    op.drop_column("sensors", "expected_poll_seconds")
