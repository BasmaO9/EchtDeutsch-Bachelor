import { useState } from 'react';
import { reportsApi } from '../services/api';
import '../styles/ReportModal.css';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMediaId?: string;
  mediaLink?: string;
  evaluationId?: string;
  userId: string;
  userName: string;
}

export default function ReportModal({
  isOpen,
  onClose,
  currentMediaId,
  mediaLink,
  evaluationId,
  userId,
  userName,
}: ReportModalProps) {
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!message.trim()) {
      setError('Please enter a message');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await reportsApi.submitReport({
        userId,
        userName,
        currentMediaId: currentMediaId || '',
        mediaLink: mediaLink || '',
        reportMessage: message.trim(),
        evaluationId,
      });

      setSubmitSuccess(true);
      setMessage('');
      
      // Close modal after 2 seconds
      setTimeout(() => {
        setSubmitSuccess(false);
        onClose();
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setMessage('');
      setError(null);
      setSubmitSuccess(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="report-modal-overlay" onClick={handleClose}>
      <div className="report-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="report-modal-header">
          <h2>Report Bug / Hallucination</h2>
          <button
            className="report-modal-close"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label="Close"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="report-modal-form">
          <div className="report-modal-info">
            <p>Please describe the bug or hallucination you encountered:</p>
            {currentMediaId && (
              <div className="report-info-item">
                <strong>Media ID:</strong> {currentMediaId}
              </div>
            )}
            {evaluationId && (
              <div className="report-info-item">
                <strong>Evaluation ID:</strong> {evaluationId}
              </div>
            )}
          </div>

          <textarea
            className="report-modal-textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe the issue in detail..."
            rows={6}
            disabled={isSubmitting || submitSuccess}
            required
          />

          {error && (
            <div className="report-modal-error">
              {error}
            </div>
          )}

          {submitSuccess && (
            <div className="report-modal-success">
              ✓ Report submitted successfully! Thank you for your feedback.
            </div>
          )}

          <div className="report-modal-actions">
            <button
              type="button"
              className="report-modal-cancel"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="report-modal-submit"
              disabled={isSubmitting || submitSuccess || !message.trim()}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

