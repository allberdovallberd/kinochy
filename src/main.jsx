import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './ui/AppShell.jsx';
import AuthPage from './views/AuthPage.jsx';
import './styles.css';

const AdminShell = lazy(() => import('./ui/AdminShell.jsx'));
const FavoritesPage = lazy(() => import('./views/FavoritesPage.jsx'));
const HomePage = lazy(() => import('./views/HomePage.jsx'));
const MoviePage = lazy(() => import('./views/MoviePage.jsx'));
const VocabularyPage = lazy(() => import('./views/VocabularyPage.jsx'));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="status app-status">Loading...</div>}>
        <Routes>
          <Route path="/admin/*" element={<AdminShell />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/movies/:slug" element={<MoviePage />} />
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/vocabulary" element={<VocabularyPage />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
