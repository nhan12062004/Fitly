import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import LoadingScreen from './components/LoadingScreen';
import { ToastProvider } from './components/ToastProvider';
import { AuthProvider } from './contexts/AuthContext';

const AuthPage = lazy(() => import('./pages/AuthPage'));
const AICoach = lazy(() => import('./pages/AICoach'));
const AccountDeletionPage = lazy(() => import('./pages/AccountDeletionPage'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const CourseDetails = lazy(() => import('./pages/CourseDetails'));
const Challenges = lazy(() => import('./pages/Challenges'));
const ChallengeDetails = lazy(() => import('./pages/ChallengeDetails'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const DietPlan = lazy(() => import('./pages/DietPlan'));
const ExerciseDetails = lazy(() => import('./pages/ExerciseDetails'));
const Exercises = lazy(() => import('./pages/Exercises'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Overview = lazy(() => import('./pages/Overview'));
const PremiumCheckout = lazy(() => import('./pages/PremiumCheckout'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'));
const Profile = lazy(() => import('./pages/Profile'));
const Progress = lazy(() => import('./pages/Progress'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const TermsOfServicePage = lazy(() => import('./pages/TermsOfServicePage'));
const WorkoutSession = lazy(() => import('./pages/WorkoutSession'));

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    // Also reset the dashboard scroll container (overflow-y-auto div)
    const scrollRegion = document.querySelector('.app-scroll-region');
    if (scrollRegion) {
      scrollRegion.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
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
                <Route path="/account-deletion" element={<AccountDeletionPage />} />
                <Route path="/dieu-khoan" element={<Navigate to="/terms" replace />} />
                <Route path="/chinh-sach-bao-mat" element={<Navigate to="/privacy" replace />} />
                <Route path="/login" element={<AuthPage initialMode="login" />} />
                <Route path="/signup" element={<AuthPage initialMode="signup" />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route element={<Dashboard />}>
                  <Route path="assessment" element={null} />
                  <Route path="assessment/survey" element={null} />
                  <Route path="assessment/meals" element={null} />
                  <Route path="nutrition-assessment" element={null} />
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
