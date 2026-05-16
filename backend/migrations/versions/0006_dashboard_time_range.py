"""Add time-range picker columns to dashboards

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('dashboards', sa.Column('default_time_range_hours', sa.Integer(), nullable=True))
    op.add_column('dashboards', sa.Column('default_from',             sa.DateTime(timezone=True), nullable=True))
    op.add_column('dashboards', sa.Column('default_to',               sa.DateTime(timezone=True), nullable=True))
    op.add_column('dashboards', sa.Column('auto_refresh_seconds',     sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('dashboards', 'auto_refresh_seconds')
    op.drop_column('dashboards', 'default_to')
    op.drop_column('dashboards', 'default_from')
    op.drop_column('dashboards', 'default_time_range_hours')
