import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { evaluationApi, resultsApi, type Evaluation } from '../services/api';
import { authService } from '../services/auth';
import SharedHeader from '../components/SharedHeader';
import { useReportContext } from '../contexts/ReportContext';
import dwLogo from '../assets/dw.jpg';
import ytLogo from '../assets/yt.png';
import liechtLogo from '../assets/liecht.jpg';
import '../styles/Evaluation.css';

interface EvaluationItem {
  id: string;
  prompt_de: string;
  type: 'flashcard' | 'mcq' | 'fill' | 'short_answer';
  answer_de?: string;
  expected_answer_de?: string;
  options_de?: string[];
  correct_index?: number;
  correct_indices?: number[]; // For multiple blanks
  blank_sentence_de?: string;
  draggable_options_de?: string[];
  feedback_if_correct_de?: string;
  feedback_if_incorrect_de?: string;
  // Short answer question fields
  model_answer_de?: string;
  model_answer_en_hidden?: string;
  // English helper fields (hidden in UI unless toggled)
  prompt_en_hidden?: string;
  answer_en_hidden?: string;
  expected_answer_en_hidden?: string;
  options_en_hidden?: string[];
  blank_sentence_en_hidden?: string;
  draggable_options_en_hidden?: string[];
  feedback_if_correct_en_hidden?: string;
  feedback_if_incorrect_en_hidden?: string;
  // New flashcard fields
  confirm_choices?: string[];
  instructions_de?: string;
  instructions_en?: string;
  source_span?: { start_char: number; end_char: number };
  // Context sentence for grammar MCQs (tense questions)
  context_sentence_de?: string;
  context_sentence_en_hidden?: string;
}

interface EvaluationPhase {
  phase: 'flashcard' | 'mcq' | 'fill' | 'short_answer';
  items: EvaluationItem[];
}

interface EvalData {
  metadata?: { cefr: string; purpose: string; interests: string[]; studyMajor?: string };
  evaluation: EvaluationPhase[];
}

