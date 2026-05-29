from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(
        default="postgresql+psycopg://marquee:marquee@localhost:5432/marquee"
    )
    tmdb_api_key: str = ""
    omdb_api_key: str = ""
    anthropic_api_key: str = ""

    scraper_contact_email: str = "noreply@example.com"
    cache_dir: Path = Path("cache")
    request_delay_seconds: float = 1.0

    @property
    def user_agent(self) -> str:
        return (
            f"MarqueeScraper/0.1 (+research project; contact: {self.scraper_contact_email})"
        )


settings = Settings()
