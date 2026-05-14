from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql://user:password@localhost/moneo_monitoring"
    moneo_api_base_url: str = "https://ifm-ro-sales.w-eu.moneo.ifm/api/platform/v1"
    moneo_api_key: str = "E2C7449CCD619EFA23C7B897A7135702129C1287C833C79DE75F7A02CD85EBD9-1"
    jwt_secret_key: str = "changeme"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_hours: int = 24
    redis_url: str = "redis://localhost:6379"
    sensor_poll_interval_seconds: int = 300
    auto_migrate: bool = True
    debug: bool = False
    allowed_origins: list[str] = ["http://localhost:4200", "http://localhost:3000"]
    seed_admin_username: str = "admin"
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = "changeme"

    @field_validator("debug", mode="before")
    def parse_debug(cls, value):
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"true", "1", "yes", "on", "debug"}:
                return True
            if normalized in {"false", "0", "no", "off", "release", "production", "prod"}:
                return False
        return value

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
