"""Initial schema baseline

Revision ID: 0001
Revises:
Create Date: 2026-05-15

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Baseline — tables pre-exist; this migration documents initial state only.
    pass


def downgrade() -> None:
    # Baseline — nothing to undo.
    pass