// Flashcard Component
function FlashcardItem({
  item,
  onAnswer,
  feedback,
  showEnglish,
  cefrLevel,
}: {
  item: EvaluationItem;
  onAnswer: (answer: 'correct' | 'incorrect') => void;
  feedback?: { correct: boolean; feedback: string };
  showEnglish: boolean;
  cefrLevel?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [timerExpired, setTimerExpired] = useState(false);
  const [userFlippedBeforeTimeout, setUserFlippedBeforeTimeout] = useState(false);

  // Calculate timer duration based on CEFR level
  const getTimerDuration = (cefr: string | undefined): number => {
    if (!cefr) return 10; // Default to B1-B2 timing
    const level = cefr.toUpperCase();
    if (level === 'A1' || level === 'A2') return 15;
    if (level === 'B1' || level === 'B2') return 10;
    if (level === 'C1' || level === 'C2') return 5;
    return 10; // Default
  };

  // Reset flipped state and timer when item changes
  useEffect(() => {
    setFlipped(false);
    setTimerExpired(false);
    setUserFlippedBeforeTimeout(false);
    const duration = getTimerDuration(cefrLevel);
    setTimeRemaining(duration);
  }, [item.id, cefrLevel]);

  // Timer countdown effect
  useEffect(() => {
    if (flipped || feedback || timeRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          // Timer expired - auto-flip and mark as wrong
          setTimerExpired(true);
          setFlipped(true);
          // Mark as incorrect after a brief delay to show the flip animation
          setTimeout(() => {
            onAnswer('incorrect');
          }, 500);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [flipped, feedback, timeRemaining, onAnswer]);

  const handleFlip = () => {
    if (!flipped && !feedback && !timerExpired) {
      setFlipped(true);
      setUserFlippedBeforeTimeout(true);
    }
  };

  return (
    <div className={`flashcard-game ${flipped ? 'flipped' : ''} ${feedback ? 'answered' : ''}`} onClick={handleFlip}>
      <div className="flashcard-game-inner">
        <div className="flashcard-game-front">
          <div className="flashcard-icon">🎴</div>
          {!flipped && !feedback && (
            <div className={`flashcard-timer ${timeRemaining <= 3 ? 'timer-warning' : ''}`}>
              {timeRemaining}s
            </div>
          )}
          <div className="flashcard-prompt-text">
            {item.prompt_de}
            {showEnglish && item.prompt_en_hidden && (
              <div className="english-translation">{item.prompt_en_hidden}</div>
            )}
          </div>
          <div className="flashcard-hint-text">Klicke, um die Antwort zu sehen</div>
        </div>
        <div className="flashcard-game-back" onClick={(e) => e.stopPropagation()}>
          <div className="flashcard-answer-text">
            {item.answer_de}
            {showEnglish && item.answer_en_hidden && (
              <div className="english-translation">{item.answer_en_hidden}</div>
            )}
          </div>
          {!feedback && userFlippedBeforeTimeout && (
            <div className="flashcard-actions">
              {item.instructions_de && (
                <div className="flashcard-instructions">
                  {showEnglish && item.instructions_en ? item.instructions_en : item.instructions_de}
                </div>
              )}
              <button
                type="button"
                className="flashcard-check-button"
                onClick={() => onAnswer('correct')}
              >
                {item.confirm_choices?.[0] || '✓'}
              </button>
              <button
                type="button"
                className="flashcard-x-button"
                onClick={() => onAnswer('incorrect')}
              >
                {item.confirm_choices?.[1] || '✗'}
              </button>
            </div>
          )}
          {feedback && (
            <div className={`flashcard-feedback-badge ${feedback.correct ? 'correct' : 'incorrect'}`}>
              {feedback.correct ? '✓ Correct!' : '✗ Incorrect'}
              <div className="feedback-message">{feedback.feedback}</div>
            </div>
          )}
          {timerExpired && !feedback && (
            <div className="flashcard-timeout-message">
              Zeit abgelaufen - Als falsch markiert
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// MCQ Component
function MCQItem({
  item,
  onAnswer,
  selected,
  feedback,
  showEnglish,
}: {
  item: EvaluationItem;
  onAnswer: (index: number) => void;
  selected?: number;
  feedback?: { correct: boolean; feedback: string };
  showEnglish: boolean;
}) {
  // Check if this question has context sentence (grammar tense questions or vocabulary synonym/antonym questions)
  const hasContextSentence = item.context_sentence_de && item.context_sentence_de.trim().length > 0;
  const isVocabularyQuestion = item.prompt_de?.includes('Synonym') || item.prompt_de?.includes('Gegenteil');

  return (
    <div className="mcq-game-container">
      <div className="mcq-icon">❓</div>
      {hasContextSentence && (
        <div className="mcq-context-sentence">
          <div className="context-label">{isVocabularyQuestion ? 'Aus dem Text:' : 'Kontext:'}</div>
          <div className="context-text">
            {item.context_sentence_de}
            {item.context_sentence_en_hidden && (
              <div className="english-translation">{item.context_sentence_en_hidden}</div>
            )}
          </div>
        </div>
      )}
      <div className="mcq-question-text">
        {item.prompt_de}
        {showEnglish && item.prompt_en_hidden && (
          <div className="english-translation">{item.prompt_en_hidden}</div>
        )}
      </div>
      <div className="mcq-options-grid">
        {item.options_de?.map((option, idx) => {
          const isSelected = selected === idx;
          const isCorrect = idx === (item.correct_index ?? 0);
          const showCorrect = feedback && !feedback.correct && isCorrect;
          const optionEn = item.options_en_hidden?.[idx];
          
          return (
            <button
              key={idx}
              type="button"
              className={`mcq-option-button ${isSelected ? 'selected' : ''} ${showCorrect ? 'correct-answer' : ''} ${feedback ? 'answered' : ''}`}
              onClick={() => !feedback && onAnswer(idx)}
              disabled={!!feedback}
            >
              <span className="option-letter">{String.fromCharCode(65 + idx)}</span>
              <span className="option-text">
                {option}
                {showEnglish && optionEn && (
                  <span className="english-translation">{optionEn}</span>
                )}
              </span>
              {isSelected && feedback && (
                <span className="option-result">{feedback.correct ? '✓' : '✗'}</span>
              )}
            </button>
          );
        })}
      </div>
      {feedback && (
        <div className={`feedback-box ${feedback.correct ? 'correct' : 'incorrect'}`}>
          <div className="feedback-icon">{feedback.correct ? '🎉' : '💡'}</div>
          <div className="feedback-text">{feedback.feedback}</div>
        </div>
      )}
    </div>
  );
}

// Short Answer Question Component
function ShortAnswerItem({
  item,
  onAnswer,
  onFeedback,
  userAnswer,
  feedback,
  showEnglish,
  mediaId,
}: {
  item: EvaluationItem;
  onAnswer: (answer: string) => void;
  onFeedback: (feedback: { correct: boolean; feedback: string; modelAnswer: string }) => void;
  userAnswer?: string;
  feedback?: { correct: boolean; feedback: string; modelAnswer: string };
  showEnglish: boolean;
  mediaId: string;
}) {
  const [answer, setAnswer] = useState(userAnswer || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!answer.trim() || isSubmitting || feedback) return;
    
    setIsSubmitting(true);
    try {
      // Call backend to get LLM feedback
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'}/personalization/${mediaId}/short-answer-feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authService.getAuthHeader(),
        },
        body: JSON.stringify({
          question: item.prompt_de,
          userAnswer: answer.trim(),
          modelAnswer: item.model_answer_de || '',
          questionEn: item.prompt_en_hidden,
          modelAnswerEn: item.model_answer_en_hidden,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get feedback');
      }

      const feedbackData = await response.json();
      onAnswer(answer.trim());
      onFeedback(feedbackData);
    } catch (error) {
      console.error('Error getting feedback:', error);
      // Fallback: just submit the answer with basic feedback
      onAnswer(answer.trim());
      const isCorrect = answer.trim().toLowerCase() === (item.model_answer_de || '').trim().toLowerCase();
      onFeedback({
        correct: isCorrect,
        feedback: isCorrect ? 'Richtig! Sehr gut!' : `Die richtige Antwort ist: ${item.model_answer_de || ''}`,
        modelAnswer: item.model_answer_de || '',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="short-answer-container">
      <div className="short-answer-icon">✍️</div>
      <div className="short-answer-question">
        {item.prompt_de}
        {showEnglish && item.prompt_en_hidden && (
          <div className="english-translation">{item.prompt_en_hidden}</div>
        )}
      </div>
      <div className="short-answer-input-container">
        <input
          type="text"
          className="short-answer-input"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Deine Antwort (1-2 Wörter)..."
          disabled={!!feedback || isSubmitting}
          onKeyPress={(e) => {
            if (e.key === 'Enter' && !isSubmitting && !feedback) {
              handleSubmit();
            }
          }}
        />
        {!feedback && (
          <button
            type="button"
            className="short-answer-submit-button"
            onClick={handleSubmit}
            disabled={!answer.trim() || isSubmitting}
          >
            {isSubmitting ? 'Wird überprüft...' : 'Antwort absenden'}
          </button>
        )}
      </div>
      {feedback && (
        <div className={`short-answer-feedback ${feedback.correct ? 'correct' : 'incorrect'}`}>
          <div className="feedback-icon">{feedback.correct ? '🎉' : '💡'}</div>
          <div className="feedback-text">{feedback.feedback}</div>
          <div className="model-answer">
            <strong>Richtige Antwort:</strong> {feedback.modelAnswer}
            {showEnglish && item.model_answer_en_hidden && (
              <span className="english-translation">{item.model_answer_en_hidden}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Fill-in-the-Blanks Component
function FillInItem({
  item,
  onAnswer,
  selected,
  feedback,
  showEnglish,
}: {
  item: EvaluationItem;
  onAnswer: (blankIndex: number, option: string) => void;
  selected?: string[]; // Array of selected options for each blank
  feedback?: { correct: boolean; feedback: string };
  showEnglish: boolean;
}) {
  const sentence = item.blank_sentence_de || '';
  
  // Debug logging
  if (!sentence) {
    console.error('FillInItem: Missing blank_sentence_de', item);
  }
  
  // Handle both __[1]__ format and ____ format
  const placeholderRegex = /__\[\d+\]__/g;
  const hasNumberedPlaceholders = placeholderRegex.test(sentence);
  
  let parts: string[] = [];
  let partsEn: string[] = [];
  let blankCount = 0;
  
  if (hasNumberedPlaceholders) {
    // Split by numbered placeholders like __[1]__, __[2]__, etc.
    parts = sentence.split(/__\[\d+\]__/);
    const sentenceEn = item.blank_sentence_en_hidden || '';
    partsEn = sentenceEn ? sentenceEn.split(/__\[\d+\]__/) : [];
    // Count number of placeholders
    const matches = sentence.match(/__\[\d+\]__/g);
    blankCount = matches ? matches.length : 0;
    
    // Debug logging
    if (blankCount === 0) {
      console.warn('FillInItem: Found numbered placeholder format but blankCount is 0', {
        sentence,
        matches,
        parts
      });
    }
  } else {
    // Fallback to old format with ____
    parts = sentence.split('____');
    const sentenceEn = item.blank_sentence_en_hidden || '';
    partsEn = sentenceEn ? sentenceEn.split('____') : [];
    blankCount = parts.length - 1;
    
    // Debug logging
    if (blankCount === 0 && sentence) {
      console.warn('FillInItem: No blanks found in sentence', {
        sentence,
        parts
      });
    }
  }
  
  // Debug logging for blank detection
  console.log('FillInItem render:', {
    itemId: item.id,
    sentence: sentence.substring(0, 50),
    hasNumberedPlaceholders,
    blankCount,
    partsLength: parts.length,
    draggableOptionsCount: item.draggable_options_de?.length || 0
  });
  
  // Get correct indices (array for multiple blanks or single index)
  const correctIndices = item.correct_indices || (item.correct_index !== undefined ? [item.correct_index] : [0]);
  const selectedArray = selected || Array(blankCount).fill(null);
  
  // Check if all blanks are filled
  const allFilled = selectedArray.every(sel => sel !== null && sel !== undefined);
  
  return (
    <div className="fill-game-container">
      <div className="fill-icon">✏️</div>
      <div className="fill-question-text">
        {item.prompt_de}
        {showEnglish && item.prompt_en_hidden && (
          <div className="english-translation">{item.prompt_en_hidden}</div>
        )}
      </div>
      <div className="fill-sentence-box">
        {parts.map((part, partIndex) => (
          <span key={partIndex}>
            <span className="sentence-part">
              {part}
              {showEnglish && partsEn[partIndex] && (
                <span className="english-translation">{partsEn[partIndex]}</span>
              )}
            </span>
            {partIndex < blankCount && (
              <span 
                className={`fill-blank-box ${selectedArray[partIndex] ? 'filled' : ''} ${feedback ? (feedback.correct ? 'correct' : 'incorrect') : ''} ${!feedback && selectedArray[partIndex] ? 'clickable' : ''}`}
                onClick={() => {
                  // Allow clicking to clear if not answered
                  if (!feedback && selectedArray[partIndex]) {
                    onAnswer(partIndex, '');
                  }
                }}
              >
                {selectedArray[partIndex] || (hasNumberedPlaceholders ? `__[${partIndex + 1}]__` : '____')}
                {showEnglish && selectedArray[partIndex] && item.draggable_options_en_hidden && (
                  <span className="english-translation">
                    {item.draggable_options_en_hidden[item.draggable_options_de?.indexOf(selectedArray[partIndex]!) ?? -1]}
                  </span>
                )}
              </span>
            )}
          </span>
        ))}
      </div>
      <div className="fill-options-grid">
        {item.draggable_options_de?.map((option, idx) => {
          // Check if this option is selected in any blank
          const isSelected = selectedArray.some(sel => sel === option);
          // Find which blank index this option is selected in (if any)
          const selectedBlankIndex = selectedArray.findIndex(sel => sel === option);
          const isCorrect = correctIndices.includes(idx);
          const showCorrect = feedback && !feedback.correct && isCorrect;
          const optionEn = item.draggable_options_en_hidden?.[idx];
          // Option is "used" if it's selected and all blanks are filled
          const isUsed = isSelected && allFilled;
          
          return (
            <button
              key={idx}
              type="button"
              className={`fill-option-button ${isSelected ? 'selected' : ''} ${showCorrect ? 'correct-answer' : ''} ${feedback ? 'answered' : ''} ${isUsed ? 'used' : ''}`}
              onClick={() => {
                if (!feedback && !allFilled) {
                  // If option is already selected, allow clicking to clear it
                  if (isSelected && selectedBlankIndex !== -1) {
                    onAnswer(selectedBlankIndex, '');
                  } else {
                    // Find first empty blank
                    const emptyIndex = selectedArray.findIndex(sel => !sel || sel === null || sel === '');
                    if (emptyIndex !== -1) {
                      onAnswer(emptyIndex, option);
                    }
                  }
                } else if (!feedback && allFilled && isSelected) {
                  // Allow clearing even when all filled (before feedback)
                  onAnswer(selectedBlankIndex, '');
                }
              }}
              disabled={!!feedback || (allFilled && !isSelected && !feedback)}
            >
              {option}
              {showEnglish && optionEn && (
                <span className="english-translation">{optionEn}</span>
              )}
            </button>
          );
        })}
      </div>
      {allFilled && !feedback && (
        <div className="fill-check-container">
          <button
            type="button"
            className="check-answer-button"
            onClick={() => {
              // Trigger answer check when all blanks are filled
              onAnswer(-1, ''); // Use -1 as special index to indicate "check all"
            }}
          >
            Antwort überprüfen
          </button>
        </div>
      )}
      {feedback && (
        <div className={`feedback-box ${feedback.correct ? 'correct' : 'incorrect'}`}>
          <div className="feedback-icon">{feedback.correct ? '🎉' : '💡'}</div>
          <div className="feedback-text">{feedback.feedback}</div>
        </div>
      )}
    </div>
  );
}

export default function Evaluation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setEvaluationId } = useReportContext();
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [feedback, setFeedback] = useState<Record<string, { correct: boolean; feedback: string; modelAnswer?: string }>>({});
  const [evalData, setEvalData] = useState<EvalData | null>(null);
  const [showEnglish, setShowEnglish] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [results, setResults] = useState<{
    questionsAnsweredCorrectly: number[];
    questionsAnsweredWrong: number[];
    finalScore: number;
    totalQuestions: number;
    percentage: number;
  } | null>(null);

  // Calculate floating logo positions once using useRef
  const floatingLogosRef = useRef<Array<{
    key: number;
    logo: string;
    logoName: string;
    leftPos: string;
    topPos: string;
    size: number;
    animationDelay: string;
    animationDuration: string;
  }> | null>(null);

  // Lazy initialization - only runs once, never again
  if (floatingLogosRef.current === null) {
    floatingLogosRef.current = [...Array(250)].map((_, i) => {
      const logos = [dwLogo, ytLogo, liechtLogo];
      const logo = logos[i % 3];
      const logoName = i % 3 === 0 ? 'dw' : i % 3 === 1 ? 'yt' : 'liecht';
      
      const leftPos = `${2 + Math.random() * 96}%`;
      const topPos = `${2 + Math.random() * 96}%`;
      const sizeVariation = 0.6 + (Math.random() * 0.8);
      const animationDelay = `${Math.random() * 20}s`;
      const animationDuration = `${8 + Math.random() * 12}s`;
      
      return {
        key: i,
        logo,
        logoName,
        leftPos,
        topPos,
        size: sizeVariation,
        animationDelay,
        animationDuration,
      };
    });
  }

  const floatingLogos = floatingLogosRef.current;

  useEffect(() => {
    const fetchEvaluation = async () => {
      if (!id) {
        setError('Media ID is required');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const evalData = await evaluationApi.getByMediaId(id);
        setEvaluation(evalData);
        
        // Set evaluation ID in context for report modal
        setEvaluationId(evalData._id);
        
        // Parse evaluation data
        const parsed = typeof evalData.evaluationData === 'string' 
          ? JSON.parse(evalData.evaluationData) 
          : evalData.evaluationData;
        setEvalData(parsed);
      } catch (err: any) {
        setError(err.message || 'Failed to load evaluation. Please make sure the evaluation has been generated.');
      } finally {
        setLoading(false);
      }
    };

    fetchEvaluation();
  }, [id]);

  const handleAnswer = (itemId: string, answer: any, blankIndex?: number) => {
    if (!evalData) return;
    
    const phase = evalData.evaluation[phaseIndex];
    const item = phase.items[itemIndex];
    
    // For fill-in items with multiple blanks, handle array of answers
    if (item.type === 'fill' && blankIndex !== undefined && blankIndex >= 0) {
      const currentAnswers = (answers[itemId] as string[]) || [];
      const correctIndices = item.correct_indices || (item.correct_index !== undefined ? [item.correct_index] : [0]);
      
      // Count blanks from sentence placeholders (more reliable than correctIndices.length)
      const sentence = item.blank_sentence_de || '';
      const placeholderMatches = sentence.match(/__\[\d+\]__/g);
      const blankCountFromSentence = placeholderMatches ? placeholderMatches.length : (sentence.split('____').length - 1);
      const blankCount = blankCountFromSentence > 0 ? blankCountFromSentence : correctIndices.length;
      
      // Initialize array if needed
      const newAnswers = currentAnswers.length === blankCount ? [...currentAnswers] : Array(blankCount).fill(null);
      
      // Update the specific blank
      if (answer === '') {
        // Clear this blank
        newAnswers[blankIndex] = null as any;
      } else {
        newAnswers[blankIndex] = answer;
      }
      
      setAnswers(prev => ({ ...prev, [itemId]: newAnswers }));
      
      // Check if all blanks are filled
      const allFilled = newAnswers.every((ans) => ans !== null && ans !== undefined && ans !== '');
      
      if (allFilled) {
        // Check all answers
        const allCorrect = newAnswers.every((ans, idx) => {
          const correctIndex = correctIndices[idx];
          const correctAnswer = item.draggable_options_de?.[correctIndex];
          return ans === correctAnswer;
        });
        
        setFeedback(prev => ({
          ...prev,
          [itemId]: {
            correct: allCorrect,
            feedback: allCorrect ? 'Richtig! Sehr gut!' : 'Falsch'
          }
        }));
      }
      return;
    }
    
    // Special case: check all blanks (blankIndex === -1)
    if (item.type === 'fill' && blankIndex === -1) {
      const currentAnswers = (answers[itemId] as string[]) || [];
      const correctIndices = item.correct_indices || (item.correct_index !== undefined ? [item.correct_index] : [0]);
      
      // Count blanks from sentence placeholders to ensure we check the right number
      const sentence = item.blank_sentence_de || '';
      const placeholderMatches = sentence.match(/__\[\d+\]__/g);
      const blankCountFromSentence = placeholderMatches ? placeholderMatches.length : (sentence.split('____').length - 1);
      const blankCount = blankCountFromSentence > 0 ? blankCountFromSentence : correctIndices.length;
      
      // Ensure we have answers for all blanks
      const answersArray = currentAnswers.length === blankCount ? currentAnswers : [...currentAnswers, ...Array(blankCount - currentAnswers.length).fill(null)];
      
      const allCorrect = answersArray.every((ans, idx) => {
        if (idx >= correctIndices.length) return false;
        const correctIndex = correctIndices[idx];
        const correctAnswer = item.draggable_options_de?.[correctIndex];
        return ans === correctAnswer;
      });
      
      setFeedback(prev => ({
        ...prev,
        [itemId]: {
          correct: allCorrect,
          feedback: allCorrect ? 'Richtig! Sehr gut!' : 'Falsch'
        }
      }));
      return;
    }
    
    // For other types (mcq, flashcard) or single blank fill
    setAnswers(prev => ({ ...prev, [itemId]: answer }));
    
    // Check answer immediately
    let isCorrect = false;
    if (item.type === 'mcq') {
      isCorrect = answer === item.correct_index;
    } else if (item.type === 'fill') {
      const correct = item.draggable_options_de?.[item.correct_index ?? 0];
      isCorrect = answer === correct;
    } else if (item.type === 'flashcard') {
      // For flashcards, answer is 'correct' or 'incorrect' (self-assessment)
      isCorrect = answer === 'correct';
    }
    
    setFeedback(prev => ({
      ...prev,
      [itemId]: {
        correct: isCorrect,
        feedback: item.type === 'fill' 
          ? (isCorrect ? 'Richtig! Sehr gut!' : 'Falsch')
          : (isCorrect 
            ? (item.feedback_if_correct_de || 'Richtig! Sehr gut!') 
            : (item.feedback_if_incorrect_de || `Die richtige Antwort ist: ${item.expected_answer_de || ''}`))
      }
    }));
  };

  const handleNext = () => {
    if (!evalData) return;
    
    const phase = evalData.evaluation[phaseIndex];
    if (itemIndex < phase.items.length - 1) {
      setItemIndex(itemIndex + 1);
    } else if (phaseIndex < evalData.evaluation.length - 1) {
      setPhaseIndex(phaseIndex + 1);
      setItemIndex(0);
    }
    // Don't auto-navigate - let user click Finish button
  };

  const handlePrev = () => {
    if (!evalData) return;
    
    if (itemIndex > 0) {
      setItemIndex(itemIndex - 1);
    } else if (phaseIndex > 0) {
      setPhaseIndex(phaseIndex - 1);
      setItemIndex(evalData.evaluation[phaseIndex - 1].items.length - 1);
    }
  };

  const calculateScores = (): {
    questionsAnsweredCorrectly: number[];
    questionsAnsweredWrong: number[];
    finalScore: number;
  } => {
    if (!evalData || !evaluation) {
      return {
        questionsAnsweredCorrectly: [],
        questionsAnsweredWrong: [],
        finalScore: 0,
      };
    }

    const questionsAnsweredCorrectly: number[] = [];
    const questionsAnsweredWrong: number[] = [];
    let questionNumber = 1; // Start numbering from 1

    // Iterate through all phases
    for (let phaseIdx = 0; phaseIdx < evalData.evaluation.length; phaseIdx++) {
      const phase = evalData.evaluation[phaseIdx];
      
      // Iterate through all items in this phase
      for (let itemIdx = 0; itemIdx < phase.items.length; itemIdx++) {
        const item = phase.items[itemIdx];
        const itemId = item.id;
        const itemFeedback = feedback[itemId];

        // Check if answer is correct based on feedback
        // For fill-in-the-blanks with multiple blanks, feedback.correct is true only if ALL blanks are correct
        if (itemFeedback && itemFeedback.correct === true) {
          questionsAnsweredCorrectly.push(questionNumber);
        } else {
          // Answer was incorrect, not provided, or feedback not set - count as wrong
          questionsAnsweredWrong.push(questionNumber);
        }

        questionNumber++;
      }
    }

    const finalScore = questionsAnsweredCorrectly.length;

    return {
      questionsAnsweredCorrectly,
      questionsAnsweredWrong,
      finalScore,
    };
  };

  const handleFinish = async () => {
    if (!evalData || !evaluation) return;

    try {
      // Calculate scores
      const scores = calculateScores();
      
      // Calculate total questions
      const totalQuestions = scores.questionsAnsweredCorrectly.length + scores.questionsAnsweredWrong.length;
      const percentage = totalQuestions > 0 ? Math.round((scores.finalScore / totalQuestions) * 100) : 0;

      // Submit results to backend
      await resultsApi.create(
        evaluation._id,
        evaluation.personalizationId,
        scores.questionsAnsweredCorrectly,
        scores.questionsAnsweredWrong,
        scores.finalScore
      );

      // Show results screen instead of navigating
      setResults({
        ...scores,
        totalQuestions,
        percentage,
      });
      setIsFinished(true);
    } catch (error: any) {
      console.error('Failed to save results:', error);
      // Still show results even if saving fails
      const scores = calculateScores();
      const totalQuestions = scores.questionsAnsweredCorrectly.length + scores.questionsAnsweredWrong.length;
      const percentage = totalQuestions > 0 ? Math.round((scores.finalScore / totalQuestions) * 100) : 0;
      setResults({
        ...scores,
        totalQuestions,
        percentage,
      });
      setIsFinished(true);
    }
  };

  if (loading) {
    return (
      <div className="evaluation-page">
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
                transform: `scale(${logoData.size})`,
              }}
            >
              <img src={logoData.logo} alt={logoData.logoName} />
            </div>
          ))}
        </div>
        <SharedHeader />
        <div className="loading-container">
          <div className="loading-spinner-large"></div>
          <p>Lade dein Quiz...</p>
        </div>
      </div>
    );
  }

  if (error || !evaluation || !evalData) {
    return (
      <div className="evaluation-page">
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
                transform: `scale(${logoData.size})`,
              }}
            >
              <img src={logoData.logo} alt={logoData.logoName} />
            </div>
          ))}
        </div>
        <SharedHeader />
        <div className="error-container">
          <div className="error-icon">⚠️</div>
          <h2>Evaluation nicht verfügbar</h2>
          <p>{error || 'Evaluation nicht gefunden. Bitte generiere sie zuerst.'}</p>
          <button className="back-to-materials-button" onClick={() => navigate(`/learning/${id}`)}>
            Zurück zu den Lernmaterialien
          </button>
        </div>
      </div>
    );
  }

  // Show results screen if finished
  if (isFinished && results) {
    const getGradeEmoji = (percentage: number) => {
      if (percentage >= 90) return '🏆';
      if (percentage >= 80) return '⭐';
      if (percentage >= 70) return '👍';
      if (percentage >= 60) return '📚';
      return '💪';
    };

    const getGradeText = (percentage: number) => {
      if (percentage >= 90) return 'Ausgezeichnet!';
      if (percentage >= 80) return 'Sehr gut!';
      if (percentage >= 70) return 'Gut gemacht!';
      if (percentage >= 60) return 'Nicht schlecht!';
      return 'Weiter so!';
    };

    return (
      <div className="evaluation-page">
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
                transform: `scale(${logoData.size})`,
              }}
            >
              <img src={logoData.logo} alt={logoData.logoName} />
            </div>
          ))}
        </div>
        <SharedHeader />
        <div className="evaluation-main-content">
          <div className="evaluation-section results-section">
            <div className="section-header">
              <div className="section-title">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
                </svg>
                <h2>
                  Quiz-Ergebnisse
                  <span className="section-subtitle">Quiz Results</span>
                </h2>
              </div>
            </div>
            <div className="results-content">
              <div className="results-icon-wrapper">
                <div className="results-icon">{getGradeEmoji(results.percentage)}</div>
              </div>
              <h1 className="results-title">{getGradeText(results.percentage)}</h1>
              <div className="results-score-display">
                <div className="score-circle">
                  <div className="score-percentage">{results.percentage}%</div>
                  <div className="score-fraction">{results.finalScore} / {results.totalQuestions}</div>
                </div>
              </div>
              <div className="results-breakdown">
                <div className="breakdown-item correct-breakdown">
                  <div className="breakdown-icon">✓</div>
                  <div className="breakdown-content">
                    <span className="breakdown-label">Richtig</span>
                    <span className="breakdown-value">{results.questionsAnsweredCorrectly.length}</span>
                  </div>
                </div>
                <div className="breakdown-item incorrect-breakdown">
                  <div className="breakdown-icon">✗</div>
                  <div className="breakdown-content">
                    <span className="breakdown-label">Falsch</span>
                    <span className="breakdown-value">{results.questionsAnsweredWrong.length}</span>
                  </div>
                </div>
              </div>
              <div className="results-actions">
                <button
                  type="button"
                  className="results-button back-to-personalization"
                  onClick={() => navigate(`/learning/${id}`)}
                >
                  ← Zurück zu den Lernmaterialien
                </button>
                <button
                  type="button"
                  className="results-button back-to-library"
                  onClick={() => navigate('/dashboard')}
                >
                  📚 Zur Bibliothek
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const phase = evalData.evaluation[phaseIndex];
  const item = phase.items[itemIndex];
  const phaseNames = { flashcard: 'Karteikarten', mcq: 'Multiple Choice', fill: 'Lückentext', short_answer: 'Kurze Antworten' };
  const phaseIcons = { flashcard: '🎴', mcq: '❓', fill: '✏️', short_answer: '✍️' };
  
  const isLastItem = itemIndex === phase.items.length - 1;
  const isLastPhase = phaseIndex === evalData.evaluation.length - 1;
  
  // Debug logging for fill phase
  if (phase.phase === 'fill') {
    console.log('=== FILL PHASE DEBUG ===');
    console.log('Phase index:', phaseIndex);
    console.log('Item index:', itemIndex);
    console.log('Total items in phase:', phase.items.length);
    console.log('Current item:', {
      id: item?.id,
      blank_sentence_de: item?.blank_sentence_de?.substring(0, 80) || 'MISSING',
      has_blank: (item?.blank_sentence_de || '').includes('__[1]__'),
      draggable_options_count: item?.draggable_options_de?.length || 0
    });
    console.log('All items in phase:', phase.items.map((it: any, idx: number) => ({
      index: idx,
      id: it.id,
      blank_sentence_de: it.blank_sentence_de?.substring(0, 50) || 'MISSING',
      has_blank: (it.blank_sentence_de || '').includes('__[1]__')
    })));
  }

  return (
    <div className="evaluation-page">
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
              transform: `scale(${logoData.size})`,
            }}
          >
            <img src={logoData.logo} alt={logoData.logoName} />
          </div>
        ))}
      </div>
      <SharedHeader />
      
      <div className="evaluation-main-content">
        <div className="evaluation-section">
          <div className="section-header">
            <div className="section-title">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
              </svg>
              <h2>
                {phaseNames[phase.phase]}
                <span className="section-subtitle">{phaseIcons[phase.phase]} Phase {phaseIndex + 1} von {evalData.evaluation.length} • Frage {itemIndex + 1} von {phase.items.length}</span>
              </h2>
            </div>
          </div>

          <div className="game-content-area">
            <div className="question-header">
              <button
                type="button"
                className="toggle-english-button"
                onClick={() => setShowEnglish(!showEnglish)}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 1.5L10.5 6L15 7.5L10.5 9L9 13.5L7.5 9L3 7.5L7.5 6L9 1.5Z" fill="currentColor"/>
                </svg>
                {showEnglish ? 'Englisch ausblenden' : 'Englisch anzeigen'}
              </button>
            </div>
            
            {phase.phase === 'flashcard' && (
              <FlashcardItem 
                item={item} 
                onAnswer={(answer) => handleAnswer(item.id, answer)} 
                feedback={feedback[item.id]} 
                showEnglish={showEnglish}
                cefrLevel={evalData.metadata?.cefr}
              />
            )}
            
            {phase.phase === 'mcq' && (
              <MCQItem 
                item={item} 
                onAnswer={(idx) => handleAnswer(item.id, idx)} 
                selected={answers[item.id]} 
                feedback={feedback[item.id]} 
                showEnglish={showEnglish}
              />
            )}
            
            {phase.phase === 'fill' && (
              <FillInItem 
                item={item} 
                onAnswer={(blankIndex, opt) => handleAnswer(item.id, opt, blankIndex)} 
                selected={answers[item.id] as string[]} 
                feedback={feedback[item.id]} 
                showEnglish={showEnglish}
              />
            )}
            
            {phase.phase === 'short_answer' && (
              <ShortAnswerItem 
                item={item} 
                onAnswer={(answer) => handleAnswer(item.id, answer)} 
                onFeedback={(fb) => {
                  setFeedback(prev => ({
                    ...prev,
                    [item.id]: fb,
                  }));
                }}
                userAnswer={answers[item.id]} 
                feedback={feedback[item.id] as { correct: boolean; feedback: string; modelAnswer: string } | undefined}
                showEnglish={showEnglish}
                mediaId={id || ''}
              />
            )}
          </div>

          <div className="navigation-controls">
            <button 
              type="button" 
              className="nav-button-prev" 
              onClick={handlePrev} 
              disabled={phaseIndex === 0 && itemIndex === 0}
            >
              ← Zurück
            </button>
            
            {isLastItem && isLastPhase ? (
              <button type="button" className="nav-button-finish" onClick={handleFinish}>
                Finish
              </button>
            ) : (
              <button type="button" className="nav-button-next" onClick={handleNext}>
                {isLastItem ? `Nächste Phase →` : 'Weiter →'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

