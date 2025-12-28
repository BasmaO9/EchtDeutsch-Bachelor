import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export interface VerbOccurrence {
  infinitive: string;
  phrase: string;
}

export interface NounOccurrence {
  noun: string;
  phrase: string;
}

export interface AdjectiveOccurrence {
  adjective: string;
  phrase: string;
}

export interface SpacyPosResult {
  nouns: string[];
  verbs: string[];
  adjectives: string[];
  verb_occurrences?: VerbOccurrence[];
  noun_occurrences?: NounOccurrence[];
  adjective_occurrences?: AdjectiveOccurrence[];
  error?: string;
}

/**
 * Service for extracting POS tags (nouns, verbs, adjectives) from German text
 * using spaCy via Python script
 */
@Injectable()
export class SpacyPosService {
  private readonly pythonInterpreter: string;
  private readonly pythonScriptPath: string;

  constructor() {
    // Path to the Python script relative to project root
    // process.cwd() returns the backend directory when running from backend,
    // so we need to go up one level to reach the project root
    const backendDir = process.cwd();
    const projectRoot = path.resolve(backendDir, '..');
    
    // Use Python from virtual environment
    const venvPythonPath = process.platform === 'win32'
      ? path.join(projectRoot, 'python-scripts', 'venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'python-scripts', 'venv', 'bin', 'python');
    
    this.pythonInterpreter = venvPythonPath;
    this.pythonScriptPath = path.join(
      projectRoot,
      'python-scripts',
      'spacy-llm.py',
    );
    
    console.log('Python interpreter:', this.pythonInterpreter);
    console.log('Python script path:', this.pythonScriptPath);
  }

  /**
   * Extracts nouns, verbs, and adjectives from German transcript using spaCy
   * @param transcript - German text to analyze
   * @returns Promise resolving to POS tag extraction results
   */
  async extractPosTags(transcript: string): Promise<SpacyPosResult> {
    if (!transcript || transcript.trim().length === 0) {
      throw new HttpException(
        'Transcript cannot be empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      // Prepare input as JSON
      const inputData = JSON.stringify({ transcript });

      // Execute Python script using spawn to support stdin input
      // Use the Python interpreter from the virtual environment
      const result = await new Promise<SpacyPosResult>((resolve, reject) => {
        const pythonProcess: ChildProcess = spawn(this.pythonInterpreter, [this.pythonScriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        if (!pythonProcess.stdout || !pythonProcess.stderr || !pythonProcess.stdin) {
          reject(
            new HttpException(
              'Failed to create stdio streams for Python process',
              HttpStatus.INTERNAL_SERVER_ERROR,
            ),
          );
          return;
        }

        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        pythonProcess.on('error', (error) => {
          reject(
            new HttpException(
              `Failed to spawn Python process: ${error.message}`,
              HttpStatus.INTERNAL_SERVER_ERROR,
            ),
          );
        });

        pythonProcess.on('close', (code) => {
          if (code !== 0) {
            reject(
              new HttpException(
                `Python script exited with code ${code}. Error: ${stderr || 'Unknown error'}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
              ),
            );
            return;
          }

          if (stderr && stderr.trim()) {
            console.warn('Python script stderr:', stderr);
          }

          try {
            // Parse JSON output
            const parsedResult: SpacyPosResult = JSON.parse(stdout.trim());
            resolve(parsedResult);
          } catch (parseError) {
            reject(
              new HttpException(
                `Failed to parse Python script output: ${parseError.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
              ),
            );
          }
        });

        // Write input data to stdin
        pythonProcess.stdin.write(inputData);
        pythonProcess.stdin.end();
      });

      // Check for errors in result
      if (result.error) {
        throw new HttpException(
          `SpaCy processing error: ${result.error}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return result;
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Error executing spaCy script:', error);

      // Handle specific error cases
      if (error.code === 'ENOENT') {
        throw new HttpException(
          'Python script not found. Please ensure the script exists at the specified path.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      if (error.message && error.message.includes('JSON')) {
        throw new HttpException(
          'Failed to parse Python script output',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      throw new HttpException(
        `Failed to extract POS tags: ${error.message || 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

