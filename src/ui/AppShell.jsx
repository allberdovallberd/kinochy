import { LogOut, Search } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { withBasePath } from '../paths.js';
import { getLanguageOptions, LocaleProvider, t } from './locale.jsx';
import AuthPage from '../views/AuthPage.jsx';

export default function AppShell() {
  const [search, setSearch] = useState('');
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [locale, setLocale] = useState(() => window.localStorage.getItem('kinochy_locale') || 'tm');
  const navigate = useNavigate();
  const location = useLocation();
  const isVocabulary = location.pathname === '/vocabulary';
  const isFavorites = location.pathname === '/favorites';
  const category = new URLSearchParams(location.search).get('category') || 'Movie';
  const loggedOut = !checking && !user;
  const publicHeader = checking || !user;
  const languageOptions = getLanguageOptions();

  useEffect(() => {
    window.localStorage.setItem('kinochy_locale', locale);
  }, [locale]);

  useEffect(() => {
    setChecking(true);
    api('/api/users/me')
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (user?.language) setLocale(user.language);
  }, [user?.language]);

  function submitSearch(event) {
    event.preventDefault();
    navigate(`/?search=${encodeURIComponent(search)}`);
  }

  async function changeLanguage(nextLocale) {
    setLocale(nextLocale);
    if (!user) return;
    try {
      const data = await api('/api/users/language', {
        method: 'PATCH',
        body: JSON.stringify({ language: nextLocale })
      });
      setUser(data.user);
    } catch {
      setLocale(user.language || 'tm');
    }
  }

  async function logout() {
    await api('/api/users/logout', { method: 'POST', body: JSON.stringify({}) });
    setUser(null);
    setConfirmLogout(false);
    navigate('/');
  }

  const tr = (key) => t(locale, key);

  return (
    <LocaleProvider value={{ locale, setLocale: changeLanguage, t: tr, languageOptions }}>
      <div className="app">
        <header className={`topbar ${publicHeader ? 'public-topbar' : ''}`}>
          <Link to="/" className="brand" aria-label="Kinochy home">
            <span className="brand-mark">
              <img src={withBasePath('/kinochy_favicon.png')} alt="" width="32" height="32" />
            </span>
            <span>Kinochy</span>
          </Link>

          {user ? (
            <>
              <nav className="nav-tabs">
                <Link className={category === 'Movie' && !isVocabulary && !isFavorites ? 'selected' : ''} to="/?category=Movie">{tr('nav_movies')}</Link>
                <Link className={category === 'Series' ? 'selected' : ''} to="/?category=Series">{tr('nav_series')}</Link>
                <Link className={category === 'Animation' ? 'selected' : ''} to="/?category=Animation">{tr('nav_animations')}</Link>
                <Link className={isFavorites ? 'selected' : ''} to="/favorites">{tr('nav_favorites')}</Link>
                <Link className={isVocabulary ? 'selected' : ''} to="/vocabulary">{tr('nav_vocabulary')}</Link>
              </nav>
              <form className="search" onSubmit={submitSearch}>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr('search_placeholder')} />
                <button aria-label={tr('search_label')}>
                  <Search size={21} />
                </button>
              </form>
              <div className="language-picker">
                <select value={locale} onChange={(event) => changeLanguage(event.target.value)} aria-label={tr('language_label')}>
                  {languageOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="top-actions">
                <span className="username-pill">{user?.username || user?.email}</span>
                <button className="logout-button" onClick={() => setConfirmLogout(true)} aria-label={tr('logout_title')}>
                  <LogOut size={18} />
                </button>
              </div>
            </>
          ) : null}
        </header>

        <main>{checking ? <div className="status" /> : loggedOut ? <AuthPage embedded onAuth={setUser} /> : <Outlet />}</main>

        {confirmLogout ? (
          <div className="modal-backdrop" onClick={() => setConfirmLogout(false)}>
            <div className="confirm-panel" onClick={(event) => event.stopPropagation()}>
              <h2>{tr('logout_confirm_title')}</h2>
              <p>{tr('logout_confirm_body')}</p>
              <div>
                <button onClick={() => setConfirmLogout(false)}>{tr('cancel')}</button>
                <button className="danger" onClick={logout}>
                  {tr('logout_title')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </LocaleProvider>
  );
}
