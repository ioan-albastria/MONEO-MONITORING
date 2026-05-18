import sys
from pathlib import Path
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Make the backend/ directory importable when running alembic CLI from any CWD.
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import settings
from DAL.db_context import Base

# Register all models so autogenerate sees every table mapper. DAL.models.__init__
# imports every model module, so a single import keeps env.py and the package in sync.
import DAL.models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    # disable_existing_loggers=False prevents fileConfig from disabling loggers
    # created before migrations run (e.g. services.moneo_poller).
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def get_url() -> str:
    return settings.database_url


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
