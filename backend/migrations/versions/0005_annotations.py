"""add annotation table

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-15
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'annotation',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('scope_kind', sa.String(20), nullable=False),
        sa.Column('scope_id', sa.Integer(), nullable=True),
        sa.Column('label', sa.String(160), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('color', sa.String(20), nullable=True),
        sa.Column('source_event_id', sa.BigInteger(),
                  sa.ForeignKey('alert_event.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_by', sa.Integer(),
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('idx_annotation_sensor', 'annotation',
                    ['scope_id', 'started_at'], postgresql_where=sa.text("scope_kind='sensor'"))
    op.create_index('idx_annotation_time', 'annotation', ['started_at'])


def downgrade():
    op.drop_index('idx_annotation_time', table_name='annotation')
    op.drop_index('idx_annotation_sensor', table_name='annotation')
    op.drop_table('annotation')
