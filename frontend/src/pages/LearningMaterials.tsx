import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { mediaApi, userProfileApi, ttsApi, evaluationApi, type Evaluation } from '../services/api';
import { personalizationApi, type PersonalizationSummary, type VocabularyItem, type FunFact } from '../services/api';
import SharedHeader from '../components/SharedHeader';
import dwLogo from '../assets/dw.jpg';
import ytLogo from '../assets/yt.png';
import liechtLogo from '../assets/liecht.jpg';
import '../styles/LearningMaterials.css';

// ============================================
// EVALUATION COMPONENTS - Matching Backend Structure
// ============================================

interface EvaluationMetadata {
  cefr: string;
  purpose: string;
  interests: string[];
  studyMajor?: string;
}

interface EvaluationPhase {
  phase: 'flashcard' | 'mcq' | 'fill' | 'short_answer';
  items: EvaluationItem[];
}

interface EvaluationItem {
  id: string;
  prompt_de: string;
  prompt_en_hidden: string;
  type: 'flashcard' | 'mcq' | 'fill' | 'short_answer';
  // Flashcard fields
  answer_de?: string;
  answer_en_hidden?: string;
  expected_answer_de?: string;
  expected_answer_en_hidden?: string;
  // MCQ fields
  options_de?: string[];
  options_en_hidden?: string[];
  correct_index?: number;
  // Fill-in fields
  blank_sentence_de?: string;
  blank_sentence_en_hidden?: string;
  draggable_options_de?: string[];
  draggable_options_en_hidden?: string[];
  // Short answer fields
  model_answer_de?: string;
  model_answer_en_hidden?: string;
  // Context sentence for grammar MCQs (tense questions) and vocabulary MCQs (synonym/antonym)
  context_sentence_de?: string;
  context_sentence_en_hidden?: string;
  // Feedback fields
  feedback_if_correct_de?: string;
  feedback_if_correct_en_hidden?: string;
  feedback_if_incorrect_de?: string;
  feedback_if_incorrect_en_hidden?: string;
}

interface ParsedEvaluationData {
  metadata: EvaluationMetadata;
  evaluation: EvaluationPhase[];
}

