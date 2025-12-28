import { useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { userProfileApi } from '../services/api';
import dwLogo from '../assets/dw.jpg';
import ytLogo from '../assets/yt.png';
import liechtLogo from '../assets/liecht.jpg';
import '../styles/Onboarding.css';

const cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const interestOptions = [
  'Travel',
  'Culture',
  'Technology',
  'Environment/Climate',
  'Business',
  'Food',
  'Sports',
  'Student Life',
  'Science',
];

const learningObjectives = [
  { value: 'vocabulary', label: 'Vocabulary building' },
  { value: 'reading', label: 'Reading comprehension' },
  { value: 'grammar', label: 'Grammar and language structure' },
];

const studyMajors = [
  'Literature / Languages',
  'History',
  'Philosophy',
  'Visual Arts / Design',
  'Performing Arts',
  'Social Sciences',
  'Business Administration',
  'Economics',
  'Finance / Accounting',
  'Marketing / Management',
  'Computer Science / IT',
  'Engineering',
  'Mathematics / Statistics',
  'Natural Sciences (Biology, Chemistry, Physics, etc.)',
  'Medicine',
  'Nursing',
  'Pharmacy',
  'Public Health',
  'Law & Public Policy',
  'Biomedical Sciences',
  'Media & Communication',
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [cefr, setCefr] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [goal, setGoal] = useState('');
  const [studyMajor, setStudyMajor] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Other-interest state
  const [otherInterest, setOtherInterest] = useState('');
  const [showOtherInput, setShowOtherInput] = useState(false);
  // Keep the confirmed custom value in ref so we can update/remove it easily
  const confirmedOtherRef = useRef<string | null>(null);

  // Calculate floating logo positions once on mount - memoized to prevent recalculation on re-renders
  const floatingLogos = useMemo(() => {
    return [...Array(60)].map((_, i) => {
      const logos = [dwLogo, ytLogo, liechtLogo];
      const logo = logos[i % 3];
      const logoName = i % 3 === 0 ? 'dw' : i % 3 === 1 ? 'yt' : 'liecht';
      
      // Even distribution across entire background using grid-like pattern
      const cols = 8;
      const rows = 8;
      const col = i % cols;
      const row = Math.floor(i / cols) % rows;
      
      const baseLeft = (col / (cols - 1)) * 100;
      const baseTop = (row / (rows - 1)) * 100;
      
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
  }, []);

  // Toggle a built-in interest (not "Other")
  const toggleInterest = (interest: string) => {
    // If interest is already selected, remove it
    if (interests.includes(interest)) {
      setInterests((prev) => prev.filter((i) => i !== interest));
      return;
    }
    // If not selected, add only if capacity allows
    if (interests.length < 5) {
      setInterests((prev) => [...prev, interest]);
    }
  };

  // Toggle the "Other" input open/closed
  const toggleOther = () => {
    // If opening and no capacity and there's no confirmed other to replace, do nothing
    const hasConfirmedOther = Boolean(confirmedOtherRef.current);
    if (!showOtherInput && interests.length >= 5 && !hasConfirmedOther) {
      return;
    }

    if (!showOtherInput) {
      // opening: show input and prefill with confirmedOther if exists
      setShowOtherInput(true);
      setOtherInterest(confirmedOtherRef.current ?? '');
    } else {
      // closing: hide input and remove confirmed other (if present)
      setShowOtherInput(false);
      if (confirmedOtherRef.current) {
        setInterests((prev) => prev.filter((i) => i !== confirmedOtherRef.current));
        confirmedOtherRef.current = null;
      }
      setOtherInterest('');
    }
  };

  // Confirm the custom other interest (Add or Update)
  const confirmOtherInterest = () => {
    const trimmed = otherInterest.trim();
    if (!trimmed) {
      // if blank, remove any existing confirmed other
      if (confirmedOtherRef.current) {
        setInterests((prev) => prev.filter((i) => i !== confirmedOtherRef.current!));
        confirmedOtherRef.current = null;
      }
      setOtherInterest('');
      return;
    }

    // If the trimmed interest already exists among normal interests (no duplication), just set confirmed ref and ensure it's in list once
    setInterests((prev) => {
      // Remove previous confirmed other if present
      const withoutPrevOther = prev.filter((i) => i !== confirmedOtherRef.current);
      // If trimmed already present, just set confirmed ref to trimmed and keep list (no duplicates)
      if (withoutPrevOther.includes(trimmed)) {
        confirmedOtherRef.current = trimmed;
        return withoutPrevOther;
      }
      // If there's capacity (after removing previous other), add the trimmed
      if (withoutPrevOther.length < 5) {
        confirmedOtherRef.current = trimmed;
        return [...withoutPrevOther, trimmed];
      }
      // No capacity: do NOT add; keep previous list unchanged (do not add duplicate)
      return withoutPrevOther;
    });
    // keep the input shown so user can edit if needed
  };

  // Handle Enter key in the other input to confirm
  const handleOtherKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmOtherInterest();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // close other input (this will remove confirmed other as per toggleOther)
      toggleOther();
    }
  };

  const isValid = Boolean(cefr && interests.length > 0 && interests.length <= 5 && goal);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      setError('Please answer all questions.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Final cleanup: ensure no empty strings and remove any stray placeholders
      let finalInterests = interests.filter((i) => i && i.trim() !== '').map(i => i.trim());

      // If showOtherInput is true and user typed but didn't press Add, we shouldn't auto-add it.
      // We trust only confirmedOtherRef as custom interest.
      if (confirmedOtherRef.current) {
        // ensure confirmedOther is present in finalInterests
        if (!finalInterests.includes(confirmedOtherRef.current)) {
          // If there's capacity, add it; otherwise, replace the last non-built-in? Simpler: ensure unique and max 5
          finalInterests = [...finalInterests, confirmedOtherRef.current].slice(0, 5);
        }
      } else {
        // If no confirmed custom, ensure no stray values (user typed but didn't confirm)
        // (we already filtered by interests state which we keep clean)
      }

      // Deduplicate and enforce max 5
      finalInterests = Array.from(new Set(finalInterests)).slice(0, 5);

      await userProfileApi.saveProfile({
        cefr,
        interests: finalInterests,
        goal,
        confidence: 'medium', // Default confidence level
        studyMajor: studyMajor || undefined,
      });
      setSuccess(true);
      setTimeout(() => navigate('/dashboard'), 1000);
    } catch (err: any) {
      setError(err?.message || 'Failed to save profile');
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate progress
  const totalQuestions = 3; // CEFR, Interests, Goal
  const answeredQuestions = [cefr, interests.length > 0, goal].filter(Boolean).length;
  const progress = (answeredQuestions / totalQuestions) * 100;

  return (
    <div className="onboarding-page">
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

      <div className="onboarding-header">
        <h1 className="onboarding-brand-title">EchtDeutsch</h1>
        <p className="onboarding-motto">Create Your Learning Profile</p>
      </div>
      
      <div className="onboarding-main-card">
        {/* Form Container - Full Width */}
        <div className="onboarding-form-container">
          <div className="onboarding-form-overlay">
            {/* Progress Bar */}
            <div className="progress-container">
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <span className="progress-text">{answeredQuestions} of {totalQuestions} completed</span>
            </div>

            <form className="onboarding-form" onSubmit={handleSubmit}>
          {/* Question 1: CEFR Level */}
          <div className="onboarding-field">
            <label className="field-label">
              <span>1. What is your current German proficiency (CEFR)?</span>
              <span className="required-indicator">*</span>
            </label>
            <div className="option-grid">
              {cefrLevels.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`option-button ${cefr === level ? 'selected' : ''}`}
                  onClick={() => setCefr(level)}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Question 2: Topics of Interest */}
          <div className="onboarding-field">
            <label className="field-label">
              <span>2. Which topics interest you most? (Choose up to 5)</span>
              <span className="required-indicator">*</span>
            </label>
            {interests.length > 0 && (
              <div className="selection-counter">
                {interests.length} of 5 selected
              </div>
            )}
            <div className="option-grid multi">
              {interestOptions.map((interest) => {
                const isSelected = interests.includes(interest);
                const disabled = !isSelected && interests.length >= 5 && !confirmedOtherRef.current;
                return (
                  <button
                    key={interest}
                    type="button"
                    className={`option-button ${isSelected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
                    onClick={() => toggleInterest(interest)}
                    disabled={disabled}
                  >
                    {interest}
                  </button>
                );
              })}

              {/* Other button */}
              <button
                type="button"
                className={`option-button ${showOtherInput ? 'selected' : ''} ${(!showOtherInput && interests.length >= 5 && !confirmedOtherRef.current) ? 'disabled' : ''}`}
                onClick={toggleOther}
                disabled={!showOtherInput && interests.length >= 5 && !confirmedOtherRef.current}
              >
                Other
              </button>
            </div>

            {showOtherInput && (
              <div className="other-interest-input">
                <input
                  type="text"
                  placeholder="Type your interest here..."
                  value={otherInterest}
                  onChange={(e) => setOtherInterest(e.target.value)}
                  onKeyDown={handleOtherKeyDown}
                  className="text-input"
                  maxLength={50}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className="option-button small"
                    onClick={confirmOtherInterest}
                    disabled={!otherInterest.trim() && !confirmedOtherRef.current}
                  >
                    {confirmedOtherRef.current ? 'Update' : 'Add'}
                  </button>
                  <button
                    type="button"
                    className="option-button small"
                    onClick={() => {
                      // Remove confirmed other if exists
                      if (confirmedOtherRef.current) {
                        setInterests((prev) => prev.filter((i) => i !== confirmedOtherRef.current));
                        confirmedOtherRef.current = null;
                      }
                      setOtherInterest('');
                    }}
                    disabled={!confirmedOtherRef.current}
                  >
                    Remove
                  </button>
                </div>
                <div className="hint">This custom interest counts as one of your up-to-5 selections. Press Enter or Add to confirm.</div>
              </div>
            )}
          </div>

          {/* Question 3: Learning Objective */}
          <div className="onboarding-field">
            <label className="field-label">
              <span>3. What is your primary short-term learning objective?</span>
              <span className="required-indicator">*</span>
            </label>
            <div className="option-grid vertical">
              {learningObjectives.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`option-button large ${goal === option.value ? 'selected' : ''}`}
                  onClick={() => setGoal(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Question 4: Study Major */}
          <div className="onboarding-field">
            <label className="field-label">
              <span>4. What is your study major / academic field?</span>
            </label>
            <select
              value={studyMajor}
              onChange={(e) => setStudyMajor(e.target.value)}
              className="select-field"
            >
              <option value="">Select your field (optional)</option>
              {studyMajors.map((major) => (
                <option key={major} value={major}>
                  {major}
                </option>
              ))}
            </select>
          </div>

          {error && <div className="onboarding-error">{error}</div>}
          {success && (
            <div className="onboarding-success">
              Profile saved successfully! Redirecting...
            </div>
          )}

          <div className="form-footer">
            <button
              type="submit"
              className="submit-button"
              disabled={!isValid || submitting}
            >
              {submitting ? 'Saving...' : 'Complete Profile'}
            </button>
            <p className="form-note">
              <span className="required-indicator">*</span> Required fields
            </p>
          </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
