"""processdata compatibility — datasource ref column + reading uniqueness

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-17

Changes:
  a. ADD COLUMN sensors.moneo_datasource_ref (the deep reference.dataSource.id).
  b. Backfill moneo_datasource_ref from the existing metadata JSON blob.
  c. Pre-flight dedup: remove duplicate sensor_readings before adding the unique constraint.
  d. ADD UNIQUE CONSTRAINT sensor_readings(sensor_id, timestamp).
"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_log = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    # ── a. New column: sensors.moneo_datasource_ref ───────────────────────────
    # Stores reference.dataSource.id from /nodes. This is the 128-char hex hash
    # that /processdata requires. It differs from moneo_sensor_id (the topology
    # node id), which remains our stable public handle.
    op.add_column("sensors", sa.Column("moneo_datasource_ref", sa.String(), nullable=True))
    op.create_index(
        "ix_sensors_moneo_datasource_ref",
        "sensors",
        ["moneo_datasource_ref"],
    )

    # ── b. Backfill from existing JSON blob ───────────────────────────────────
    # The DB column is "metadata" (the Python attribute is Sensor.extra_metadata).
    # reference.dataSource.id is preserved verbatim in the full upstream blob stored
    # there, so we can extract it without another API call.
    # This is PostgreSQL-specific syntax; the test fixture bypasses Alembic entirely
    # (uses Base.metadata.create_all) so SQLite compatibility is not required here.
    op.execute(
        sa.text(
            "UPDATE sensors "
            "SET moneo_datasource_ref = (metadata::jsonb #>> '{reference,dataSource,id}') "
            "WHERE metadata IS NOT NULL"
        )
    )

    # ── c. Pre-flight dedup: remove duplicate sensor_readings ─────────────────
    # The unique constraint in step (d) would fail if duplicate (sensor_id, timestamp)
    # pairs already exist. Strategy: keep only the MIN(id) row per pair.
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT count(*) FROM ("
            "  SELECT sensor_id, timestamp"
            "  FROM sensor_readings"
            "  GROUP BY sensor_id, timestamp"
            "  HAVING count(*) > 1"
            ") sub"
        )
    )
    dup_groups = result.scalar() or 0
    if dup_groups > 0:
        _log.info(
            "Found %d duplicate (sensor_id, timestamp) groups in sensor_readings — deduplicating",
            dup_groups,
        )
        conn.execute(
            sa.text(
                "DELETE FROM sensor_readings "
                "WHERE id NOT IN ("
                "  SELECT MIN(id) FROM sensor_readings GROUP BY sensor_id, timestamp"
                ")"
            )
        )

    # ── d. Unique constraint on (sensor_id, timestamp) ───────────────────────
    op.create_unique_constraint(
        "uq_sensor_reading_sensor_timestamp",
        "sensor_readings",
        ["sensor_id", "timestamp"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_sensor_reading_sensor_timestamp",
        "sensor_readings",
        type_="unique",
    )
    op.drop_index("ix_sensors_moneo_datasource_ref", table_name="sensors")
    op.drop_column("sensors", "moneo_datasource_ref")
