import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router';
import { LandingPage } from '../features/landing/LandingPage';
import s from './App.module.css';

const ServiceApp = lazy(() => import('./ServiceApp'));

export function App() {
  const { pathname } = useLocation();

  // The public page never mounts session, microphone, or event connections.
  if (pathname === '/') return <LandingPage />;

  return (
    <Suspense
      fallback={
        <div className={s.initial} role="status">
          말모아를 준비하고 있어요.
        </div>
      }
    >
      <ServiceApp />
    </Suspense>
  );
}
