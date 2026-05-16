"""Asset hierarchy: parent_id, kind, path

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('assets', sa.Column('parent_id', sa.Integer(), nullable=True))
    op.add_column('assets', sa.Column(
        'kind', sa.String(20), nullable=False, server_default='machine'
    ))
    op.add_column('assets', sa.Column('path', sa.String(500), nullable=True))

    op.create_foreign_key(
        'fk_assets_parent_id', 'assets', 'assets',
        ['parent_id'], ['id'], ondelete='SET NULL'
    )
    op.create_index('idx_assets_parent', 'assets', ['parent_id'])
    op.create_index('idx_assets_path', 'assets', ['path'])

    # Seed path for any existing assets — they have no parent, so path == name.
    op.execute("UPDATE assets SET path = name WHERE path IS NULL")


def downgrade() -> None:
    op.drop_index('idx_assets_path', table_name='assets')
    op.drop_index('idx_assets_parent', table_name='assets')
    op.drop_constraint('fk_assets_parent_id', 'assets', type_='foreignkey')
    op.drop_column('assets', 'path')
    op.drop_column('assets', 'kind')
    op.drop_column('assets', 'parent_id')
