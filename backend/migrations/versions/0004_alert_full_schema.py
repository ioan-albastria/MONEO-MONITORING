"""Replace alert tables with full §3.3 schema

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-15

Drops the simplified Slice-2 alert tables (which have no production data yet)
and recreates them with the full §3.3 column set required by the alert evaluator.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Drop old tables in dependency order ─────────────────────────────
    op.drop_table("alert_notification_outbox")
    op.drop_table("alert_route")
    op.drop_table("alert_state")
    op.drop_table("alert_event")
    op.drop_table("alert_rule")

    # ── 2. alert_rule ──────────────────────────────────────────────────────
    op.create_table(
        "alert_rule",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "sensor_id",
            sa.Integer(),
            sa.ForeignKey("sensors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("condition", sa.String(20), nullable=False),
        sa.Column("threshold_lo", sa.Float(), nullable=True),
        sa.Column("threshold_hi", sa.Float(), nullable=True),
        sa.Column("recovery_lo", sa.Float(), nullable=True),
        sa.Column("recovery_hi", sa.Float(), nullable=True),
        sa.Column("severity", sa.String(10), nullable=False),
        sa.Column("dwell_seconds", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("no_data_seconds", sa.Integer(), nullable=True),
        sa.Column("recovery_dwell_seconds", sa.Integer(), nullable=False, server_default="30"),
        sa.Column(
            "policy", sa.String(20), nullable=False, server_default="auto_clear"
        ),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
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
    op.create_index(
        "idx_alert_rule_sensor",
        "alert_rule",
        ["sensor_id"],
        postgresql_where=sa.text("is_enabled = true"),
    )

    # ── 3. alert_event ─────────────────────────────────────────────────────
    op.create_table(
        "alert_event",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "rule_id",
            sa.BigInteger(),
            sa.ForeignKey("alert_rule.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sensor_id",
            sa.Integer(),
            sa.ForeignKey("sensors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("observed_value", sa.Float(), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "acknowledged_by",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_alert_event_rule_time",
        "alert_event",
        ["rule_id", "observed_at"],
    )
    op.create_index(
        "idx_alert_event_state",
        "alert_event",
        ["state"],
        postgresql_where=sa.text("state IN ('firing', 'awaiting_ack')"),
    )

    # ── 4. alert_state ─────────────────────────────────────────────────────
    op.create_table(
        "alert_state",
        sa.Column(
            "rule_id",
            sa.BigInteger(),
            sa.ForeignKey("alert_rule.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("current_state", sa.String(20), nullable=False),
        sa.Column("state_since", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_value", sa.Float(), nullable=True),
        sa.Column("last_value_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("flap_count_10m", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_flapping", sa.Boolean(), nullable=False, server_default="false"),
    )

    # ── 5. alert_route ─────────────────────────────────────────────────────
    op.create_table(
        "alert_route",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("scope_kind", sa.String(20), nullable=False),
        sa.Column("scope_id", sa.Integer(), nullable=True),
        sa.Column("scope_severity", sa.String(10), nullable=True),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("target", sa.Text(), nullable=False),
        sa.Column("on_fire", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("on_recover", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # ── 6. alert_notification_outbox ───────────────────────────────────────
    op.create_table(
        "alert_notification_outbox",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "event_id",
            sa.BigInteger(),
            sa.ForeignKey("alert_event.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "route_id",
            sa.BigInteger(),
            sa.ForeignKey("alert_route.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("channel", sa.String(20), nullable=True),
        sa.Column("target", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "idx_outbox_pending",
        "alert_notification_outbox",
        ["status", "next_attempt_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    # ── Drop new tables in reverse dependency order ────────────────────────
    op.drop_index("idx_outbox_pending", table_name="alert_notification_outbox")
    op.drop_table("alert_notification_outbox")
    op.drop_table("alert_route")
    op.drop_table("alert_state")
    op.drop_index("idx_alert_event_state", table_name="alert_event")
    op.drop_index("idx_alert_event_rule_time", table_name="alert_event")
    op.drop_table("alert_event")
    op.drop_index("idx_alert_rule_sensor", table_name="alert_rule")
    op.drop_table("alert_rule")

    # ── Recreate the simplified 0003-era tables ────────────────────────────
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
        sa.Column("comparator", sa.String(4), nullable=False),
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
