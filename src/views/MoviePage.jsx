import { Heart, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, moviePosterFallback } from '../api.js';
import MoviePlayer from '../player/MoviePlayer.jsx';
import { translateAccent, translateGenre, useLocale } from '../ui/locale.jsx';

export default function MoviePage() {
  const { slug } = useParams();
  const [movie, setMovie] = useState(null);
  const [favorite, setFavorite] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [favoriteError, setFavoriteError] = useState('');
  const [subtitles, setSubtitles] = useState({ en: [], ru: [] });
  const [loading, setLoading] = useState(true);
  const { locale, t } = useLocale();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMovie(null);
    setSubtitles({ en: [], ru: [] });
    api(`/api/movies/${slug}`)
      .then((movieData) => {
        if (!active) return;
        setMovie(movieData);
        api(`/api/users/favorites/${movieData.id}`)
          .then((data) => active && setFavorite(Boolean(data.favorite)))
          .catch(() => active && setFavorite(false));
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([api(`/api/movies/${slug}/subtitles/en`), api(`/api/movies/${slug}/subtitles/ru`)]).then((results) => {
      if (!active) return;
      const en = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
      const ru = results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : [];
      setSubtitles({ en, ru });
    });
    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) return <div className="status">{t('loading_movie')}</div>;
  if (!movie) return <div className="status">{t('movie_not_found')}</div>;

  async function toggleFavorite() {
    if (favoriteBusy) return;
    const nextFavorite = !favorite;
    setFavoriteBusy(true);
    setFavoriteError('');
    setFavorite(nextFavorite);
    try {
      const data = await api(`/api/users/favorites/${movie.id}`, {
        method: nextFavorite ? 'POST' : 'DELETE',
        body: JSON.stringify({})
      });
      setFavorite(Boolean(data.favorite));
    } catch (error) {
      setFavorite(!nextFavorite);
      setFavoriteError(error.message || 'Could not update favorites. Please try again.');
    } finally {
      setFavoriteBusy(false);
    }
  }

  return (
    <section className="movie-page">
      <div className="movie-detail">
        <div className="detail-poster" style={!movie.coverUrl ? { background: moviePosterFallback(movie) } : undefined}>
          {movie.coverUrl ? <img className="detail-poster-image" src={movie.coverUrl} alt={movie.title} decoding="async" fetchPriority="high" /> : null}
          {!movie.coverUrl ? <span>{movie.title}</span> : null}
        </div>
        <div className="detail-copy">
          <p className="eyebrow">{movie.type === 'Series' ? t('movie_type_series') : movie.type === 'Animation' ? t('movie_type_animation') : t('movie_type_movie')}</p>
          <h1>{movie.title}</h1>
          <p className="original">{movie.originalTitle}</p>
          <div className="actions">
            <button className={favorite ? 'active-favorite' : ''} disabled={favoriteBusy} onClick={toggleFavorite}>
              <Heart size={18} fill={favorite ? 'currentColor' : 'none'} /> {favorite ? t('remove_favorites') : t('add_favorites')}
            </button>
          </div>
          {favoriteError ? <p className="action-error">{favoriteError}</p> : null}
          <dl className="facts">
            <dt>{t('release_year')}</dt>
            <dd>{movie.year}</dd>
            <dt>{t('country')}</dt>
            <dd>{movie.country}</dd>
            <dt>{t('genre')}</dt>
            <dd className="accent">{movie.genres?.length ? movie.genres.map((genre) => translateGenre(locale, genre)).join(', ') : movie.genre}</dd>
            <dt>{t('duration')}</dt>
            <dd>{formatDuration(movie.duration, locale) || t('uploaded_movie')}</dd>
            <dt>{t('rating')}</dt>
            <dd className="rating">
              <Star size={16} fill="currentColor" /> {Number(movie.rating || 8).toFixed(1)} / 10
            </dd>
            <dt>{t('difficulty')}</dt>
            <dd>{translateAccent(locale, movie.difficulty)}</dd>
            <dt>{t('accent')}</dt>
            <dd>{translateAccent(locale, movie.accent)}</dd>
            <dt>{t('subtitles')}</dt>
            <dd>{t('double_subtitles')}</dd>
          </dl>
          <h2>{t('about_film')}</h2>
          <p className="description">{movie.description}</p>
        </div>
      </div>

      <MoviePlayer movie={movie} subtitles={subtitles} />
    </section>
  );
}

function formatDuration(value, locale) {
  const text = String(value || '');
  if (!/^\d+$/.test(text)) return text;
  const minutes = Number(text);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  if (locale === 'ru') return `${hour} ч ${minute} мин`;
  if (locale === 'tm') return `${hour} sag ${minute} min`;
  return `${hour} h ${minute} min`;
}
