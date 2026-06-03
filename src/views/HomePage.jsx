import { Heart, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, moviePosterFallback } from '../api.js';
import { translateGenre, useLocale } from '../ui/locale.jsx';

export default function HomePage() {
  const [searchParams] = useSearchParams();
  const [movies, setMovies] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ genre: 'all', year: 'all', sort: 'popular' });
  const { locale, t } = useLocale();
  const search = searchParams.get('search') || '';
  const category = searchParams.get('category') || 'Movie';

  useEffect(() => {
    setLoading(true);
    api(`/api/movies?search=${encodeURIComponent(search)}`)
      .then(setMovies)
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => {
    api('/api/genres')
      .then((data) => setGenres(Array.isArray(data) ? data : []))
      .catch(() => setGenres([]));
    api('/api/users/favorites/ids')
      .then((data) => setFavoriteIds(Array.isArray(data) ? data : []))
      .catch(() => setFavoriteIds([]));
  }, []);

  const filterOptions = useMemo(() => {
    const byCategory = movies.filter((movie) => normalizeType(movie.type) === category);
    return {
      genres,
      years: unique(byCategory.map((movie) => movie.year).filter(Boolean)).sort((a, b) => b - a)
    };
  }, [movies, category, genres]);

  const catalog = useMemo(() => {
    const filtered = movies
      .filter((movie) => normalizeType(movie.type) === category)
      .filter((movie) => {
        if (filters.genre === 'all') return true;
        const genres = movie.genres?.length ? movie.genres : movie.genre ? [movie.genre] : [];
        return genres.includes(filters.genre);
      })
      .filter((movie) => filters.year === 'all' || String(movie.year) === filters.year);

    return filtered.sort((a, b) => {
      if (filters.sort === 'rating') return Number(b.rating || 0) - Number(a.rating || 0);
      if (filters.sort === 'new') return Number(b.year || 0) - Number(a.year || 0);
      if (filters.sort === 'old') return Number(a.year || 0) - Number(b.year || 0);
      if (filters.sort === 'az') return a.title.localeCompare(b.title);
      if (filters.sort === 'za') return b.title.localeCompare(a.title);
      return Number(b.rating || 0) - Number(a.rating || 0);
    });
  }, [movies, category, filters]);

  function updateFilter(event) {
    setFilters((value) => ({ ...value, [event.target.name]: event.target.value }));
  }

  const emptyLabel = category === 'Series' ? t('empty_series') : category === 'Animation' ? t('empty_animations') : t('empty_movies');

  return (
    <section className="catalog-page">
      <div className="filters">
        <select className="filter-select genre-filter" name="genre" value={filters.genre} onChange={updateFilter}>
          <option value="all">{t('filters_genre')}</option>
          {filterOptions.genres.map((genre) => (
            <option key={genre} value={genre}>
              {translateGenre(locale, genre)}
            </option>
          ))}
        </select>
        <select className="filter-select year-filter" name="year" value={filters.year} onChange={updateFilter}>
          <option value="all">{t('filters_year')}</option>
          {filterOptions.years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <select className="filter-select sort-button" name="sort" value={filters.sort} onChange={updateFilter}>
          <option value="popular">{t('filters_popular')}</option>
          <option value="rating">{t('filters_rating')}</option>
          <option value="new">{t('filters_newest')}</option>
          <option value="old">{t('filters_oldest')}</option>
          <option value="az">{t('filters_az')}</option>
          <option value="za">{t('filters_za')}</option>
        </select>
      </div>

      {loading ? <div className="status">{t('loading_movies')}</div> : null}
      {!loading && !catalog.length ? <div className="empty-state">{emptyLabel}</div> : null}

      <div className="movie-grid">
        {catalog.map((movie, index) => (
          <Link key={movie.id} className="movie-card" to={`/movies/${movie.slug}`}>
            <div className="poster" style={!movie.coverUrl ? { background: moviePosterFallback(movie) } : undefined}>
              {movie.coverUrl ? (
                <img
                  className="poster-image"
                  src={movie.coverUrl}
                  alt={movie.title}
                  loading={index < 4 ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchPriority={index < 2 ? 'high' : 'low'}
                  sizes="(max-width: 620px) 45vw, (max-width: 980px) 30vw, 174px"
                />
              ) : null}
              <span className="age">{movie.ageRating || '16+'}</span>
              {favoriteIds.includes(movie.id) ? (
                <span className="favorite-badge" title={t('nav_favorites')}>
                  <Heart size={15} fill="currentColor" />
                </span>
              ) : null}
              <span className="kind">{movie.type === 'Series' ? t('movie_type_series') : movie.type === 'Animation' ? t('movie_type_animation') : t('movie_type_movie')}</span>
              <span className="score">
                <Star size={13} fill="currentColor" /> {Number(movie.rating || 8).toFixed(1)}
              </span>
              {!movie.coverUrl ? (
                <div className="poster-title">
                  <span>{movie.genres?.[0] ? translateGenre(locale, movie.genres[0]) : movie.genre || 'English'}</span>
                  <strong>{movie.title}</strong>
                </div>
              ) : null}
            </div>
            <strong className="movie-title">{movie.title}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeType(type) {
  if (type === 'Animation' || type === 'Animations') return 'Animation';
  if (type === 'Series') return 'Series';
  return 'Movie';
}
