from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql://user:password@localhost/moneo_monitoring"
    moneo_api_base_url: str = "https://ifm-ro-sales.w-eu.moneo.ifm/api/platform/v1"
    # Required — no default. See backend/CLAUDE.md → MONEO Token Rotation for rotation steps.
    moneo_api_key: str = Field(..., description="MONEO platform API Personal Access Token. Required.")
    jwt_secret_key: str = "changeme"  # must be overridden in .env before any non-local deployment
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_hours: int = 24
    redis_url: str = "redis://localhost:6379"
    sensor_poll_interval_seconds: int = 300
    auto_migrate: bool = True
    alert_evaluation_enabled: bool = True
    max_backfill_hours: int = 24
    moneo_poll_max_pages_per_sensor: int = 100
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "moneo-alerts@example.com"
    smtp_tls: bool = True
    webhook_hmac_secret: str = "changeme"  # must be overridden in .env before any non-local deployment
    notification_dispatch_enabled: bool = True
    sync_history_retention_days: int = 90
    debug: bool = False
    allowed_origins: list[str] = ["http://localhost:4200", "http://localhost:3000"]
    seed_admin_username: str = "admin"
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = "changeme"  # must be overridden in .env before any non-local deployment

    @field_validator("debug", mode="before")
    def parse_debug(cls, value):
        # Accept env-style values ("debug"/"production"/"prod") in addition to the
        # standard truthy/falsy strings, so DEBUG=debug or DEBUG=prod in .env works.
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "on", "debug"}:
                return True
            if normalized in {"false", "0", "no", "off", "release", "production", "prod"}:
                return False
        return value

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
