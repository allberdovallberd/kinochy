import { Heart, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, moviePosterFallback } from '../api.js';
import { translateGenre, useLocale } from '../ui/locale.jsx';

export default function FavoritesPage() {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const { locale, t } = useLocale();

  useEffect(() => {
    setLoading(true);
    api('/api/users/favorites')
      .then((data) => setMovies(Array.isArray(data) ? data : []))
      .catch(() => setMovies([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="catalog-page favorites-page">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">{t('nav_favorites')}</p>
          <h1>{t('favorites_title')}</h1>
        </div>
      </div>

      {loading ? <div className="status">{t('loading_movies')}</div> : null}
      {!loading && !movies.length ? <div className="empty-state">{t('empty_favorites')}</div> : null}

      <div className="movie-grid">
        {movies.map((movie, index) => (
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
              <span className="favorite-badge" title={t('nav_favorites')}>
                <Heart size={15} fill="currentColor" />
              </span>
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
