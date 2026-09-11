import { useCallback, useEffect, useRef, useState } from "react";

// Microphone for the composer via the Web Speech API. Chrome, Edge, and Safari have it;
// the button stays visible but disabled elsewhere so people know why it is off.

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

const ctor = (): RecognitionCtor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export function useVoiceInput(onText: (text: string) => void, onError?: (message: string) => void) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const supported = Boolean(ctor());
  useEffect(() => () => recognition.current?.stop(), []);
  const toggle = useCallback(() => {
    if (listening) { recognition.current?.stop(); return; }
    const Ctor = ctor(); if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US"; r.interimResults = false; r.continuous = true;
    r.onresult = (e) => { let text = ""; for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript; if (text.trim()) onText(text.trim()); };
    r.onend = () => { setListening(false); recognition.current = null; };
    r.onerror = () => { setListening(false); recognition.current = null; onError?.("Voice input stopped. Check the microphone permission and try again."); };
    recognition.current = r;
    try { r.start(); setListening(true); } catch { onError?.("Voice input could not start in this browser."); }
  }, [listening, onText, onError]);
  return { supported, listening, toggle };
}