// Flashcard Component - Matches backend structure exactly
function FlashcardItem({ item, itemId, onAnswer, onCheck, feedback }: {
  item: EvaluationItem;
  itemId: string;
  onAnswer: (id: string, answer: any) => void;
  onCheck: (id: string, correct: any, user: any, item: any) => void;
  feedback?: { correct: boolean; feedback: string };
}) {
  const [flipped, setFlipped] = useState(false);

  const handleFlip = () => {
    if (!flipped && !feedback) {
      setFlipped(true);
      // Use answer_de from backend structure
      const userAnswer = item.answer_de || '';
      onAnswer(itemId, userAnswer);
      // Use expected_answer_de for checking
      onCheck(itemId, item.expected_answer_de || '', userAnswer, item);
    }
  };

  return (
    <div className={`flashcard ${flipped ? 'flipped' : ''} ${feedback ? 'answered' : ''}`} onClick={handleFlip}>
      <div className="flashcard-inner">
        <div className="flashcard-front">
          <div className="flashcard-prompt">{item.prompt_de || ''}</div>
          <div className="flashcard-hint">Click to reveal answer</div>
        </div>
        <div className="flashcard-back">
          <div className="flashcard-answer">{item.answer_de || ''}</div>
          {feedback && (
            <div className={`flashcard-feedback ${feedback.correct ? 'correct' : 'incorrect'}`}>
              {feedback.feedback}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// MCQ Component - Matches backend structure exactly
function MCQItem({ item, itemId, onAnswer, onCheck, feedback, answer }: {
  item: EvaluationItem;
  itemId: string;
  onAnswer: (id: string, answer: any) => void;
  onCheck: (id: string, correct: any, user: any, item: any) => void;
  feedback?: { correct: boolean; feedback: string };
  answer?: number;
}) {
  const handleSelect = (index: number) => {
    if (!feedback) {
      onAnswer(itemId, index);
      // Use correct_index from backend structure
      onCheck(itemId, item.correct_index ?? 0, index, item);
    }
  };

  if (!item.options_de || !Array.isArray(item.options_de)) {
    console.error('MCQ item missing options_de:', item);
    return <div className="error-message">Invalid MCQ data</div>;
  }

  const hasContextSentence = item.context_sentence_de && item.context_sentence_de.trim().length > 0;
  const isVocabularyQuestion = item.prompt_de?.includes('Synonym') || item.prompt_de?.includes('Gegenteil');

  return (
    <div className="mcq-item">
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
      <div className="mcq-prompt">{item.prompt_de || ''}</div>
      <div className="mcq-options">
        {item.options_de.map((option: string, index: number) => {
          const isSelected = answer === index;
          const isCorrect = index === (item.correct_index ?? 0);
          const showCorrect = feedback && !feedback.correct && isCorrect;
          
          return (
            <button
              key={index}
              type="button"
              className={`mcq-option ${isSelected ? 'selected' : ''} ${showCorrect ? 'correct-answer' : ''} ${feedback ? 'disabled' : ''}`}
              onClick={() => handleSelect(index)}
              disabled={!!feedback}
            >
              {option}
            </button>
          );
        })}
      </div>
      {feedback && (
        <div className={`mcq-feedback ${feedback.correct ? 'correct' : 'incorrect'}`}>
          {feedback.feedback}
        </div>
      )}
    </div>
  );
}

// Short Answer Question Component
function ShortAnswerItem({
  item,
  itemId,
  onAnswer,
  onFeedback,
  userAnswer,
  feedback,
  showEnglish,
  mediaId,
}: {
  item: EvaluationItem;
  itemId: string;
  onAnswer: (id: string, answer: string) => void;
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
      const { authService } = await import('../services/auth');
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
      onAnswer(itemId, answer.trim());
      onFeedback(feedbackData);
    } catch (error) {
      console.error('Error getting feedback:', error);
      const isCorrect = answer.trim().toLowerCase() === (item.model_answer_de || '').trim().toLowerCase();
      onAnswer(itemId, answer.trim());
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
    <div className="short-answer-item">
      <div className="short-answer-prompt">
        {item.prompt_de || ''}
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
          <div className="feedback-text">{feedback.feedback}</div>
          <div className="model-answer">
            <strong>Richtige Antwort:</strong> {feedback.modelAnswer}
          </div>
        </div>
      )}
    </div>
  );
}

// Fill-in-the-blanks Component - Matches backend structure exactly
function FillInItem({ item, itemId, onAnswer, onCheck, feedback, answer }: {
  item: EvaluationItem;
  itemId: string;
  onAnswer: (id: string, answer: any) => void;
  onCheck: (id: string, correct: any, user: any, item: any) => void;
  feedback?: { correct: boolean; feedback: string };
  answer?: string;
}) {
  const [draggedOption, setDraggedOption] = useState<string | null>(null);
  
  if (!item.draggable_options_de || !Array.isArray(item.draggable_options_de)) {
    console.error('Fill-in item missing draggable_options_de:', item);
    return <div className="error-message">Invalid fill-in data</div>;
  }

  // Use correct_index to get the correct answer from draggable_options_de
  const correctAnswer = item.draggable_options_de[item.correct_index ?? 0] || '';

  const handleDragStart = (e: React.DragEvent, option: string) => {
    if (answer || feedback) return;
    setDraggedOption(option);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedOption && !answer && !feedback) {
      onAnswer(itemId, draggedOption);
      onCheck(itemId, correctAnswer, draggedOption, item);
      setDraggedOption(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleClickOption = (option: string) => {
    if (!answer && !feedback) {
      onAnswer(itemId, option);
      onCheck(itemId, correctAnswer, option, item);
    }
  };

  // Parse blank sentence from blank_sentence_de (backend field)
  const blankSentence = item.blank_sentence_de || item.prompt_de || '';
  const parts = blankSentence.split('____');
  let splitParts: string[] = [];
  if (parts.length > 1) {
    splitParts = parts;
  } else {
    // Try with ___
    const partsUnderscore = blankSentence.split('___');
    splitParts = partsUnderscore.length > 1 ? partsUnderscore : [blankSentence, ''];
  }

  return (
    <div className="fill-item">
      <div className="fill-prompt">{item.prompt_de || ''}</div>
      <div className="fill-sentence">
        {splitParts.map((part: string, index: number) => (
          <span key={index}>
            {part}
            {index === 0 && (
              <span
                className={`fill-blank ${answer ? 'filled' : ''}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
              >
                {answer || '____'}
              </span>
            )}
          </span>
        ))}
      </div>
      <div className="fill-options">
        {item.draggable_options_de.map((option: string, index: number) => {
          const isUsed = answer === option;
          const isCorrect = index === (item.correct_index ?? 0);
          return (
            <div
              key={index}
              className={`fill-option ${isUsed ? 'used' : ''} ${feedback ? 'disabled' : ''} ${feedback && !feedback.correct && isCorrect ? 'correct-answer' : ''}`}
              draggable={!answer && !feedback}
              onDragStart={(e) => handleDragStart(e, option)}
              onClick={() => handleClickOption(option)}
            >
              {option}
            </div>
          );
        })}
      </div>
      {feedback && (
        <div className={`fill-feedback ${feedback.correct ? 'correct' : 'incorrect'}`}>
          {feedback.feedback}
        </div>
      )}
    </div>
  );
}

// Evaluation Phase Component - Completely rewritten to match backend structure
function EvaluationPhase({ evaluation, currentPhaseIndex, currentItemIndex, answers, feedback, onAnswer, onCheck, onNextItem, onPrevItem, onNextPhase, onFinish, currentMediaId }: {
  evaluation: Evaluation | null;
  currentPhaseIndex: number;
  currentItemIndex: number;
  answers: Record<string, any>;
  feedback: Record<string, { correct: boolean; feedback: string }>;
  onAnswer: (id: string, answer: any) => void;
  onCheck: (id: string, correct: any, user: any, item: any) => void;
  onNextItem: () => void;
  onPrevItem: () => void;
  onNextPhase: () => void;
  onFinish: () => void;
  currentMediaId?: string;
}) {
  if (!evaluation) {
    return <div className="error-message">No evaluation data available</div>;
  }

  // Safety check: Ensure evaluation matches current media
  if (evaluation.mediaId && currentMediaId && String(evaluation.mediaId) !== String(currentMediaId)) {
    return <div className="error-message">Evaluation does not match current media. Please refresh.</div>;
  }

  // Parse evaluation data - matches backend structure exactly
  // Handle both stringified JSON and direct JSON objects
  let evalData: ParsedEvaluationData;
  try {
    // case 1: backend sends stringified JSON
    if (typeof evaluation.evaluationData === 'string') {
      evalData = JSON.parse(evaluation.evaluationData);
    } else {
      // case 2: backend already sends JSON object
      evalData = evaluation.evaluationData as ParsedEvaluationData;
    }
  } catch (err) {
    console.error('Failed to parse evaluation data:', err);
    return <div className="error-message">Failed to parse evaluation data</div>;
  }
  
  // Validate structure
  if (!evalData || !evalData.evaluation || !Array.isArray(evalData.evaluation)) {
    console.error('Invalid evaluation data structure:', evalData);
    return <div className="error-message">Invalid evaluation data structure</div>;
  }

  // Extract phases from evaluation array (backend structure)
  const phases = evalData.evaluation || [];
  
  if (phases.length === 0) {
    return <div className="error-message">No evaluation phases found</div>;
  }

  const currentPhaseData = phases[currentPhaseIndex];
  
  if (!currentPhaseData) {
    return <div className="error-message">Phase not found</div>;
  }
  
  const items = currentPhaseData.items || [];
  
  if (items.length === 0) {
    return <div className="error-message">No items found in this phase</div>;
  }

  const currentItem = items[currentItemIndex];
  
  if (!currentItem) {
    return <div className="error-message">Item not found</div>;
  }

  const phaseNames: Record<string, string> = {
    flashcard: 'Flashcards',
    mcq: 'Multiple Choice',
    fill: 'Fill in the Blanks',
    short_answer: 'Short Answer Questions',
  };

  return (
    <div className="evaluation-phase">
      {/* Display metadata if available */}
      {evalData.metadata && (
        <div className="evaluation-metadata">
          <span className="metadata-badge">CEFR: {evalData.metadata.cefr}</span>
          {evalData.metadata.purpose && (
            <span className="metadata-badge">Goal: {evalData.metadata.purpose}</span>
          )}
        </div>
      )}
      
      <div className="phase-header">
        <h4>
          Phase {currentPhaseIndex + 1}: {phaseNames[currentPhaseData.phase] || currentPhaseData.phase}
        </h4>
        <p>Question {currentItemIndex + 1} of {items.length}</p>
      </div>
      
      <div className="evaluation-content">
        {currentPhaseData.phase === 'flashcard' && (
          <FlashcardItem
            item={currentItem}
            itemId={currentItem.id}
            onAnswer={onAnswer}
            onCheck={onCheck}
            feedback={feedback[currentItem.id]}
          />
        )}
        
        {currentPhaseData.phase === 'mcq' && (
          <MCQItem
            item={currentItem}
            itemId={currentItem.id}
            onAnswer={onAnswer}
            onCheck={onCheck}
            feedback={feedback[currentItem.id]}
            answer={answers[currentItem.id]}
          />
        )}
        
        {currentPhaseData.phase === 'fill' && (
          <FillInItem
            item={currentItem}
            itemId={currentItem.id}
            onAnswer={onAnswer}
            onCheck={onCheck}
            feedback={feedback[currentItem.id]}
            answer={answers[currentItem.id]}
          />
        )}
        
        {currentPhaseData.phase === 'short_answer' && (
          <ShortAnswerItem
            item={currentItem}
            itemId={currentItem.id}
            onAnswer={(id, answer) => onAnswer(id, answer)}
            onFeedback={() => {
              // Feedback is handled internally by ShortAnswerItem
            }}
            userAnswer={answers[currentItem.id]}
            feedback={feedback[currentItem.id] as { correct: boolean; feedback: string; modelAnswer: string } | undefined}
            showEnglish={false}
            mediaId={currentMediaId || ''}
          />
        )}
      </div>
      
      <div className="evaluation-navigation">
        {currentItemIndex > 0 && (
          <button type="button" onClick={onPrevItem} className="nav-button">Previous</button>
        )}
        {currentItemIndex < items.length - 1 ? (
          <button type="button" onClick={onNextItem} className="nav-button">Next</button>
        ) : currentPhaseIndex < phases.length - 1 ? (
          <button type="button" onClick={onNextPhase} className="nav-button primary">Next Phase</button>
        ) : (
          <button type="button" onClick={onFinish} className="nav-button primary">Finish Evaluation</button>
        )}
      </div>
    </div>
  );
}

export default function LearningMaterials() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [media, setMedia] = useState<any>(null);
  const [personalization, setPersonalization] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSummaryEnglish, setShowSummaryEnglish] = useState(false);
  const [showVocabEnglish, setShowVocabEnglish] = useState(false);
  const [showFunFactEnglish, setShowFunFactEnglish] = useState(false);
  const [showNaturalExpressionsEnglish, setShowNaturalExpressionsEnglish] = useState(false);
  const [showCultureNuggetEnglish, setShowCultureNuggetEnglish] = useState(false);
  const [showPersonalizableElementEnglish, setShowPersonalizableElementEnglish] = useState(false);
  const autoGenerateRef = useRef(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [_currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [_currentItemIndex, setCurrentItemIndex] = useState(0);
  const [_evaluationAnswers, setEvaluationAnswers] = useState<Record<string, any>>({});
  const [_evaluationFeedback, setEvaluationFeedback] = useState<Record<string, { correct: boolean; feedback: string }>>({});
  const [userProfile, setUserProfile] = useState<any>(null);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const modelProvider: 'openai' | 'groq' | 'gemini' = 'gemini'; // Default model
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [cefrAnalysisExpanded, setCefrAnalysisExpanded] = useState(false);
  const [hasVisitedMediaSource, setHasVisitedMediaSource] = useState(false);

  // Calculate floating logo positions once using useRef - completely isolated from any state changes
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
      
      // Fully random positioning across the entire viewport
      const leftPos = `${2 + Math.random() * 96}%`;
      const topPos = `${2 + Math.random() * 96}%`;
      
      // Varied sizes for more visual interest (60% to 140% of base size)
      const sizeVariation = 0.6 + (Math.random() * 0.8);
      
      // More varied animation delays and durations for natural movement
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

  // Use the ref value - this will always be the same array, never recalculated
  const floatingLogos = floatingLogosRef.current;

  const handleGenerate = useCallback(async () => {
    if (!id || !userProfile) return;
    try {
      setGenerating(true);
      setError(null);
      const data = await personalizationApi.generate(id, {
        cefr: userProfile.cefr,
        interests: userProfile.interests,
        studyMajor: userProfile.studyMajor,
      }, modelProvider);
      setPersonalization(data);
      autoGenerateRef.current = true;
    } catch (err: any) {
      setError(err.message || 'Failed to generate learning materials');
    } finally {
      setGenerating(false);
    }
  }, [id, userProfile]);

  useEffect(() => {
    // Clear evaluation state when media changes
    autoGenerateRef.current = false;
    setEvaluation(null);
    setEvaluationLoading(false);
    setHasVisitedMediaSource(false);
  }, [id]);

  useEffect(() => {
    setShowSummaryEnglish(false);
    setShowVocabEnglish(false);
    setShowFunFactEnglish(false);
    setShowNaturalExpressionsEnglish(false);
    setShowCultureNuggetEnglish(false);
    setShowPersonalizableElementEnglish(false);
  }, [personalization]);

  // Validate evaluation data when it changes
  useEffect(() => {
    if (evaluation) {
      let parsed: any;
      try {
        // case 1: backend sends stringified JSON
        if (typeof evaluation.evaluationData === 'string') {
          parsed = JSON.parse(evaluation.evaluationData);
        } else {
          // case 2: backend already sends JSON object
          parsed = evaluation.evaluationData ?? evaluation;
        }
      } catch (err) {
        console.error('Failed to parse evaluation data in validation:', err);
        return;
      }
      
      if (!parsed || !parsed.evaluation || !Array.isArray(parsed.evaluation)) {
        console.error('Invalid evaluation structure:', parsed);
      }
    }
  }, [evaluation]);

  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const profile = await userProfileApi.getProfile();
        setUserProfile(profile);
      } catch (err) {
        console.error('Failed to fetch user profile:', err);
        // Set default profile if not found
        setUserProfile({
          cefr: 'B1',
          interests: [],
        });
      }
    };
    fetchUserProfile();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      if (!id || !userProfile) return;
      
      try {
        setLoading(true);
        setError(null);
        const mediaData = await mediaApi.getById(id);
        setMedia(mediaData);

        // First, try to fetch existing personalization
        if (!autoGenerateRef.current) {
          autoGenerateRef.current = true;
          try {
            // Try to get existing personalization
            const existingPersonalization = await personalizationApi.getByMediaId(id);
            if (existingPersonalization) {
              // Use existing personalization
              setPersonalization(existingPersonalization);
              console.log('Using existing personalization');
            }
          } catch (err: any) {
            // If personalization doesn't exist (404), generate new
            if (err.message?.includes('404') || err.message?.includes('not found')) {
              console.log('No existing personalization found, generating new...');
              await handleGenerate();
            } else {
              // Other error, still try to generate
              console.error('Error fetching existing personalization:', err);
              await handleGenerate();
            }
          }
        }
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to load data';
        setError(errorMessage);
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    if (userProfile) {
      fetchData();
    }
  }, [id, userProfile, handleGenerate]);

  const fetchEvaluation = useCallback(async () => {
    if (!id) {
      return false;
    }
    
    const currentMediaId = id;
    const currentPersonalizationId = personalization?._id;
    
    try {
      setEvaluationLoading(true);
      // Pass personalizationId to ensure we get the correct evaluation
      console.log('Frontend: Fetching evaluation for mediaId:', currentMediaId, 'personalizationId:', currentPersonalizationId);
      const evalData = await evaluationApi.getByMediaId(currentMediaId, currentPersonalizationId);
      
      console.log('Frontend: Received evaluation:', {
        evaluationId: evalData._id,
        mediaId: evalData.mediaId,
        personalizationId: evalData.personalizationId,
        hasEvaluationData: !!evalData.evaluationData,
      });
      
      // Safety check: Verify mediaId matches before setting evaluation
      if (evalData && evalData.mediaId && String(evalData.mediaId) !== String(currentMediaId)) {
        console.error('MediaId mismatch:', {
          fetchedMediaId: evalData.mediaId,
          currentMediaId: currentMediaId,
        });
        return false;
      }
      
      // Safety check: Verify personalizationId matches if we requested one
      if (currentPersonalizationId && evalData.personalizationId && 
          String(evalData.personalizationId) !== String(currentPersonalizationId)) {
        console.warn('PersonalizationId mismatch:', {
          requested: currentPersonalizationId,
          received: evalData.personalizationId,
        });
        // Don't return false here - might be okay if no personalizationId was requested
      }
      
      if (evalData && evalData.isGenerated) {
        // Validate structure - handle both stringified JSON and direct JSON objects
        let parsed: any;
        try {
          // case 1: backend sends stringified JSON
          if (typeof evalData.evaluationData === 'string') {
            parsed = JSON.parse(evalData.evaluationData);
          } else {
            // case 2: backend already sends JSON object
            parsed = evalData.evaluationData ?? evalData;
          }
        } catch (err) {
          console.error('Failed to parse evaluation data:', err);
          return false;
        }
        
        if (!parsed || !parsed.evaluation || !Array.isArray(parsed.evaluation)) {
          console.error('Invalid evaluation structure');
          return false;
        }
        
        // Log flashcard types to verify correct evaluation
        const flashcards = parsed.evaluation?.[0]?.items || [];
        console.log('Frontend: Parsed evaluation flashcards:', {
          count: flashcards.length,
          firstFlashcard: flashcards[0] ? {
            prompt: flashcards[0].prompt_de?.substring(0, 50),
            answer: flashcards[0].answer_de,
          } : null,
        });
        
        // Double-check mediaId matches before setting (prevent race conditions)
        if (String(evalData.mediaId) !== String(currentMediaId)) {
          console.error('MediaId mismatch after parsing');
          return false;
        }
        
        // Set evaluation state
        setEvaluation(evalData);
        setCurrentPhaseIndex(0);
        setCurrentItemIndex(0);
        setEvaluationAnswers({});
        setEvaluationFeedback({});
        setEvaluationLoading(false);
        return true;
      }
      return false;
    } catch (err: any) {
      // Evaluation might not be generated yet, that's okay
      return false;
    } finally {
      setEvaluationLoading(false);
    }
  }, [id, personalization?._id]);

  useEffect(() => {
    // Fetch evaluation when personalization is ready, with polling
    if (personalization && id) {
      // Clear any existing evaluation first to prevent showing stale data
      setEvaluation(null);
      
      fetchEvaluation();
      
      // Poll for evaluation every 3 seconds if not found
      const pollInterval = setInterval(async () => {
        const currentId = id;
        const found = await fetchEvaluation();
        if (found || currentId !== id) {
          clearInterval(pollInterval);
        }
      }, 3000);

      // Stop polling after 60 seconds
      const timeout = setTimeout(() => {
        clearInterval(pollInterval);
        setEvaluationLoading(false);
      }, 60000);

      return () => {
        clearInterval(pollInterval);
        clearTimeout(timeout);
      };
    }
  }, [personalization, id, fetchEvaluation]);

  const handleGenerateEvaluation = async () => {
    if (!id || !personalization || !userProfile) return;
    try {
      setEvaluationLoading(true);
      setError(null);
      const evalData = await evaluationApi.generate(id, personalization._id, {
        cefr: userProfile.cefr,
        interests: userProfile.interests || [],
        studyMajor: userProfile.studyMajor,
      });
      setEvaluation(evalData);
    } catch (err: any) {
      setError(err.message || 'Failed to generate evaluation');
    } finally {
      setEvaluationLoading(false);
    }
  };

  const handleRegenerateAll = async () => {
    if (!id || !userProfile) return;
    
    try {
      setGenerating(true);
      setError(null);
      // Regenerate the entire scaffold
      const data = await personalizationApi.generate(id, {
        cefr: userProfile.cefr,
        interests: userProfile.interests,
        studyMajor: userProfile.studyMajor,
      }, modelProvider);
      setPersonalization(data);
      
      // Regenerate evaluation after scaffold regeneration
      if (data && data._id) {
        try {
          setEvaluationLoading(true);
          await evaluationApi.generate(id, data._id, {
            cefr: userProfile.cefr,
            interests: userProfile.interests || [],
            studyMajor: userProfile.studyMajor,
          });
          // Fetch the new evaluation
          setTimeout(async () => {
            try {
              const newEval = await evaluationApi.getByMediaId(id, data._id);
              setEvaluation(newEval);
            } catch (err) {
              console.log('Evaluation not ready yet after regeneration');
            } finally {
              setEvaluationLoading(false);
            }
          }, 2000);
        } catch (err) {
          console.error('Failed to regenerate evaluation:', err);
          setEvaluationLoading(false);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to regenerate content');
    } finally {
      setGenerating(false);
    }
  };

  const handleMediaRedirect = () => {
    if (media?.sourceUrl) {
      setHasVisitedMediaSource(true);
      window.open(media.sourceUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSpeakWord = async (word: string) => {
    if (playingAudio === word) {
      // Stop if already playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setPlayingAudio(null);
      }
      return;
    }

    try {
      setPlayingAudio(word);
      
      // Stop any currently playing audio
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      const audioBlob = await ttsApi.speak(word);
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audioRef.current = audio;
      
      audio.onended = () => {
        setPlayingAudio(null);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };
      
      audio.onerror = () => {
        setPlayingAudio(null);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };
      
      await audio.play();
    } catch (err: any) {
      console.error('Error playing audio:', err);
      setPlayingAudio(null);
      if (audioRef.current) {
        audioRef.current = null;
      }
    }
  };

  if (loading) {
    return (
      <div className="learning-materials">
        <div className="loading-state">Loading...</div>
      </div>
    );
  }

  if (error && !media) {
    return (
      <div className="learning-materials">
        <div className="error-state">{error}</div>
      </div>
    );
  }

  if (!media) {
    return (
      <div className="learning-materials">
        <div className="error-state">Media not found</div>
      </div>
    );
  }

  // Parse personalization data
  let summary: PersonalizationSummary | null = null;
  let vocabulary: VocabularyItem[] = [];
  let funFact: FunFact | null = null;
  let naturalExpressions: Array<{ expression: string; usageInTranscript: string; translation: { de: string; en: string } }> = [];
  let cultureNugget: FunFact | null = null;
  let personalizableElement: FunFact | null = null;
  let cefrAnalysis: import('../services/api').CEFRAnalysisResult | null = null;

  if (personalization) {
    try {
      if (personalization.summary) {
        summary = typeof personalization.summary === 'string' 
          ? JSON.parse(personalization.summary) 
          : personalization.summary;
      }
      if (personalization.vocabulary) {
        vocabulary = typeof personalization.vocabulary === 'string'
          ? JSON.parse(personalization.vocabulary)
          : personalization.vocabulary;
      }
      if (personalization.funFact) {
        funFact = typeof personalization.funFact === 'string'
          ? JSON.parse(personalization.funFact)
          : personalization.funFact;
      }
      if (personalization.naturalExpressions) {
        naturalExpressions = typeof personalization.naturalExpressions === 'string'
          ? JSON.parse(personalization.naturalExpressions)
          : personalization.naturalExpressions;
      }
      if (personalization.cultureNugget) {
        cultureNugget = typeof personalization.cultureNugget === 'string'
          ? JSON.parse(personalization.cultureNugget)
          : personalization.cultureNugget;
      }
      if (personalization.personalizableElement) {
        personalizableElement = typeof personalization.personalizableElement === 'string'
          ? JSON.parse(personalization.personalizableElement)
          : personalization.personalizableElement;
      }
      if (personalization.cefrAnalysis) {
        cefrAnalysis = typeof personalization.cefrAnalysis === 'string'
          ? JSON.parse(personalization.cefrAnalysis)
          : personalization.cefrAnalysis;
      }
    } catch (err) {
      console.error('Error parsing personalization data:', err);
    }
  }

  const thumbnailOverrides: Record<string, string> = {
    bayern: '/thumbnails/bayern-munich.jpg',
  };

  const extractYoutubeId = (url?: string) => {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('youtu.be')) {
        return parsed.pathname.slice(1);
      }
      if (parsed.hostname.includes('youtube.com')) {
        if (parsed.pathname.includes('/embed/')) {
          return parsed.pathname.split('/embed/')[1]?.split(/[?/]/)[0] || null;
        }
        return parsed.searchParams.get('v');
      }
    } catch {
      return null;
    }
    return null;
  };

  const getDefaultImage = (type: string, title: string): string => {
    const imageMap: Record<string, string[]> = {
      video: [
        'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=1200&h=600&fit=crop',
        'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1200&h=600&fit=crop',
      ],
      article: [
        'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=1200&h=600&fit=crop',
        'https://images.unsplash.com/photo-1515542622106-78bda8ba0e5b?w=1200&h=600&fit=crop',
      ],
      podcast: [
        'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&h=600&fit=crop',
        'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&h=600&fit=crop',
      ],
    };
    const images = imageMap[type] || imageMap.article;
    const seed = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return images[seed % images.length];
  };

  const getMediaImage = () => {
    // First priority: use imageUrl from the API if available
    if (media?.imageUrl) {
      return media.imageUrl;
    }
    
    const title = media?.title?.toLowerCase() || '';
    for (const key of Object.keys(thumbnailOverrides)) {
      if (title.includes(key)) {
        return thumbnailOverrides[key];
      }
    }
    const ytId = extractYoutubeId(media?.sourceUrl);
    if (ytId) {
      return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    }
    return getDefaultImage(media?.type || 'article', media?.title || '');
  };


  const getCategory = (topic: string): string => {
    if (topic) {
      return topic.charAt(0).toUpperCase() + topic.slice(1);
    }
    return 'General';
  };

  return (
    <div className="learning-materials">
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

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      <div className="learning-content">
        <div className="main-content">
          {/* Header Section with Background Image */}
          <div 
            className="content-header-section"
            style={{
              backgroundImage: `url(${getMediaImage()})`,
            }}
          >
            <div className="content-header-overlay"></div>
            {personalization && (
              <button
                className="regenerate-content-button-image"
                onClick={handleRegenerateAll}
                disabled={generating}
              >
                {generating ? (
                  <>
                    <div className="loading-spinner tiny" />
                    <span>Regenerating...</span>
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9 1.5V4.5M9 13.5V16.5M16.5 9H13.5M4.5 9H1.5M14.1975 3.8025L12.1275 5.8725M5.8725 12.1275L3.8025 14.1975M14.1975 14.1975L12.1275 12.1275M5.8725 5.8725L3.8025 3.8025" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>Regenerate scaffold</span>
                  </>
                )}
              </button>
            )}
            <div className="content-header">
              <div className="header-left">
                <div className="level-badge-small">{media.cefr || 'B1'}</div>
                <h1 className="content-title">{media.title}</h1>
              </div>
              <div className="header-right">
                <span className="category-badge">{getCategory(media.topic || '')}</span>
              </div>
            </div>
          </div>

          {!personalization ? (
            <div className="generate-prompt">
              <div className="scaffold-loading-container">
                <div className="scaffold-icon">📚</div>
                <div className="scaffold-spinner-wrapper">
                  <div className="scaffold-spinner"></div>
                  <div className="scaffold-particles">
                    <span className="particle">✨</span>
                    <span className="particle">💡</span>
                    <span className="particle">📖</span>
                    <span className="particle">🎯</span>
                  </div>
                </div>
                <h2 className="scaffold-title">Generating scaffold..</h2>
                <p className="scaffold-subtitle">Creating your personalized learning materials</p>
                <div className="scaffold-progress-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
              </div>
            </div>
          ) : (
            <>
                {/* CEFR Analysis Section */}
                {cefrAnalysis && (
                  <div className="cefr-analysis-section">
                    <div className="section-header">
                      <div className="section-title">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
                        </svg>
                        <h2>
                          Textschwierigkeitsanalyse
                          <span className="section-subtitle">Text Difficulty Analysis</span>
                        </h2>
                      </div>
                      <button
                        type="button"
                        className="toggle-expand-button"
                        onClick={() => setCefrAnalysisExpanded(!cefrAnalysisExpanded)}
                        aria-label={cefrAnalysisExpanded ? 'Collapse analysis' : 'Expand analysis'}
                      >
                        <span className="expand-button-text">
                          {cefrAnalysisExpanded ? 'Collapse' : 'Expand'}
                        </span>
                        <svg 
                          width="20" 
                          height="20" 
                          viewBox="0 0 20 20" 
                          fill="none" 
                          xmlns="http://www.w3.org/2000/svg"
                          className={`expand-arrow ${cefrAnalysisExpanded ? 'expanded' : ''}`}
                        >
                          <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                    {cefrAnalysisExpanded && (
                      <div className="cefr-analysis-content">
                        <div className="cefr-analysis-info">
                          <p className="cefr-analysis-total">Total words analyzed: <strong>{cefrAnalysis.total}</strong></p>
                        </div>
                        <div className="cefr-levels-circle-container">
                          {(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).map((level, index) => {
                            const count = cefrAnalysis.counts[level];
                            const percentage = cefrAnalysis.percentages[level];
                            const levelColors = [
                              'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
                              'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                              'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                              'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                              'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                              'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                            ];
                            return (
                              <div key={level} className="cefr-level-circle" style={{ '--level-gradient': levelColors[index] } as React.CSSProperties}>
                                <div className="cefr-circle-inner">
                                  <div className="cefr-circle-label">{level}</div>
                                  <div className="cefr-circle-percentage">{percentage.toFixed(1)}%</div>
                                  <div className="cefr-circle-count">{count}</div>
                                </div>
                              </div>
                            );
                          })}
                          {/* UNKNOWN Level */}
                          {cefrAnalysis.counts.UNKNOWN > 0 && (
                            <div className="cefr-level-circle cefr-level-circle-unknown" data-tooltip="The unknown words are words that have not been observed in second language learning materials, so they are considered the most difficult.">
                              <div className="cefr-circle-inner">
                                <div className="cefr-circle-label">?</div>
                                <div className="cefr-circle-percentage">{cefrAnalysis.percentages.UNKNOWN.toFixed(1)}%</div>
                                <div className="cefr-circle-count">{cefrAnalysis.counts.UNKNOWN}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Summary Section */}
                <div className="summary-section">
                  <div className="section-header">
                    <div className="section-title">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
                      </svg>
                      <h2>
                        Zusammenfassung
                        <span className="section-subtitle">Summary</span>
                      </h2>
                    </div>
                    <div className="section-actions">
                      <button
                        type="button"
                        className="toggle-english"
                        onClick={() => setShowSummaryEnglish((prev) => !prev)}
                      >
                        {showSummaryEnglish ? 'Hide English' : 'Show English'}
                      </button>
                    </div>
                  </div>
                  {summary ? (
                    <div className="summary-content">
                      <div className="summary-block">
                        <div className="summary-label">DE Deutsch:</div>
                        <div className="summary-text summary-text-primary">{summary.de}</div>
                      </div>
                      {showSummaryEnglish && (
                        <div className="summary-block summary-block-secondary">
                          <div className="summary-label">GB English:</div>
                          <div className="summary-text summary-text-secondary">{summary.en}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="empty-section">Summary not available</div>
                  )}
                </div>

                {/* Vocabulary Section */}
                <div className="vocabulary-section">
                  <div className="section-header">
                    <div className="section-title">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 4H17V16H3V4Z" stroke="currentColor" strokeWidth="2" fill="none"/>
                        <path d="M7 8H13M7 12H13" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                      <h2>
                        Wichtige Vokabeln
                        <span className="section-subtitle">Key Vocabulary</span>
                      </h2>
                    </div>
                    <div className="section-actions">
                      <button
                        type="button"
                        className="toggle-english"
                        onClick={() => setShowVocabEnglish((prev) => !prev)}
                      >
                        {showVocabEnglish ? 'Hide English' : 'Show English'}
                      </button>
                    </div>
                  </div>
                  {vocabulary.length > 0 ? (
                    <div className="vocabulary-list">
                      {vocabulary.map((vocab, index) => (
                        <div key={index} className="vocabulary-item">
                          <div className="vocab-header">
                            <div className="vocab-word-container">
                              <div className="vocab-word">
                                {vocab.partOfSpeech === 'verb' ? (
                                  <>
                                    {vocab.word} <span className="vocab-infinitive">({vocab.infinitive || 'N/A'})</span>
                                  </>
                                ) : (
                                  vocab.word
                                )}
                              </div>
                              <button
                                type="button"
                                className={`speaker-button ${playingAudio === vocab.word ? 'playing' : ''}`}
                                onClick={() => handleSpeakWord(vocab.word)}
                                aria-label={`Pronounce ${vocab.word}`}
                                title={`Listen to pronunciation of ${vocab.word}`}
                              >
                                {playingAudio === vocab.word ? (
                                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="6" y="4" width="2" height="12" fill="currentColor"/>
                                    <rect x="10" y="4" width="2" height="12" fill="currentColor"/>
                                  </svg>
                                ) : (
                                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M10 3L6 7H3V13H6L10 17V3Z" fill="currentColor"/>
                                    <path d="M14 5L12.5 6.5C13.5 7.5 14 9 14 10.5C14 12 13.5 13.5 12.5 14.5L14 16C15.3 14.7 16 12.7 16 10.5C16 8.3 15.3 6.3 14 5Z" fill="currentColor"/>
                                    <path d="M16 2L14.5 3.5C16.2 5.2 17 7.3 17 10.5C17 13.7 16.2 15.8 14.5 17.5L16 19C18.3 16.7 19.5 13.7 19.5 10.5C19.5 7.3 18.3 4.3 16 2Z" fill="currentColor"/>
                                  </svg>
                                )}
                              </button>
                            </div>
                            <div className="vocab-part-of-speech">{vocab.partOfSpeech}</div>
                          </div>
                          <div className="vocab-usage">
                            <strong>From transcript:</strong> "{vocab.usageInTranscript}"
                          </div>
                          <div className="vocab-translations">
                            <div className="vocab-translation-primary">
                              <strong>DE:</strong> {vocab.translation.de}
                            </div>
                            {showVocabEnglish && (
                              <div className="vocab-translation-secondary">
                                <strong>EN:</strong> {vocab.translation.en}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-section">Vocabulary not available</div>
                  )}
                </div>

                {/* Fun Fact Section */}
                <div className="fun-fact-section">
                  <div className="section-header">
                    <div className="section-title">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
                      </svg>
                      <h2>
                        Wissenswertes
                        <span className="section-subtitle">Fun Fact</span>
                      </h2>
                    </div>
                    <div className="section-actions">
                      <button
                        type="button"
                        className="toggle-english"
                        onClick={() => setShowFunFactEnglish((prev) => !prev)}
                      >
                        {showFunFactEnglish ? 'Hide English' : 'Show English'}
                      </button>
                    </div>
                  </div>
                  {funFact ? (
                    <div className="fun-fact-content">
                      <div className="fun-fact-text fun-fact-text-primary">{funFact.de}</div>
                      {showFunFactEnglish && (
                        <div className="fun-fact-text fun-fact-text-secondary">{funFact.en}</div>
                      )}
                    </div>
                  ) : (
                    <div className="empty-section">Fun fact not available</div>
                  )}
                </div>

                {/* Natural Expressions Section */}
                <div className="natural-expressions-section">
                  <div className="section-header">
                    <div className="section-title">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
                      </svg>
                      <h2>
                        Natürliche Ausdrücke / gesprochene Füllwörter
                        <span className="section-subtitle">Natural Expressions / Spoken Fillers</span>
                      </h2>
                    </div>
                    <div className="section-actions">
                      <button
                        type="button"
                        className="toggle-english"
                        onClick={() => setShowNaturalExpressionsEnglish((prev) => !prev)}
                      >
                        {showNaturalExpressionsEnglish ? 'Hide English' : 'Show English'}
                      </button>
                    </div>
                  </div>
                  {naturalExpressions && naturalExpressions.length > 0 ? (
                    <div className="natural-expressions-list">
                      {naturalExpressions.map((expr, index) => (
                        <div key={index} className="natural-expression-item">
                          <div className="expression-header">
                            <div className="expression-text">{expr.expression}</div>
                          </div>
                          <div className="expression-usage">
                            <strong>From transcript:</strong> "{expr.usageInTranscript}"
                          </div>
                          <div className="expression-translations">
                            <div className="expression-translation-primary">
                              <strong>DE:</strong> {expr.translation.de}
                            </div>
                            {showNaturalExpressionsEnglish && (
                              <div className="expression-translation-secondary">
                                <strong>EN:</strong> {expr.translation.en}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-section">No natural expressions found in this transcript</div>
                  )}
                </div>

                {/* Culture Nugget Section */}
                {cultureNugget && (
                  <div className="culture-nugget-section">
                    <div className="section-header">
                      <div className="section-title">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
                        </svg>
                        <h2>
                          Kulturstück
                          <span className="section-subtitle">Culture Nugget</span>
                        </h2>
                      </div>
                      <div className="section-actions">
                        <button
                          type="button"
                          className="toggle-english"
                          onClick={() => setShowCultureNuggetEnglish((prev) => !prev)}
                        >
                          {showCultureNuggetEnglish ? 'Hide English' : 'Show English'}
                        </button>
                      </div>
                    </div>
                    <div className="culture-nugget-content">
                      <div className="culture-nugget-text culture-nugget-text-primary">{cultureNugget.de}</div>
                      {showCultureNuggetEnglish && (
                        <div className="culture-nugget-text culture-nugget-text-secondary">{cultureNugget.en}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Personalizable Element Section */}
                {personalizableElement && personalizableElement.de && (
                  <div className="personalizable-element-section">
                    <div className="section-header">
                      <div className="section-title">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
                        </svg>
                        <h2>
                          Für dich
                          <span className="section-subtitle">Personalized for You</span>
                        </h2>
                      </div>
                      <div className="section-actions">
                        <button
                          type="button"
                          className="toggle-english"
                          onClick={() => setShowPersonalizableElementEnglish((prev) => !prev)}
                        >
                          {showPersonalizableElementEnglish ? 'Hide English' : 'Show English'}
                        </button>
                      </div>
                    </div>
                    <div className="personalizable-element-content">
                      <div className="personalizable-element-text personalizable-element-text-primary">{personalizableElement.de}</div>
                      {showPersonalizableElementEnglish && (
                        <div className="personalizable-element-text personalizable-element-text-secondary">{personalizableElement.en}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Media Source Redirect Section */}
                {personalization && media?.sourceUrl && (
                  <div className="media-redirect-section">
                    <div className="media-redirect-content">
                      <div className="media-redirect-icon-wrapper">
                        <div className="media-redirect-icon">
                          {media.type === 'video' ? '🎥' : media.type === 'podcast' ? '🎙️' : '📰'}
                        </div>
                        {hasVisitedMediaSource && (
                          <div className="media-redirect-checkmark">✓</div>
                        )}
                      </div>
                      <h2 className="media-redirect-title">
                        {hasVisitedMediaSource ? 'Great! You\'ve explored the source' : 'Explore the Original Content'}
                      </h2>
                      <p className="media-redirect-description">
                        {hasVisitedMediaSource 
                          ? 'You\'ve viewed the original content. Now you\'re ready to test your understanding!'
                          : 'Before testing your knowledge, take a moment to explore the original content. This will help you better understand the context and prepare for the questions.'}
                      </p>
                      <button
                        type="button"
                        className={`media-redirect-button ${hasVisitedMediaSource ? 'visited' : ''}`}
                        onClick={handleMediaRedirect}
                        disabled={generating}
                      >
                        {hasVisitedMediaSource ? (
                          <>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M16.7071 5.29289C17.0976 5.68342 17.0976 6.31658 16.7071 6.70711L8.70711 14.7071C8.31658 15.0976 7.68342 15.0976 7.29289 14.7071L3.29289 10.7071C2.90237 10.3166 2.90237 9.68342 3.29289 9.29289C3.68342 8.90237 4.31658 8.90237 4.70711 9.29289L8 12.5858L15.2929 5.29289C15.6834 4.90237 16.3166 4.90237 16.7071 5.29289Z" fill="currentColor"/>
                            </svg>
                            <span>View Again</span>
                          </>
                        ) : (
                          <>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M11 3C10.4477 3 10 3.44772 10 4C10 4.55228 10.4477 5 11 5H13.5858L8.29289 10.2929C7.90237 10.6834 7.90237 11.3166 8.29289 11.7071C8.68342 12.0976 9.31658 12.0976 9.70711 11.7071L15 6.41421V9C15 9.55228 15.4477 10 16 10C16.5523 10 17 9.55228 17 9V4C17 3.44772 16.5523 3 16 3H11Z" fill="currentColor"/>
                              <path d="M5 5C3.89543 5 3 5.89543 3 7V15C3 16.1046 3.89543 17 5 17H13C14.1046 17 15 16.1046 15 15V12C15 11.4477 14.5523 11 14 11C13.4477 11 13 11.4477 13 12V15H5V7H8C8.55228 7 9 6.55228 9 6C9 5.44772 8.55228 5 8 5H5Z" fill="currentColor"/>
                            </svg>
                            <span>Explore Original Content</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Mini-Quizzeit Section */}
                {personalization && (
                  <div className="game-invitation-section">
                    <div className="section-header">
                      <div className="section-title">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10 2L11.5 7.5L17 9L11.5 10.5L10 16L8.5 10.5L3 9L8.5 7.5L10 2Z" fill="currentColor"/>
                        </svg>
                        <h2>
                          Mini-Quizzeit
                          <span className="section-subtitle">Mini Quiz Time</span>
                        </h2>
                      </div>
                    </div>
                    <div className="game-invitation-content">
                      {/* <p className="game-invitation-description">
                        Teste dein Verständnis mit interaktiven Karteikarten, Multiple-Choice-Fragen und Lückentext-Übungen!
                      </p> */}
                      {evaluationLoading ? (
                        <div className="inline-loading">
                          <div className="loading-spinner" />
                          <p>Fragen werden vorbereitet...</p>
                        </div>
                      ) : evaluation ? (
                        <div className="game-button-container">
                          <button
                            className="ready-for-game-button"
                            onClick={() => navigate(`/evaluation/${id}`)}
                            disabled={generating || !hasVisitedMediaSource}
                            title={!hasVisitedMediaSource ? 'Bitte erkunde zuerst den Originalinhalt' : ''}
                          >
                            <span className="button-icon">🚀</span>
                            <span>los geht's!</span>
                          </button>
                          {!hasVisitedMediaSource && (
                            <p className="game-button-hint">
                              Erkunde zuerst den Originalinhalt, um fortzufahren
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="game-pending-container">
                          <p className="game-pending-text">Dein Quiz wird vorbereitet. Bitte warten...</p>
                          <button
                            type="button"
                            className="generate-game-button"
                            onClick={handleGenerateEvaluation}
                            disabled={!personalization || generating || evaluationLoading}
                          >
                            {evaluationLoading ? 'Wird generiert...' : 'Quiz jetzt generieren'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
            </>
          )}
        </div>
      </div>
      {generating && (
        <div className="loading-overlay">
          <div className="scaffold-loading-container">
            <div className="scaffold-icon">📚</div>
            <div className="scaffold-spinner-wrapper">
              <div className="scaffold-spinner"></div>
              <div className="scaffold-particles">
                <span className="particle">✨</span>
                <span className="particle">💡</span>
                <span className="particle">📖</span>
                <span className="particle">🎯</span>
              </div>
            </div>
            <h2 className="scaffold-title">Generating scaffold..</h2>
            <p className="scaffold-subtitle">Creating your personalized learning materials</p>
            <div className="scaffold-progress-dots">
              <span className="dot"></span>
              <span className="dot"></span>
              <span className="dot"></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

