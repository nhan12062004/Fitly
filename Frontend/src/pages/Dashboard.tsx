import { Suspense, useState, useEffect } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import Sidebar from '../layout/Sidebar';
import TopBar from '../layout/TopBar';
import SurveyForm, { type SurveyPlanSummary } from '../components/SurveyForm';
import SurveyResultScreen from '../components/SurveyResultScreen';
import ProfileModal from '../components/ProfileModal';
import ChangePasswordModal from '../components/ChangePasswordModal';
import { useAuth } from '../contexts/AuthContext';
import LoadingScreen from '../components/LoadingScreen';

export default function Dashboard() {
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const { isLoggedIn, hasProfile, isCheckingProfile, refreshProfile } = useAuth();

  const [hasShownSurvey, setHasShownSurvey] = useState(false);
  const [surveyPlanSummary, setSurveyPlanSummary] = useState<SurveyPlanSummary | null>(null);

  // Keep track if we've already shown the survey to prevent unmounting it during background profile checks (like when switching tabs)
  useEffect(() => {
    if (isLoggedIn && !hasProfile && !isCheckingProfile) {
      setHasShownSurvey(true);
    }
    if (!isLoggedIn) {
      setHasShownSurvey(false);
      setSurveyPlanSummary(null);
    }
  }, [isLoggedIn, hasProfile, isCheckingProfile]);

  const handleSurveyComplete = async (summary?: SurveyPlanSummary) => {
    if (summary) setSurveyPlanSummary(summary);
    await refreshProfile();
  };

  const startFirstDay = () => {
    setSurveyPlanSummary(null);
    navigate('/overview', { replace: true });
  };

  // 1. Loading state - Chỉ hiện LoadingScreen toàn màn hình nếu đây là lần đầu kiểm tra và chưa có profile
  // Nếu đã có profile (đang refresh) hoặc đã hiện SurveyForm thì giữ nguyên UI để tránh flickering
  if (isCheckingProfile && !hasProfile && !hasShownSurvey) {
    return <LoadingScreen fullScreen />;
  }

  if (isLoggedIn && surveyPlanSummary) {
    return <SurveyResultScreen summary={surveyPlanSummary} onStart={startFirstDay} />;
  }

  // 2. Nếu đã đăng nhập nhưng chưa có Profile -> Bắt buộc làm Survey
  if (isLoggedIn && !hasProfile) {
    return (
      <div className="h-screen w-full bg-bg-primary overflow-y-auto">
        <SurveyForm onComplete={handleSurveyComplete} />
      </div>
    );
  }

  // 3. Nếu đã có Profile hoặc chưa đăng nhập (guest) -> Hiện Dashboard bình thường
  if (!isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex w-full h-screen overflow-hidden bg-bg-primary">
      {/* Profile Editor Modal */}
      <ProfileModal 
        isOpen={isProfileOpen} 
        onClose={() => setIsProfileOpen(false)} 
      />

      {/* Password Change Modal */}
      <ChangePasswordModal 
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
      />

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar 
          onClose={() => setIsMobileMenuOpen(false)} 
          onProfileClick={() => setIsProfileOpen(true)} 
          onPasswordClick={() => setIsPasswordModalOpen(true)}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 w-full h-screen overflow-y-auto custom-scrollbar">
        <TopBar onMenuClick={() => setIsMobileMenuOpen(true)} onProfileClick={() => setIsProfileOpen(true)} />
        <main className="flex min-h-0 flex-1 flex-col gap-6 bg-bg-primary px-4 pb-4 pt-5 md:px-6 md:pb-6 md:pt-7 lg:px-7 xl:flex-row min-w-0 relative">
          <div className="mx-auto w-full">
            <Suspense fallback={null}>
              <Outlet context={{ onProfileClick: () => setIsProfileOpen(true) }} />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
