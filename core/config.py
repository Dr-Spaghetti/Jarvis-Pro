from pathlib import Path
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Anthropic
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    default_model: str = Field(default="claude-sonnet-4-6", alias="DEFAULT_MODEL")
    research_model: str = Field(default="claude-opus-4-7", alias="RESEARCH_MODEL")

    # Paths
    vault_path: Optional[Path] = Field(default=None, alias="OBSIDIAN_VAULT_PATH")
    clients_file: Path = Field(default=Path("clients/clients.json"), alias="CLIENTS_FILE")
    metrics_file: Path = Field(default=Path(".jarvis/metrics.json"), alias="METRICS_FILE")
    skills_dir: Path = Field(default=Path("skills"), alias="SKILLS_DIR")
    skill_versions_dir: Path = Field(
        default=Path(".jarvis/skill_versions"), alias="SKILL_VERSIONS_DIR"
    )
    research_cache_file: Path = Field(
        default=Path(".jarvis/research_cache.json"), alias="RESEARCH_CACHE_FILE"
    )

    # Integrations
    local_falcon_api_key: str = Field(default="", alias="LOCAL_FALCON_API_KEY")
    brave_search_api_key: str = Field(default="", alias="BRAVE_SEARCH_API_KEY")

    # System
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    max_research_depth: int = Field(default=3, alias="MAX_RESEARCH_DEPTH")
    parallel_clients: int = Field(default=5, alias="PARALLEL_CLIENTS")
    research_cache_ttl_days: int = Field(default=7, alias="RESEARCH_CACHE_TTL_DAYS")
    improvement_min_executions: int = Field(default=10, alias="IMPROVEMENT_MIN_EXECUTIONS")
    improvement_success_threshold: float = Field(
        default=0.80, alias="IMPROVEMENT_SUCCESS_THRESHOLD"
    )

    @property
    def has_vault(self) -> bool:
        return self.vault_path is not None and Path(self.vault_path).exists()

    @property
    def has_anthropic(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def has_local_falcon(self) -> bool:
        return bool(self.local_falcon_api_key)

    @property
    def has_brave_search(self) -> bool:
        return bool(self.brave_search_api_key)

    def ensure_jarvis_dirs(self):
        """Create runtime directories if they don't exist."""
        for d in [
            self.metrics_file.parent,
            self.skill_versions_dir,
            self.research_cache_file.parent,
        ]:
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
