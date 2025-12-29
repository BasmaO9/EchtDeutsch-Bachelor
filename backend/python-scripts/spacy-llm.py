#!/usr/bin/env python3
"""
SpaCy POS Tagging Service
Accepts a German transcript and extracts nouns, verbs, and adjectives using spaCy.
Returns JSON with three arrays: nouns, verbs, and adjectives.
"""

import sys
import json
try:
    import spacy  # type: ignore
except ImportError:
    print("Error: spaCy is not installed. Please install it with: pip install spacy", file=sys.stderr)
    sys.exit(1)
from typing import List, Dict

# Load the German spaCy model
try:
    nlp = spacy.load("de_core_news_sm")
except OSError:
    print("Error: German spaCy model 'de_core_news_sm' not found.", file=sys.stderr)
    print("Please install it with: python -m spacy download de_core_news_sm", file=sys.stderr)
    sys.exit(1)


def trim_sentence_with_occurrence(sentence: str, occurrence_word: str, max_words: int = 20) -> str:
    """
    Trim a sentence to max_words while ensuring the occurrence word is included.
    If the sentence is longer than max_words, it trims from both ends but keeps
    the occurrence word and some context around it.
    
    Args:
        sentence: The sentence to trim
        occurrence_word: The word that must be preserved in the trimmed sentence
        max_words: Maximum number of words in the trimmed sentence
        
    Returns:
        Trimmed sentence with the occurrence word preserved
    """
    words = sentence.split()
    
    # If sentence is already short enough, return as is
    if len(words) <= max_words:
        return sentence
    
    # Find the occurrence word position (case-insensitive)
    # Clean the occurrence word for comparison
    occurrence_clean = occurrence_word.lower().strip('.,!?;:()[]{}"\'')
    occurrence_pos = -1
    for i, word in enumerate(words):
        # Remove punctuation for comparison
        word_clean = word.lower().strip('.,!?;:()[]{}"\'')
        # Match if cleaned words are equal (exact match preferred)
        if word_clean == occurrence_clean:
            occurrence_pos = i
            break
        # Also check if one is a prefix/suffix of the other (for compound words)
        # Only if lengths are similar to avoid false matches
        elif abs(len(word_clean) - len(occurrence_clean)) <= 2:
            if occurrence_clean.startswith(word_clean) or word_clean.startswith(occurrence_clean):
                occurrence_pos = i
                break
    
    # If occurrence not found, return first max_words
    if occurrence_pos == -1:
        return ' '.join(words[:max_words])
    
    # Calculate how many words we can keep around the occurrence
    # Try to keep equal context before and after
    words_before = min(occurrence_pos, max_words // 2)
    words_after = min(len(words) - occurrence_pos - 1, max_words // 2)
    
    # If we have room, expand context
    remaining = max_words - (words_before + words_after + 1)
    if remaining > 0:
        # Distribute remaining words between before and after
        extra_before = min(occurrence_pos - words_before, remaining // 2)
        extra_after = min(len(words) - occurrence_pos - 1 - words_after, remaining - extra_before)
        words_before += extra_before
        words_after += extra_after
    
    # Extract the trimmed sentence
    start = max(0, occurrence_pos - words_before)
    end = min(len(words), occurrence_pos + words_after + 1)
    
    return ' '.join(words[start:end])


def extract_pos_tags(text: str) -> Dict:
    """
    Extract nouns, verbs, and adjectives from German text using spaCy.
    For verbs, nouns, and adjectives, also extracts occurrences (phrases/sentences where each appears).
    
    Args:
        text: German text to analyze
        
    Returns:
        Dictionary with nouns, verbs, adjectives, verb_occurrences, noun_occurrences, and adjective_occurrences
    """
    if not text or not text.strip():
        return {
            "nouns": [],
            "verbs": [],
            "adjectives": [],
            "verb_occurrences": [],
            "noun_occurrences": [],
            "adjective_occurrences": []
        }
    
    # Process text with spaCy
    doc = nlp(text)
    
    # Extract unique words by POS tag
    nouns = set()
    verbs = set()
    adjectives = set()
    
    # Track occurrences: map lemma -> list of trimmed phrases
    # Also track original sentences to avoid duplicates
    verb_occurrences: Dict[str, List[str]] = {}
    verb_original_sentences: Dict[str, set] = {}
    noun_occurrences: Dict[str, List[str]] = {}
    noun_original_sentences: Dict[str, set] = {}
    adjective_occurrences: Dict[str, List[str]] = {}
    adjective_original_sentences: Dict[str, set] = {}
    
    for token in doc:
        # Skip punctuation, spaces, and stop words if desired
        if token.is_punct or token.is_space:
            continue
            
        # Extract lemmatized forms for consistency
        lemma = token.lemma_.lower().strip()
        
        # Filter out empty strings
        if not lemma:
            continue
        
        # Get the original text of the token (for occurrence tracking)
        token_text = token.text
        
        # Find the sentence containing this token
        containing_sentence = None
        for sent in doc.sents:
            if token in sent:
                containing_sentence = sent.text.strip()
                break
        
        if not containing_sentence:
            continue
        
        # Categorize by POS tag and track occurrences
        if token.pos_ == "NOUN":
            nouns.add(lemma)
            # Initialize if needed
            if lemma not in noun_original_sentences:
                noun_original_sentences[lemma] = set()
                noun_occurrences[lemma] = []
            # Check if we already have this exact sentence for this noun
            if containing_sentence not in noun_original_sentences[lemma]:
                noun_original_sentences[lemma].add(containing_sentence)
                # Trim sentence if longer than 20 words, preserving the occurrence
                trimmed_phrase = trim_sentence_with_occurrence(containing_sentence, token_text, 20)
                noun_occurrences[lemma].append(trimmed_phrase)
        elif token.pos_ == "VERB":
            verbs.add(lemma)
            # Initialize if needed
            if lemma not in verb_original_sentences:
                verb_original_sentences[lemma] = set()
                verb_occurrences[lemma] = []
            # Check if we already have this exact sentence for this verb
            if containing_sentence not in verb_original_sentences[lemma]:
                verb_original_sentences[lemma].add(containing_sentence)
                # Trim sentence if longer than 20 words, preserving the occurrence
                trimmed_phrase = trim_sentence_with_occurrence(containing_sentence, token_text, 20)
                verb_occurrences[lemma].append(trimmed_phrase)
        elif token.pos_ == "ADJ":
            adjectives.add(lemma)
            # Initialize if needed
            if lemma not in adjective_original_sentences:
                adjective_original_sentences[lemma] = set()
                adjective_occurrences[lemma] = []
            # Check if we already have this exact sentence for this adjective
            if containing_sentence not in adjective_original_sentences[lemma]:
                adjective_original_sentences[lemma].add(containing_sentence)
                # Trim sentence if longer than 20 words, preserving the occurrence
                trimmed_phrase = trim_sentence_with_occurrence(containing_sentence, token_text, 20)
                adjective_occurrences[lemma].append(trimmed_phrase)
    
    # Convert occurrences to the format expected: list of {word, phrase}
    verb_occurrences_list = []
    for infinitive in sorted(verb_occurrences.keys()):
        for phrase in verb_occurrences[infinitive]:
            verb_occurrences_list.append({
                "infinitive": infinitive,
                "phrase": phrase
            })
    
    noun_occurrences_list = []
    for noun in sorted(noun_occurrences.keys()):
        for phrase in noun_occurrences[noun]:
            noun_occurrences_list.append({
                "noun": noun,
                "phrase": phrase
            })
    
    adjective_occurrences_list = []
    for adjective in sorted(adjective_occurrences.keys()):
        for phrase in adjective_occurrences[adjective]:
            adjective_occurrences_list.append({
                "adjective": adjective,
                "phrase": phrase
            })
    
    # Convert sets to sorted lists for consistent output
    return {
        "nouns": sorted(list(nouns)),
        "verbs": sorted(list(verbs)),
        "adjectives": sorted(list(adjectives)),
        "verb_occurrences": verb_occurrences_list,
        "noun_occurrences": noun_occurrences_list,
        "adjective_occurrences": adjective_occurrences_list
    }


def main():
    """Main function to handle input and output."""
    try:
        # Read input from stdin
        input_data = sys.stdin.read()
        
        if not input_data:
            result = {
                "error": "No input provided"
            }
            print(json.dumps(result, ensure_ascii=False))
            sys.exit(1)
        
        # Parse JSON input
        try:
            data = json.loads(input_data)
            transcript = data.get("transcript", "")
        except json.JSONDecodeError:
            # If not JSON, treat entire input as transcript
            transcript = input_data.strip()
        
        if not transcript:
            result = {
                "error": "Transcript is empty"
            }
            print(json.dumps(result, ensure_ascii=False))
            sys.exit(1)
        
        # Extract POS tags
        result = extract_pos_tags(transcript)
        
        # Output JSON result
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        error_result = {
            "error": str(e)
        }
        print(json.dumps(error_result, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

