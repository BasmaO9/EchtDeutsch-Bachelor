import { useState, useEffect } from 'react';
import type { Evaluation } from '../services/api';

// ============================================
// EVALUATION SYSTEM - Clean Implementation
// ============================================

export interface EvalItem {
  id: string;
  prompt_de: string;
  type: 'flashcard' | 'mcq' | 'fill';
  answer_de?: string;
  expected_answer_de?: string;
  options_de?: string[];
  correct_index?: number;
  blank_sentence_de?: string;
  draggable_options_de?: string[];
  feedback_if_correct_de?: string;
  feedback_if_incorrect_de?: string;
}

export interface EvalPhase {
  phase: 'flashcard' | 'mcq' | 'fill';
  items: EvalItem[];
}

export interface EvalData {
  metadata?: { cefr: string; purpose: string; interests: string[]; studyMajor?: string };
  evaluation: EvalPhase[];
}

// Flashcard Component
function Flashcard({ item, onAnswer, feedback }: { item: EvalItem; onAnswer: (answer: string) => void; feedback?: { correct: boolean; feedback: string } }) {
  const [flipped, setFlipped] = useState(false);
  const handleFlip = () => {
    if (!flipped && !feedback) {
      setFlipped(true);
      onAnswer(item.answer_de || '');
    }
  };
  return (
    <div className={`flashcard ${flipped ? 'flipped' : ''} ${feedback ? 'answered' : ''}`} onClick={handleFlip}>
      <div className="flashcard-inner">
        <div className="flashcard-front">
          <div className="flashcard-prompt">{item.prompt_de}</div>
          <div className="flashcard-hint">Click to reveal</div>
        </div>
        <div className="flashcard-back">
          <div className="flashcard-answer">{item.answer_de}</div>
          {feedback && <div className={`feedback ${feedback.correct ? 'correct' : 'incorrect'}`}>{feedback.feedback}</div>}
        </div>
      </div>
    </div>
  );
}

// MCQ Component
function MCQ({ item, onAnswer, selected, feedback }: { item: EvalItem; onAnswer: (index: number) => void; selected?: number; feedback?: { correct: boolean; feedback: string } }) {
  return (
    <div className="mcq-container">
      <div className="mcq-question">{item.prompt_de}</div>
      <div className="mcq-options">
        {item.options_de?.map((option, idx) => {
          const isSelected = selected === idx;
          const isCorrect = idx === (item.correct_index ?? 0);
          const showCorrect = feedback && !feedback.correct && isCorrect;
          return (
            <button
              key={idx}
              type="button"
              className={`mcq-option ${isSelected ? 'selected' : ''} ${showCorrect ? 'correct' : ''}`}
              onClick={() => !feedback && onAnswer(idx)}
              disabled={!!feedback}
            >
              {option}
            </button>
          );
        })}
      </div>
      {feedback && <div className={`feedback ${feedback.correct ? 'correct' : 'incorrect'}`}>{feedback.feedback}</div>}
    </div>
  );
}

// Fill-in-the-Blanks Component
function FillIn({ item, onAnswer, selected, feedback }: { item: EvalItem; onAnswer: (option: string) => void; selected?: string; feedback?: { correct: boolean; feedback: string } }) {
  const sentence = item.blank_sentence_de || '';
  const parts = sentence.split('____');
  
  return (
    <div className="fill-container">
      <div className="fill-question">{item.prompt_de}</div>
      <div className="fill-sentence">
        {parts[0]}
        <span className={`fill-blank ${selected ? 'filled' : ''}`}>{selected || '____'}</span>
        {parts[1]}
      </div>
      <div className="fill-options">
        {item.draggable_options_de?.map((option, idx) => {
          const isSelected = selected === option;
          const isCorrect = idx === (item.correct_index ?? 0);
          const showCorrect = feedback && !feedback.correct && isCorrect;
          return (
            <button
              key={idx}
              type="button"
              className={`fill-option ${isSelected ? 'selected' : ''} ${showCorrect ? 'correct' : ''}`}
              onClick={() => !selected && !feedback && onAnswer(option)}
              disabled={!!selected || !!feedback}
            >
              {option}
            </button>
          );
        })}
      </div>
      {feedback && <div className={`feedback ${feedback.correct ? 'correct' : 'incorrect'}`}>{feedback.feedback}</div>}
    </div>
  );
}

