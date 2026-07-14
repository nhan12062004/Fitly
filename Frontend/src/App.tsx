import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import LoadingScreen from './components/LoadingScreen';
import { ToastProvider } from './components/ToastProvider';
import { AuthProvider } from './contexts/AuthContext';
import AuthPage from './pages/AuthPage';
import AICoach from './pages/AICoach';
import AdminPanel from './pages/AdminPanel';
import CourseDetails from './pages/CourseDetails';
import Challenges from './pages/Challenges';
import ChallengeDetails from './pages/ChallengeDetails';
import Dashboard from './pages/Dashboard';
import DietPlan from './pages/DietPlan';
import ExerciseDetails from './pages/ExerciseDetails';
import Exercises from './pages/Exercises';
import LandingPage from './pages/LandingPage';
import Notifications from './pages/Notifications';
import Overview from './pages/Overview';
import PremiumCheckout from './pages/PremiumCheckout';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import Profile from './pages/Profile';
import Progress from './pages/Progress';
import ResetPasswordPage from './pages/ResetPasswordPage';
import TermsOfServicePage from './pages/TermsOfServicePage';
import WorkoutSession from './pages/WorkoutSession';
import BodyAssessmentResult from './pages/BodyAssessmentResult';

const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage'));

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <AuthProvider>
          <ScrollToTop />
          <div className="flex min-h-screen w-full bg-bg-primary font-sans text-text-primary selection:bg-accent selection:text-text-inverse">
            <Suspense fallback={<LoadingScreen />}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/terms" element={<TermsOfServicePage />} />
                <Route path="/privacy" element={<PrivacyPolicyPage />} />
                <Route path="/dieu-khoan" element={<Navigate to="/terms" replace />} />
                <Route path="/chinh-sach-bao-mat" element={<Navigate to="/privacy" replace />} />
                <Route path="/login" element={<AuthPage initialMode="login" />} />
                <Route path="/signup" element={<AuthPage initialMode="signup" />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/assessment" element={<BodyAssessmentResult />} />
                <Route path="/ket-qua-the-trang" element={<Navigate to="/assessment" replace />} />
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
                  <Route path="profile/edit" element={<Profile />} />
                  <Route path="premium" element={<PremiumCheckout />} />
                  <Route path="progress" element={<Progress />} />
                  <Route path="challenges" element={<Challenges />} />
                  <Route path="challenges/:id" element={<ChallengeDetails />} />
                  <Route path="workout-builder" element={<Navigate to="/exercises" replace />} />
                  <Route path="admin-panel" element={<AdminPanel />} />
                </Route>
              </Routes>
            </Suspense>
          </div>
        </AuthProvider>
      </BrowserRouter>
    </ToastProvider>
  );
}
