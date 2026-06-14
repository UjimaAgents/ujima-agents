"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createSpeechRecognition,
  getCachedVoiceInputSupport,
  idleVoiceLevels,
  levelsFromAnalyser,
  mergeVoiceTranscript,
  smoothVoiceLevels,
  type VoiceInputSupport,
} from "./voice-input-support";

interface UseComposerVoiceInputOptions {
  enabled: boolean;
  getDraft: () => string;
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
}

interface UseComposerVoiceInputResult {
  support: VoiceInputSupport;
  isListening: boolean;
  audioLevels: number[];
  toggleListening: () => void;
  stopListening: () => void;
}

const SSR_VOICE_SUPPORT: VoiceInputSupport = { supported: false };

function subscribeVoiceSupportNoop(): () => void {
  return () => {};
}

export function useComposerVoiceInput({
  enabled,
  getDraft,
  onTranscript,
  onError,
}: UseComposerVoiceInputOptions): UseComposerVoiceInputResult {
  const support = useSyncExternalStore(
    subscribeVoiceSupportNoop,
    getCachedVoiceInputSupport,
    () => SSR_VOICE_SUPPORT,
  );
  const [isListening, setIsListening] = useState(false);
  const [audioLevels, setAudioLevels] = useState(idleVoiceLevels);

  const listeningRef = useRef(false);
  const baseTextRef = useRef("");
  const finalTextRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const getDraftRef = useRef(getDraft);
  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const smoothedLevelsRef = useRef(idleVoiceLevels());

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    getDraftRef.current = getDraft;
  }, [getDraft]);

  const stopAudioMonitor = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    analyserRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    smoothedLevelsRef.current = idleVoiceLevels();
    setAudioLevels(smoothedLevelsRef.current);
  }, []);

  const stopRecognition = useCallback(() => {
    listeningRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setIsListening(false);
    stopAudioMonitor();
  }, [stopAudioMonitor]);

  const publishTranscript = useCallback((interim: string) => {
    onTranscriptRef.current(
      mergeVoiceTranscript(baseTextRef.current, finalTextRef.current, interim),
    );
  }, []);

  const startAudioMonitor = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.55;
    source.connect(analyser);
    analyserRef.current = analyser;

    const tick = () => {
      if (!listeningRef.current || !analyserRef.current) return;
      const raw = levelsFromAnalyser(analyserRef.current);
      smoothedLevelsRef.current = smoothVoiceLevels(smoothedLevelsRef.current, raw);
      setAudioLevels(smoothedLevelsRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startListening = useCallback(async () => {
    if (!enabled || !support.supported) {
      onErrorRef.current?.(support.reason ?? "Voice input isn't available.");
      return;
    }

    const recognition = createSpeechRecognition();
    if (!recognition) {
      onErrorRef.current?.("Voice input isn't supported in this browser.");
      return;
    }

    baseTextRef.current = getDraftRef.current();
    finalTextRef.current = "";
    smoothedLevelsRef.current = idleVoiceLevels();
    listeningRef.current = true;
    recognitionRef.current = recognition;
    setIsListening(true);

    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const piece = result?.[0]?.transcript ?? "";
        if (!piece) continue;
        if (result.isFinal) {
          finalTextRef.current = `${finalTextRef.current}${piece}`;
        } else {
          interim += piece;
        }
      }
      publishTranscript(interim);
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      onErrorRef.current?.(
        event.message || "Voice input stopped. Check microphone permissions and try again.",
      );
      stopRecognition();
    };

    recognition.onend = () => {
      if (!listeningRef.current) return;
      try {
        recognition.start();
      } catch {
        stopRecognition();
      }
    };

    try {
      await startAudioMonitor();
      recognition.start();
    } catch {
      onErrorRef.current?.("Microphone permission is required for voice input.");
      stopRecognition();
    }
  }, [enabled, publishTranscript, startAudioMonitor, stopRecognition, support]);

  const toggleListening = useCallback(() => {
    if (!enabled && !listeningRef.current) {
      onErrorRef.current?.(support.reason ?? "Voice input isn't available.");
      return;
    }
    if (listeningRef.current) {
      stopRecognition();
      return;
    }
    void startListening();
  }, [enabled, startListening, stopRecognition, support.reason]);

  useEffect(() => () => {
    listeningRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    analyserRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }, []);

  return {
    support,
    isListening,
    audioLevels,
    toggleListening,
    stopListening: stopRecognition,
  };
}
