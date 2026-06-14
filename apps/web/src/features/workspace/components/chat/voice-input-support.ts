const BAR_COUNT = 5;

export const VOICE_INPUT_BAR_COUNT = BAR_COUNT;

export function idleVoiceLevels(): number[] {
  return Array.from({ length: BAR_COUNT }, () => 0.12);
}

export function mergeVoiceTranscript(base: string, final: string, interim: string): string {
  const prefix = base.trimEnd();
  const spoken = `${final}${interim}`.trim();
  if (!spoken) return prefix;
  if (!prefix) return spoken;
  const needsSpace = !prefix.endsWith(" ") && !spoken.startsWith(" ");
  return `${prefix}${needsSpace ? " " : ""}${spoken}`;
}

export interface VoiceInputSupport {
  supported: boolean;
  reason?: string;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResultItem;
}

interface SpeechRecognitionResultItem {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate =
    (window as Window & { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ??
    (window as Window & { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;
  return candidate ?? null;
}

export function getVoiceInputSupport(): VoiceInputSupport {
  if (typeof window === "undefined") {
    return { supported: false, reason: "Voice input is only available in the browser." };
  }
  if (!getSpeechRecognitionConstructor()) {
    return {
      supported: false,
      reason: "Voice input isn't supported in this browser. Try Chrome or Safari.",
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      supported: false,
      reason: "Microphone access isn't available in this browser.",
    };
  }
  return { supported: true };
}

export function createSpeechRecognition(): SpeechRecognitionInstance | null {
  const ctor = getSpeechRecognitionConstructor();
  if (!ctor) return null;
  const recognition = new ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";
  return recognition;
}

function levelsFromFrequency(analyser: AnalyserNode, barCount: number): number[] {
  const bins = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(bins);
  const sliceSize = Math.max(1, Math.floor(bins.length / barCount));
  const levels: number[] = [];
  for (let bar = 0; bar < barCount; bar += 1) {
    const start = bar * sliceSize;
    const end = Math.min(bins.length, start + sliceSize);
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      sum += bins[i] ?? 0;
    }
    const average = sum / Math.max(1, end - start);
    levels.push(Math.min(1, average / 110));
  }
  return levels;
}

function levelsFromWaveform(analyser: AnalyserNode, barCount: number): number[] {
  const samples = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(samples);
  const sliceSize = Math.max(1, Math.floor(samples.length / barCount));
  const levels: number[] = [];
  for (let bar = 0; bar < barCount; bar += 1) {
    const start = bar * sliceSize;
    const end = Math.min(samples.length, start + sliceSize);
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      const centered = (samples[i] ?? 128) - 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start)) / 128;
    levels.push(Math.min(1, rms * 2.4));
  }
  return levels;
}

export function levelsFromAnalyser(analyser: AnalyserNode, barCount = BAR_COUNT): number[] {
  const waveform = levelsFromWaveform(analyser, barCount);
  const frequency = levelsFromFrequency(analyser, barCount);
  return waveform.map((level, index) =>
    Math.min(1, level * 0.72 + (frequency[index] ?? 0) * 0.28),
  );
}

export function smoothVoiceLevels(
  previous: readonly number[],
  next: readonly number[],
  barCount = BAR_COUNT,
): number[] {
  const smoothed: number[] = [];
  for (let index = 0; index < barCount; index += 1) {
    const prev = previous[index] ?? 0.12;
    const target = next[index] ?? 0.12;
    const blend = target > prev ? 0.62 : 0.22;
    smoothed.push(prev + (target - prev) * blend);
  }
  return smoothed;
}
