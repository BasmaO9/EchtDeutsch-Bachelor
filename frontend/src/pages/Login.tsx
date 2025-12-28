import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import loginIllustration from '../assets/login-illustration.png';
import dwLogo from '../assets/dw.jpg';
import ytLogo from '../assets/yt.png';
import liechtLogo from '../assets/liecht.jpg';
import { authService } from '../services/auth';
import '../styles/Login.css';

export default function Login() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [showTooltip, setShowTooltip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Register form state
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');

  // Calculate floating logo positions once on mount - memoized to prevent recalculation on re-renders
  const floatingLogos = useMemo(() => {
    return [...Array(60)].map((_, i) => {
      const logos = [dwLogo, ytLogo, liechtLogo];
      const logo = logos[i % 3];
      const logoName = i % 3 === 0 ? 'dw' : i % 3 === 1 ? 'yt' : 'liecht';
      
      // Even distribution across entire background using grid-like pattern
      // Calculate positions to cover all areas including corners and bottom half
      const cols = 8; // 8 columns
      const rows = 8; // 8 rows
      const col = i % cols;
      const row = Math.floor(i / cols) % rows;
      
      // Distribute evenly with some randomness for natural look
      const baseLeft = (col / (cols - 1)) * 100;
      const baseTop = (row / (rows - 1)) * 100;
      
      // Add small random offset (±3%) to avoid perfect grid alignment
      // These random values are calculated once and stored
      const randomOffsetX = (Math.random() - 0.5) * 6;
      const randomOffsetY = (Math.random() - 0.5) * 6;
      
      const leftPos = `${Math.max(2, Math.min(98, baseLeft + randomOffsetX))}%`;
      const topPos = `${Math.max(2, Math.min(98, baseTop + randomOffsetY))}%`;
      
      return {
        key: i,
        logo,
        logoName,
        leftPos,
        topPos,
        animationDelay: `${i * 0.25}s`,
        animationDuration: `${10 + (i % 7) * 2}s`,
      };
    });
  }, []); // Empty dependency array means this only runs once on mount

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    try {
      if (!loginEmail || !loginPassword) {
        setError('Please fill in all fields');
        setLoading(false);
        return;
      }
      
      await authService.login({
        email: loginEmail,
        password: loginPassword,
      });
      
      // Redirect to dashboard after login
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    try {
      if (!registerUsername || !registerEmail || !registerPassword) {
        setError('Please fill in all fields');
        setLoading(false);
        return;
      }
      
      if (registerPassword.length < 6) {
        setError('Password must be at least 6 characters long');
        setLoading(false);
        return;
      }
      
      await authService.signup({
        username: registerUsername,
        email: registerEmail,
        password: registerPassword,
      });
      
      // Redirect to onboarding page after signup
      navigate('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign up');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Floating Background Logos */}
      <div className="floating-background-logos">
        {floatingLogos.map((logoData) => (
          <div
            key={logoData.key}
            className={`floating-logo floating-logo-${logoData.logoName}`}
            style={{
              left: logoData.leftPos,
              top: logoData.topPos,
              animationDelay: logoData.animationDelay,
              animationDuration: logoData.animationDuration,
            }}
          >
            <img src={logoData.logo} alt={logoData.logoName} />
          </div>
        ))}
      </div>

      <div className="login-header">
        <h1 className="login-brand-title">EchtDeutsch</h1>
        <p className="login-motto">Learn German beyond the textbook!</p>
      </div>
      
      <div className="login-main-card">
        {/* Information Icon */}
        <div 
          className="info-icon-container-main"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <div className="info-icon">i</div>
            {showTooltip && (
              <div className="tooltip">
                EchtDeutsch helps learners improve their German by engaging with authentic media from YouTube and German news platforms like Deutsche Welle and Nachrichtenleicht.
              </div>
            )}
        </div>

        {/* Left Side - Illustration */}
        <div className="login-illustration">
          <img 
            src={loginIllustration} 
            alt="Woman with laptop learning German" 
            className="login-illustration-image"
          />
        </div>

        {/* Right Side - Form */}
        <div className="login-form-container">
          <div className="form-overlay">
            {/* Tabs */}
            <div className="form-tabs">
              <button
                className={`tab-button ${activeTab === 'login' ? 'active' : ''}`}
                onClick={() => setActiveTab('login')}
              >
                LOGIN
              </button>
              <button
                className={`tab-button ${activeTab === 'register' ? 'active' : ''}`}
                onClick={() => setActiveTab('register')}
              >
                REGISTER
              </button>
            </div>

            {/* Login Form */}
            {activeTab === 'login' && (
              <form className="login-form" onSubmit={handleLogin}>
                {error && (
                  <div style={{ color: '#ef4444', fontSize: '0.875rem', marginBottom: '1rem', padding: '0.5rem', background: '#fee2e2', borderRadius: '8px' }}>
                    {error}
                  </div>
                )}
                <div className="form-group">
                  <label htmlFor="login-email">E-Mail</label>
                  <input
                    type="email"
                    id="login-email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    placeholder="Enter your email"
                    disabled={loading}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="login-password">Password</label>
                  <input
                    type="password"
                    id="login-password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    placeholder="Enter your password"
                    disabled={loading}
                  />
                </div>
                <button type="submit" className="submit-button login-submit" disabled={loading}>
                  {loading ? 'Loading...' : 'Continue'}
                </button>
              </form>
            )}

            {/* Register Form */}
            {activeTab === 'register' && (
              <form className="login-form" onSubmit={handleRegister}>
                {error && (
                  <div style={{ color: '#ef4444', fontSize: '0.875rem', marginBottom: '1rem', padding: '0.5rem', background: '#fee2e2', borderRadius: '8px' }}>
                    {error}
                  </div>
                )}
                <div className="form-group">
                  <label htmlFor="register-username">Username</label>
                  <input
                    type="text"
                    id="register-username"
                    value={registerUsername}
                    onChange={(e) => setRegisterUsername(e.target.value)}
                    required
                    placeholder="Choose a username"
                    disabled={loading}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="register-email">E-Mail</label>
                  <input
                    type="email"
                    id="register-email"
                    value={registerEmail}
                    onChange={(e) => setRegisterEmail(e.target.value)}
                    required
                    placeholder="Enter your email"
                    disabled={loading}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="register-password">Password</label>
                  <input
                    type="password"
                    id="register-password"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    required
                    placeholder="Create a password (min 6 characters)"
                    disabled={loading}
                  />
                </div>
                <button type="submit" className="submit-button register-submit" disabled={loading}>
                  {loading ? 'Loading...' : 'Continue'}
                </button>
              </form>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

