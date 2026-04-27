import logging
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings

_log = logging.getLogger(__name__)


class Settings(BaseSettings):
    data_dir: str = "/data"
    log_level: str = "INFO"
    recon_master_key: str = "change-me-before-production"
    encryption_salt: str = "change-me-salt-before-production"
    environment: str = "production"
    # Allowed origins for CORS and WebSocket validation (JSON list in env var).
    # Example: ALLOWED_ORIGINS=["http://localhost:8080","http://192.168.1.10:8080"]
    allowed_origins: list[str] = ["http://localhost:8080"]
    # Trusted hostnames for Host header validation — prevents Host header injection.
    # Wildcards supported: "localhost:*" matches any port on localhost.
    # Example: TRUSTED_HOSTS=["localhost","localhost:8080","192.168.1.10"]
    trusted_hosts: list[str] = ["localhost", "localhost:8080", "127.0.0.1", "127.0.0.1:8080"]

    @model_validator(mode="after")
    def check_production_secrets(self) -> "Settings":
        """Refuse to start in production with insecure default credentials."""
        if self.environment == "production":
            if self.recon_master_key == "change-me-before-production":
                raise ValueError(
                    "RECON_MASTER_KEY must be set to a real secret in production. "
                    "Generate one: python3 -c \"import secrets; print(secrets.token_urlsafe(32))\""
                )
            if self.encryption_salt == "change-me-salt-before-production":
                raise ValueError(
                    "ENCRYPTION_SALT must be set to a real secret in production. "
                    "Generate one: python3 -c \"import secrets; print(secrets.token_urlsafe(16))\""
                )
        if self.allowed_origins == ["http://localhost:8080"]:
            _log.warning(
                "ALLOWED_ORIGINS is set to the default localhost value. "
                "Set ALLOWED_ORIGINS in .env to your actual deployment URL "
                "(e.g. ALLOWED_ORIGINS=[\"http://192.168.1.10:8080\"])"
            )
        return self

    # Derived paths (not env vars)
    @property
    def db_path(self) -> str:
        return f"{self.data_dir}/recon.db"

    @property
    def log_path(self) -> str:
        return f"{self.data_dir}/logs/engine.log"

    @property
    def scans_dir(self) -> str:
        return f"{self.data_dir}/scans"

    @property
    def screenshots_dir(self) -> str:
        return f"{self.data_dir}/screenshots"

    @property
    def tool_configs_dir(self) -> str:
        return f"{self.data_dir}/tool-configs"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
