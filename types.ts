export enum AppState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  PAUSED = 'PAUSED',
  PROCESSING = 'PROCESSING',
  ERROR = 'ERROR'
}

export interface TranscriptSegment {
  id: string;
  text: string;
  timestamp: number;
  author: string;
}

export interface AudioRecording {
  blob: Blob;
  url: string;
}