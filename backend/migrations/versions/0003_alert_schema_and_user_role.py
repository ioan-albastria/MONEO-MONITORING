"""Alert schema + User role

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-15

Adds:
- users.role column (varchar 20, default 'viewer')
- alert_rule, alert_event, alert_state, alert_route, alert_notification_outbox tables
Drops:
- alert_configs stub table (replaced by the proper alert schema)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Add role column to users ────────────────────────────────────────
    op.add_column(
        "users",
        sa.Column("role", sa.String(20), nullable=False, server_default="viewer"),
    )
    # Best-effort: promote any user named 'admin' to admin role.
    op.execute("UPDATE users SET role = 'admin' WHERE username = 'admin'")

    # ── 2. Drop the old alert_config stub ──────────────────────────────────
    op.execute("DROP TABLE IF EXISTS alert_configs CASCADE")

    # ── 3. alert_rule ──────────────────────────────────────────────────────
    op.create_table(
        "alert_rule",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "sensor_id",
            sa.Integer(),
            sa.ForeignKey("sensors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("tier", sa.String(20), nullable=False),
        sa.Column("comparator", sa.String(4), nullable=False),   # '<', '<=', '>', '>='
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # ── 4. alert_event ─────────────────────────────────────────────────────
    op.create_table(
        "alert_event",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "rule_id",
            sa.Integer(),
            sa.ForeignKey("alert_rule.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sensor_id",
            sa.Integer(),
            sa.ForeignKey("sensors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reading_id",
            sa.Integer(),
            sa.ForeignKey("sensor_readings.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("tier", sa.String(20), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column(
            "triggered_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── 5. alert_state ─────────────────────────────────────────────────────
    op.create_table(
        "alert_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "rule_id",
            sa.Integer(),
            sa.ForeignKey("alert_rule.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("current_tier", sa.String(20), nullable=False),
        sa.Column("fired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consecutive_breaches", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # ── 6. alert_route ─────────────────────────────────────────────────────
    op.create_table(
        "alert_route",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("channel", sa.String(30), nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("filter_tiers", postgresql.ARRAY(sa.Text()), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # ── 7. alert_notification_outbox ───────────────────────────────────────
    op.create_table(
        "alert_notification_outbox",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "event_id",
            sa.Integer(),
            sa.ForeignKey("alert_event.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "route_id",
            sa.Integer(),
            sa.ForeignKey("alert_route.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("alert_notification_outbox")
    op.drop_table("alert_route")
    op.drop_table("alert_state")
    op.drop_table("alert_event")
    op.drop_table("alert_rule")

    # Recreate the old alert_configs stub
    op.create_table(
        "alert_configs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "sensor_id",
            sa.Integer(),
            sa.ForeignKey("sensors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("threshold_value", sa.Float(), nullable=False),
        sa.Column("comparison_type", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.drop_column("users", "role")