// Main Evaluation Component
export function EvaluationView({ evaluation, mediaId, onFinish }: { evaluation: Evaluation; mediaId: string; onFinish: () => void }) {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [feedback, setFeedback] = useState<Record<string, { correct: boolean; feedback: string }>>({});
  
  // Parse evaluation data
  let evalData: EvalData;
  try {
    evalData = typeof evaluation.evaluationData === 'string' 
      ? JSON.parse(evaluation.evaluationData) 
      : evaluation.evaluationData;
  } catch (err) {
    return <div className="error">Failed to parse evaluation data</div>;
  }
  
  // Validate mediaId match
  if (evaluation.mediaId && String(evaluation.mediaId) !== String(mediaId)) {
    return <div className="error">Evaluation does not match current media</div>;
  }
  
  // Reset state when evaluation changes (prevents cached state)
  useEffect(() => {
    setPhaseIndex(0);
    setItemIndex(0);
    setAnswers({});
    setFeedback({});
  }, [evaluation._id, mediaId]); // Reset when evaluation ID or mediaId changes
  
  if (!evalData?.evaluation?.[phaseIndex]?.items?.[itemIndex]) {
    return <div className="error">Invalid evaluation structure</div>;
  }
  
  const phase = evalData.evaluation[phaseIndex];
  const item = phase.items[itemIndex];
  const phaseNames = { flashcard: 'Flashcards', mcq: 'Multiple Choice', fill: 'Fill in the Blanks' };
  
  const handleAnswer = (itemId: string, answer: any) => {
    setAnswers(prev => ({ ...prev, [itemId]: answer }));
    
    // Check answer immediately
    let isCorrect = false;
    if (item.type === 'mcq') {
      isCorrect = answer === item.correct_index;
    } else if (item.type === 'fill') {
      const correct = item.draggable_options_de?.[item.correct_index ?? 0];
      isCorrect = answer === correct;
    } else if (item.type === 'flashcard') {
      isCorrect = answer === item.expected_answer_de;
    }
    
    setFeedback(prev => ({
      ...prev,
      [itemId]: {
        correct: isCorrect,
        feedback: isCorrect 
          ? (item.feedback_if_correct_de || 'Richtig!') 
          : (item.feedback_if_incorrect_de || 'Falsch!')
      }
    }));
  };
  
  const handleNext = () => {
    if (itemIndex < phase.items.length - 1) {
      setItemIndex(itemIndex + 1);
    } else if (phaseIndex < evalData.evaluation.length - 1) {
      setPhaseIndex(phaseIndex + 1);
      setItemIndex(0);
    }
  };
  
  const handlePrev = () => {
    if (itemIndex > 0) {
      setItemIndex(itemIndex - 1);
    } else if (phaseIndex > 0) {
      setPhaseIndex(phaseIndex - 1);
      setItemIndex(evalData.evaluation[phaseIndex - 1].items.length - 1);
    }
  };
  
  const isLastItem = itemIndex === phase.items.length - 1;
  const isLastPhase = phaseIndex === evalData.evaluation.length - 1;
  
  return (
    <div className="evaluation-view" key={`eval-${evaluation._id}-${mediaId}-${phaseIndex}-${itemIndex}`}>
      <div className="evaluation-header">
        <button type="button" className="back-button" onClick={onFinish} style={{ marginBottom: '1rem' }}>
          ← Back to Materials
        </button>
        <div className="phase-info">
          <h3>Phase {phaseIndex + 1}: {phaseNames[phase.phase]}</h3>
          <span className="progress">Question {itemIndex + 1} of {phase.items.length}</span>
        </div>
        {evalData.metadata && (
          <div className="metadata">
            <span>CEFR: {evalData.metadata.cefr}</span>
            <span>Goal: {evalData.metadata.purpose}</span>
          </div>
        )}
      </div>
      
      <div className="evaluation-content">
        {phase.phase === 'flashcard' && (
          <Flashcard 
            item={item} 
            onAnswer={(answer) => handleAnswer(item.id, answer)} 
            feedback={feedback[item.id]} 
          />
        )}
        {phase.phase === 'mcq' && (
          <MCQ 
            item={item} 
            onAnswer={(idx) => handleAnswer(item.id, idx)} 
            selected={answers[item.id]} 
            feedback={feedback[item.id]} 
          />
        )}
        {phase.phase === 'fill' && (
          <FillIn 
            item={item} 
            onAnswer={(opt) => handleAnswer(item.id, opt)} 
            selected={answers[item.id]} 
            feedback={feedback[item.id]} 
          />
        )}
      </div>
      
      <div className="evaluation-nav">
        <button type="button" onClick={handlePrev} disabled={phaseIndex === 0 && itemIndex === 0}>
          Previous
        </button>
        {isLastItem && isLastPhase ? (
          <button type="button" className="primary" onClick={onFinish}>
            Finish Evaluation
          </button>
        ) : (
          <button type="button" className="primary" onClick={handleNext}>
            {isLastItem ? 'Next Phase' : 'Next'}
          </button>
        )}
      </div>
    </div>
  );
}



