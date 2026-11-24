import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './styles/app.css';
import { ScoreboardPage } from './features/scoreboard/ScoreboardPage.tsx';
import { JudgePage } from './features/judge/JudgePage.tsx';

// Judges and spectators never download the admin bundle.
const AdminApp = lazy(() => import('./features/admin/AdminApp.tsx'));

function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24">
      <h1 className="wide text-4xl font-black">Page not found</h1>
      <p className="mt-3 text-muted">
        Go to the <a className="font-semibold underline" href="/">live scoreboard</a>.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ScoreboardPage />} />
        <Route path="/season" element={<ScoreboardPage season />} />
        <Route path="/event/:slug" element={<ScoreboardPage />} />
        <Route path="/judge" element={<JudgePage />} />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<div className="p-6 text-muted">Loading…</div>}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
