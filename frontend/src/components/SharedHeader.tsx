import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { userProfileApi, mediaApi } from '../services/api';
import { authService } from '../services/auth';
import ReportModal from './ReportModal';
import { useReportContext } from '../contexts/ReportContext';
import { getUserIdFromToken } from '../utils/jwt';
import '../styles/Dashboard.css';

export default function SharedHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const [userCefr, setUserCefr] = useState<string>('B1');
  const [userGoal, setUserGoal] = useState<string>('');
  const [userGoalValue, setUserGoalValue] = useState<string>('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [goalDropdownOpen, setGoalDropdownOpen] = useState(false);
  const [updatingGoal, setUpdatingGoal] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [userId, setUserId] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [mediaSourceUrl, setMediaSourceUrl] = useState<string>('');
  const menuRef = useRef<HTMLDivElement>(null);
  const goalDropdownRef = useRef<HTMLDivElement>(null);
  
  // Get evaluation ID from context (if available)
  let evaluationId: string | undefined = undefined;
  try {
    const reportContext = useReportContext();
    evaluationId = reportContext?.evaluationId;
  } catch {
    // Context not available, evaluationId will be undefined
  }

  // Check if we're on scaffold (learning materials) or evaluation page
  const showReportButton = location.pathname.startsWith('/learning/') || location.pathname.startsWith('/evaluation/');
  const showLibraryButton = location.pathname.startsWith('/learning/') || location.pathname.startsWith('/evaluation/');
  
  // Get current media ID from URL
  const currentMediaId = location.pathname.startsWith('/learning/') || location.pathname.startsWith('/evaluation/') 
    ? location.pathname.split('/')[2] 
    : undefined;

  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const profile = await userProfileApi.getProfile();
        if (profile && profile.cefr) {
          setUserCefr(profile.cefr);
        }
        if (profile && (profile as any).goal) {
          const goal = (profile as any).goal;
          const goalMap: Record<string, string> = {
            'vocabulary': 'Vocabulary',
            'reading': 'Comprehension',
            'grammar': 'Grammar',
            'general': 'General'
          };
          setUserGoal(goalMap[goal] || goal.charAt(0).toUpperCase() + goal.slice(1));
          setUserGoalValue(goal);
        }
        // Get user ID from JWT token (most reliable)
        const tokenUserId = getUserIdFromToken();
        if (tokenUserId) {
          setUserId(tokenUserId);
        }
        
        // Get user name from auth service
        const user = authService.getUser();
        if (user) {
          setUserName(user.username || '');
          // Fallback: use user.id if token decode failed
          if (!tokenUserId && user.id) {
            setUserId(user.id);
          }
        }
        
        // Also try to get userId from profile if available (as string)
        if (profile && (profile as any).userId) {
          const profileUserId = String((profile as any).userId);
          if (profileUserId) {
            setUserId(profileUserId);
          }
        }
      } catch (err) {
        console.error('Failed to fetch user profile:', err);
      }
    };

    fetchUserProfile();
  }, []);

  // Fetch media source URL when on learning/evaluation page
  useEffect(() => {
    const fetchMediaSourceUrl = async () => {
      if (!currentMediaId) {
        setMediaSourceUrl('');
        return;
      }

      try {
        const mediaItem = await mediaApi.getById(currentMediaId);
        if (mediaItem && mediaItem.sourceUrl) {
          setMediaSourceUrl(mediaItem.sourceUrl);
        }
      } catch (err) {
        console.error('Failed to fetch media source URL:', err);
        setMediaSourceUrl('');
      }
    };

    if (showReportButton && currentMediaId) {
      fetchMediaSourceUrl();
    }
  }, [currentMediaId, showReportButton]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (goalDropdownRef.current && !goalDropdownRef.current.contains(event.target as Node)) {
        setGoalDropdownOpen(false);
      }
    };

    if (menuOpen || goalDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen, goalDropdownOpen]);

  const handleGoalChange = async (newGoal: string) => {
    if (updatingGoal || newGoal === userGoalValue) {
      setGoalDropdownOpen(false);
      return;
    }

    setUpdatingGoal(true);
    try {
      const currentProfile = await userProfileApi.getProfile();
      const goalMap: Record<string, string> = {
        'vocabulary': 'Vocabulary',
        'reading': 'Comprehension',
        'grammar': 'Grammar',
      };
      
      await userProfileApi.saveProfile({
        cefr: currentProfile.cefr,
        interests: currentProfile.interests || [],
        goal: newGoal,
        confidence: currentProfile.confidence || 'medium',
        studyMajor: currentProfile.studyMajor,
      });

      setUserGoal(goalMap[newGoal] || newGoal.charAt(0).toUpperCase() + newGoal.slice(1));
      setUserGoalValue(newGoal);
      setGoalDropdownOpen(false);
    } catch (error) {
      console.error('Failed to update goal:', error);
      alert('Failed to update learning goal. Please try again.');
    } finally {
      setUpdatingGoal(false);
    }
  };

  const handleSignOut = () => {
    authService.logout();
    navigate('/');
  };

  const handleBack = () => {
    // If we're on the dashboard, don't show back button (handled by showBackButton)
    if (location.pathname === '/dashboard') {
      return;
    }
    // Check if there's history to go back to
    // If coming from external link or direct navigation, go to dashboard
    if (window.history.length <= 1) {
      navigate('/dashboard');
    } else {
      navigate(-1);
    }
  };

  const handleLibraryClick = () => {
    navigate('/dashboard');
  };

  // Don't show back button on dashboard
  const showBackButton = location.pathname !== '/dashboard';

  return (
    <header className="dashboard-header-modern">
      <div className="header-left-modern" ref={menuRef}>
        {showBackButton && (
          <button 
            className="back-button-modern"
            onClick={handleBack}
            aria-label="Go back"
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <button 
          className="menu-button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        {menuOpen && (
          <div className="menu-dropdown">
            <button 
              className="menu-dropdown-item sign-out-button"
              onClick={handleSignOut}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9M16 17L21 12M21 12L16 7M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Sign Out
            </button>
          </div>
        )}
      </div>
      <div className="header-right-modern">
        {showLibraryButton && (
          <button
            className="library-button"
            onClick={handleLibraryClick}
            title="Go to Library"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 19.5C4 18.6716 4.67157 18 5.5 18H20.5C21.3284 18 22 18.6716 22 19.5C22 20.3284 21.3284 21 20.5 21H5.5C4.67157 21 4 20.3284 4 19.5Z" fill="currentColor"/>
              <path d="M4 5.5C4 4.67157 4.67157 4 5.5 4H20.5C21.3284 4 22 4.67157 22 5.5C22 6.32843 21.3284 7 20.5 7H5.5C4.67157 7 4 6.32843 4 5.5Z" fill="currentColor"/>
              <path d="M4 12.5C4 11.6716 4.67157 11 5.5 11H20.5C21.3284 11 22 11.6716 22 12.5C22 13.3284 21.3284 14 20.5 14H5.5C4.67157 14 4 13.3284 4 12.5Z" fill="currentColor"/>
            </svg>
            <span>Library</span>
          </button>
        )}
        {showReportButton && (
          <button
            className="report-bug-button"
            onClick={() => setReportModalOpen(true)}
            title="Report Bug / Hallucination"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 9V11M12 15H12.01M5 20H19C19.5304 20 20.0391 19.7893 20.4142 19.4142C20.7893 19.0391 21 18.5304 21 18V6C21 5.46957 20.7893 4.96086 20.4142 4.58579C20.0391 4.21071 19.5304 4 19 4H5C4.46957 4 3.96086 4.21071 3.58579 4.58579C3.21071 4.96086 3 5.46957 3 6V18C3 18.5304 3.21071 19.0391 3.58579 19.4142C3.96086 19.7893 4.46957 20 5 20Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Report Bug</span>
          </button>
        )}
        <div className="level-badge-modern">
          <span className="level-text">Level {userCefr}</span>
          <div className="goal-selector-wrapper" ref={goalDropdownRef}>
            {userGoal ? (
              <button
                className="goal-text-button"
                onClick={() => setGoalDropdownOpen(!goalDropdownOpen)}
                disabled={updatingGoal}
              >
                • {userGoal} {updatingGoal ? '...' : '▼'}
              </button>
            ) : (
              <button
                className="goal-text-button"
                onClick={() => setGoalDropdownOpen(!goalDropdownOpen)}
                disabled={updatingGoal}
              >
                • Select Goal {updatingGoal ? '...' : '▼'}
              </button>
            )}
            {goalDropdownOpen && (
              <div className="goal-dropdown">
                <button
                  className={`goal-option ${userGoalValue === 'vocabulary' ? 'selected' : ''}`}
                  onClick={() => handleGoalChange('vocabulary')}
                  disabled={updatingGoal}
                >
                  Vocabulary
                </button>
                <button
                  className={`goal-option ${userGoalValue === 'reading' ? 'selected' : ''}`}
                  onClick={() => handleGoalChange('reading')}
                  disabled={updatingGoal}
                >
                  Comprehension
                </button>
                <button
                  className={`goal-option ${userGoalValue === 'grammar' ? 'selected' : ''}`}
                  onClick={() => handleGoalChange('grammar')}
                  disabled={updatingGoal}
                >
                  Grammar
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="profile-icon-modern">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="8" r="4" fill="currentColor"/>
            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" fill="currentColor"/>
          </svg>
        </div>
      </div>
      <ReportModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        currentMediaId={currentMediaId}
        mediaLink={mediaSourceUrl}
        evaluationId={evaluationId}
        userId={userId}
        userName={userName}
      />
    </header>
  );
}

