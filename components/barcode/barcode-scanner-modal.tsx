'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { normalizeBarcode, isValidBarcode } from '@/lib/utils/barcode';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-context';

const SAME_BARCODE_COOLDOWN_MS = 2000;

type ScannerState = 'requesting' | 'scanning' | 'denied' | 'unsupported' | 'http' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
  title?: string;
  description?: string;
  continuous?: boolean;
}

function playBeep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square'; osc.frequency.value = 1800;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.12);
  } catch { /* silent */ }
}

export function BarcodeScannerModal({
  open, onClose, onDetected,
  title, description, continuous = false,
}: Props) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScanRef = useRef<{ barcode: string; time: number } | null>(null);
  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onDetectedRef.current = onDetected; });
  useEffect(() => { onCloseRef.current = onClose; });

  const [scannerState, setScannerState] = useState<ScannerState>('requesting');
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const frameCountRef = useRef(0);
  const [frameDisplay, setFrameDisplay] = useState(0);

  const stopScanner = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopScanner();
      setLastScanned(null); setTorchOn(false); setHasTorch(false);
      frameCountRef.current = 0; setFrameDisplay(0);
      return;
    }
    if (typeof window === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerState(location.protocol !== 'https:' && location.hostname !== 'localhost' ? 'http' : 'unsupported');
      return;
    }

    setScannerState('requesting');
    frameCountRef.current = 0; setFrameDisplay(0);
    let cancelled = false;

    void (async () => {
      try {
        const videoConstraints: MediaTrackConstraints = {
          facingMode: { ideal: 'environment' },
          width: { min: 640, ideal: 1920, max: 3840 },
          height: { min: 480, ideal: 1080, max: 2160 },
        };

        const nativeDetector = 'BarcodeDetector' in window
          ? new (window as unknown as { BarcodeDetector: new (o: object) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code','data_matrix','itf'] })
          : null;

        const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

        const video = videoRef.current;
        if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play();

        controlsRef.current = { stop: () => { stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; } } as unknown as import('@zxing/browser').IScannerControls;
        setScannerState('scanning');

        const handleDetect = (barcode: string) => {
          const now = Date.now();
          const last = lastScanRef.current;
          if (last && last.barcode === barcode && now - last.time < SAME_BARCODE_COOLDOWN_MS) return;
          lastScanRef.current = { barcode, time: now };
          setLastScanned(barcode); playBeep();
          if ('vibrate' in navigator) navigator.vibrate(80);
          onDetectedRef.current(barcode);
          if (!continuous) {
            setTimeout(() => { controlsRef.current?.stop(); controlsRef.current = null; onCloseRef.current(); }, 0);
          }
        };

        if (nativeDetector) {
          let rafId: number;
          const poll = async () => {
            if (cancelled) return;
            frameCountRef.current += 1;
            if (frameCountRef.current % 15 === 0) setFrameDisplay(frameCountRef.current);
            if (video.readyState >= 2) {
              try {
                const results = await nativeDetector.detect(video);
                if (results.length > 0 && !cancelled) {
                  const bc = normalizeBarcode(results[0].rawValue);
                  if (isValidBarcode(bc)) handleDetect(bc);
                }
              } catch { /* frame not ready */ }
            }
            rafId = requestAnimationFrame(() => { void poll(); });
          };
          rafId = requestAnimationFrame(() => { void poll(); });
          const prevStop = controlsRef.current!.stop.bind(controlsRef.current);
          controlsRef.current = { stop: () => { cancelAnimationFrame(rafId); prevStop(); } } as unknown as import('@zxing/browser').IScannerControls;
        } else {
          const [{ BrowserMultiFormatReader }, { DecodeHintType }] =
            await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
          if (cancelled) return;
          const hints = new Map<number, unknown>([[DecodeHintType.TRY_HARDER, true]]);
          const reader = new BrowserMultiFormatReader(hints as Map<never, never>, { delayBetweenScanAttempts: 100 });
          controlsRef.current?.stop(); controlsRef.current = null;
          const controls = await reader.decodeFromConstraints({ video: videoConstraints }, video, (result, err) => {
            frameCountRef.current += 1;
            if (frameCountRef.current % 15 === 0) setFrameDisplay(frameCountRef.current);
            if (!result) { if (err && err.name !== 'NotFoundException') console.warn('[Scanner]', err); return; }
            const bc = normalizeBarcode(result.getText());
            if (isValidBarcode(bc)) handleDetect(bc);
          });
          if (cancelled) { controls.stop(); return; }
          controlsRef.current = controls;
        }

        try {
          const tracks = (video.srcObject as MediaStream | null)?.getVideoTracks();
          const caps = tracks?.[0]?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
          setHasTorch(Boolean(caps?.torch));
        } catch { /* not supported */ }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setScannerState(/permission|notallowed|denied/i.test(msg) ? 'denied' : 'error');
      }
    })();

    return () => { cancelled = true; stopScanner(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, continuous, stopScanner]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onCloseRef.current(); }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  async function toggleTorch() {
    const controls = controlsRef.current;
    if (!controls?.switchTorch) return;
    const next = !torchOn;
    try { await controls.switchTorch(next); setTorchOn(next); } catch { /* unsupported */ }
  }

  if (!open) return null;

  const statusMessage = () => {
    if (scannerState === 'requesting') return <div className="scanner-overlay-msg">{t('scanner.requesting')}</div>;
    if (scannerState === 'denied')     return <div className="scanner-overlay-msg scanner-overlay-error">{t('scanner.denied')}</div>;
    if (scannerState === 'unsupported') return <div className="scanner-overlay-msg scanner-overlay-error">{t('scanner.unsupported')}</div>;
    if (scannerState === 'http')       return <div className="scanner-overlay-msg scanner-overlay-error">{t('scanner.http')}</div>;
    if (scannerState === 'error')      return <div className="scanner-overlay-msg scanner-overlay-error">{t('scanner.error')}</div>;
    return null;
  };

  const hintText = frameDisplay === 0
    ? t('scanner.starting')
    : frameDisplay < 30
    ? t('scanner.active')
    : t('scanner.activeFrames', { frames: frameDisplay });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog" aria-modal="true" aria-label={title}
      onClick={() => onCloseRef.current()}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title ?? t('scanner.close')}</h3>
            {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onCloseRef.current()}>
            {t('scanner.close')}
          </Button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-3">
          <div className="scanner-viewport">
            <video ref={videoRef} className="scanner-video" muted playsInline autoPlay />
            {scannerState === 'scanning' && <div className="scanner-crosshair" aria-hidden="true" />}
            {statusMessage()}
          </div>

          {scannerState === 'scanning' && (
            <p className="text-xs text-slate-500 text-center">{hintText}</p>
          )}
          {lastScanned && continuous && (
            <p className="text-xs text-green-600 text-center font-medium">
              {t('scanner.lastScanned')} <strong>{lastScanned}</strong>
            </p>
          )}
        </div>

        {/* Footer */}
        {(hasTorch || continuous) && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
            {hasTorch && (
              <Button type="button" variant="secondary" size="sm" onClick={toggleTorch}>
                {torchOn ? t('scanner.torchOff') : t('scanner.torchOn')}
              </Button>
            )}
            {continuous && (
              <Button type="button" size="sm" onClick={() => onCloseRef.current()}>
                {t('scanner.doneScan')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
