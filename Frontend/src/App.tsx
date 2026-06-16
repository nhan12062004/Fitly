import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LoadingScreen from './components/LoadingScreen';
import { AuthProvider } from './contexts/AuthContext';
import AuthPage from './pages/AuthPage';
import AICoach from './pages/AICoach';
import AdminPanel from './pages/AdminPanel';
import CourseDetails from './pages/CourseDetails';
import Dashboard from './pages/Dashboard';
import DietPlan from './pages/DietPlan';
import ExerciseDetails from './pages/ExerciseDetails';
import Exercises from './pages/Exercises';
import LandingPage from './pages/LandingPage';
import Notifications from './pages/Notifications';
import Overview from './pages/Overview';
import Profile from './pages/Profile';
import Progress from './pages/Progress';
import WorkoutSession from './pages/WorkoutSession';

const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage'));

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="flex min-h-screen w-full bg-bg-primary font-sans text-text-primary selection:bg-accent selection:text-text-inverse">
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<AuthPage initialMode="login" />} />
              <Route path="/signup" element={<AuthPage initialMode="signup" />} />
              <Route element={<Dashboard />}>
                <Route path="overview" element={<Overview />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="course/:id" element={<CourseDetails />} />
                <Route path="smart-planner" element={<AICoach />} />
                <Route path="exercises" element={<Exercises />} />
                <Route path="exercises/session" element={<WorkoutSession />} />
                <Route path="exercises/details" element={<ExerciseDetails />} />
                <Route path="diet-plan" element={<DietPlan />} />
                <Route path="profile" element={<Profile />} />
                <Route path="progress" element={<Progress />} />
                <Route path="workout-builder" element={<Navigate to="/exercises" replace />} />
                <Route path="admin-panel" element={<AdminPanel />} />
              </Route>
            </Routes>
          </Suspense>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
