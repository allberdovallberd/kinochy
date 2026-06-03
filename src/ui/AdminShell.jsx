import { useEffect, useState } from 'react';
import AdminPage from '../views/AdminPage.jsx';
import { getLanguageOptions, LocaleProvider, t } from './locale.jsx';

export default function AdminShell() {
  const [locale, setLocale] = useState(() => window.localStorage.getItem('kinochy_locale') || 'tm');
  const languageOptions = getLanguageOptions();

  useEffect(() => {
    window.localStorage.setItem('kinochy_locale', locale);
  }, [locale]);

  const tr = (key) => t(locale, key);

  return (
    <LocaleProvider value={{ locale, setLocale, t: tr, languageOptions }}>
      <div className="app admin-app">
        <AdminPage />
      </div>
    </LocaleProvider>
  );
}
