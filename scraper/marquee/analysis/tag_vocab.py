"""Fixed tag vocabularies for film classification.

LLM tags films from these closed sets so the resulting feature vector is stable
across runs and queryable. Hand-curated to be comprehensive.
"""

from __future__ import annotations

GENRE_TAGS: list[str] = [
    # horror  
    "psychological-horror",
    "elevated-horror",
    "slasher",
    "supernatural-horror",
    "body-horror",
    "folk-horror",
    "creature-feature",
    "found-footage-horror",
    # drama
    "prestige-drama",
    "indie-drama",
    "coming-of-age",
    "period-drama",
    "biopic",
    "legal-drama",
    "war-drama",
    "social-issue-drama",
    "family-drama",
    # comedy
    "raunchy-comedy",
    "dark-comedy",
    "romantic-comedy",
    "satire",
    "stoner-comedy",
    "buddy-comedy",
    # action / blockbuster
    "action-tentpole",
    "superhero",
    "spy-thriller",
    "crime-thriller",
    "neo-noir",
    "heist",
    "war-action",
    # sci-fi / fantasy
    "sci-fi-blockbuster",
    "arthouse-scifi",
    "dystopian",
    "fantasy-adventure",
    "time-travel",
    # family / animation
    "animated-family",
    "animated-adult",
    "live-action-family",
    "musical",
    # niche / other
    "documentary-prestige",
    "documentary-pop",
    "concert-film",
    "faith-based",
    "sports-drama",
    "music-biopic",
    "holiday-themed",
    "mystery-whodunit",
    "western",
    "disaster",
    "erotic-thriller",
    "lgbtq-led",
]

AUDIENCE_TAGS: list[str] = [
    # demographic
    "young-male",
    "young-female",
    "teen",
    "gen-z",
    "millennial",
    "gen-x",
    "mature-adult",
    "family-with-young-kids",
    "family-with-teens",
    # affinity / mode
    "date-night",
    "couples-30-plus",
    "urban-multicultural",
    "urban-arthouse",
    "cinephile",
    "awards-watchers",
    "franchise-loyalist",
    "horror-fans",
    "action-fans",
    "comedy-fans",
    "faith-driven",
    # cultural
    "latinx",
    "black-audience",
    "asian-audience",
    "lgbtq-audience",
    # spend / mood
    "premium-format-driven",  # IMAX/Dolby driver
    "word-of-mouth-driven",
]


def all_tags() -> dict[str, list[str]]:
    return {"genre": GENRE_TAGS, "audience": AUDIENCE_TAGS}
