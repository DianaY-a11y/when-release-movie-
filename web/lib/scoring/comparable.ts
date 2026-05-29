// Top library analogs for a candidate film, ranked by similarity. This depends on the
// large film_index + film_tags snapshots, and does NOT depend on weekends or filters —
// so it's computed server-side once per film, not shipped to the client or recomputed
// when the user fiddles with filters.

import { similarity } from "./similarity";
import type { CandidateFilm, ComparableFilm } from "./types";
import type { FilmIndex, FilmTags } from "@/lib/types";

export function comparableFilms(
  film: CandidateFilm,
  filmIndex: FilmIndex,
  filmTags: FilmTags,
  n = 6
): ComparableFilm[] {
  return filmIndex.items
    .map((f) => {
      const tags = filmTags[String(f.id)];
      return {
        film: f,
        sim: similarity(film, {
          tier: f.tier,
          mpaa: f.mpaa,
          genres: f.genres,
          genre_tags: tags?.genre_tags,
          audience_tags: tags?.audience_tags,
        }),
      };
    })
    .sort((a, b) => b.sim - a.sim)
    .slice(0, n)
    .map((r) => ({
      film_id: r.film.id,
      title: r.film.title,
      year: r.film.year,
      iso_week: r.film.iso_week,
      distributor: r.film.distributor,
      opening_usd: r.film.opening_usd,
      total_domestic_usd: r.film.total_domestic_usd,
      multiplier: r.film.multiplier,
      similarity: r.sim,
    }));
}
