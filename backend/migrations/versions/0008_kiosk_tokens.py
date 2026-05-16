"""kiosk_tokens table

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'kiosk_tokens',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column(
            'dashboard_ids', sa.JSON, nullable=False,
            server_default='[]',
            comment='List of dashboard IDs this token may access / cycle through',
        ),
        sa.Column('label', sa.String(100), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_by', sa.Integer,
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('NOW()'),
        ),
    )
    op.create_index('idx_kiosk_tokens_active', 'kiosk_tokens', ['is_active'])


def downgrade() -> None:
    op.drop_index('idx_kiosk_tokens_active', table_name='kiosk_tokens')
    op.drop_table('kiosk_tokens')
