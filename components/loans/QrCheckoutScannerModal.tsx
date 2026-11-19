'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  AlertTriangle,
  BookOpen,
  Camera,
  CameraOff,
  CheckCircle2,
  ImageUp,
  QrCode,
  RefreshCw,
  Trash2,
  UserCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button, Modal, StatusIndicator } from '@/components/ui/DesignPrimitives';
import { formatCurrencyIDR, formatIsoDate } from '@/lib/domain/library-rules';
import {
  resolveQrCheckoutScan,
  type QrCopyCandidate,
  type QrMemberCandidate,
  type QrScanMode,
} from '@/lib/domain/qr-checkout';

interface ScanHistoryEntry {
  id: string;
  time: string;
  code: string;
  label: string;
  ok: boolean;
}

interface QrCheckoutScannerModalProps {
  open: boolean;
  onClose: () => void;
  members: QrMemberCandidate[];
  allCopies: QrCopyCandidate[];
  selectedMember: QrMemberCandidate | null;
  basket: QrCopyCandidate[];
  notes: string;
  submitting: boolean;
  onSelectMember: (memberId: number | null) => void;
  onAddCopy: (copy: QrCopyCandidate) => void;
  onRemoveCopy: (copyId: number) => void;
  onChangeNotes: (notes: string) => void;
  onConfirmCheckout: () => Promise<boolean>;
}

function playScanBeep(kind: 'ok' | 'error') {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === 'ok' ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(kind === 'ok' ? 880 : 320, ctx.currentTime);
    if (kind === 'ok') {
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.06);
    }
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.17);
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 250);
  } catch {
    // Ignore audio context restrictions
  }
}

function decodeImageElementToQr(
  source: CanvasImageSource,
  width: number,
  height: number,
  canvas: HTMLCanvasElement
): string | null {
  if (!width || !height) return null;
  const maxDim = 960;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  if (canvas.width !== targetW) canvas.width = targetW;
  if (canvas.height !== targetH) canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, targetW, targetH);
  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const code = jsQR(imgData.data, targetW, targetH, {
    inversionAttempts: 'attemptBoth',
  });
  return code?.data?.trim() || null;
}

export function QrCheckoutScannerModal({
  open,
  onClose,
  members,
  allCopies,
  selectedMember,
  basket,
  notes,
  submitting,
  onSelectMember,
  onAddCopy,
  onRemoveCopy,
  onChangeNotes,
  onConfirmCheckout,
}: QrCheckoutScannerModalProps) {
  const [scanMode, setScanMode] = useState<QrScanMode>('auto');
  const [manualCode, setManualCode] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [cameraStatus, setCameraStatus] = useState<
    'idle' | 'starting' | 'active' | 'denied' | 'unavailable'
  >('idle');
  const [cameraError, setCameraError] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [lastFeedback, setLastFeedback] = useState<{
    tone: 'neutral' | 'success' | 'warning' | 'error';
    title: string;
    detail: string;
  }>({
    tone: 'neutral',
    title: 'Siap Memindai QR',
    detail: 'Arahkan QR kartu anggota atau label buku ke kamera, unggah gambar QR, atau pindai lewat scanner USB.',
  });
  const [scanLog, setScanLog] = useState<ScanHistoryEntry[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const lastCameraDecodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const processDecodedValue = useCallback(
    (rawText: string, source: 'camera' | 'image' | 'manual') => {
      const trimmed = rawText.trim();
      if (!trimmed) return;

      if (source === 'camera') {
        const now = Date.now();
        if (
          lastCameraDecodeRef.current.code === trimmed &&
          now - lastCameraDecodeRef.current.at < 2400
        ) {
          return;
        }
        lastCameraDecodeRef.current = { code: trimmed, at: now };
      }

      const todayStr = formatIsoDate(new Date());
      const resolution = resolveQrCheckoutScan({
        rawText: trimmed,
        members,
        copies: allCopies,
        basketCopyIds: basket.map((b) => b.id),
        selectedMember,
        todayStr,
        scanMode,
      });

      const timeStr = new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      if (resolution.ok && resolution.kind === 'member') {
        onSelectMember(resolution.member.id);
        if (soundEnabled) playScanBeep(resolution.warning ? 'error' : 'ok');
        setLastFeedback({
          tone: resolution.warning ? 'warning' : 'success',
          title: `Anggota Terpilih: ${resolution.member.full_name}`,
          detail: resolution.warning
            ? `${resolution.member.member_code} · ${resolution.warning}`
            : `${resolution.member.member_code} · Kuota ${resolution.member.active_loans_count}/${resolution.member.max_loans} buku`,
        });
        setScanLog((prev) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            time: timeStr,
            code: resolution.code,
            label: `Anggota: ${resolution.member.full_name}`,
            ok: !resolution.warning,
          },
          ...prev.slice(0, 4),
        ]);
        return;
      }

      if (resolution.ok && resolution.kind === 'copy') {
        onAddCopy(resolution.copy);
        if (soundEnabled) playScanBeep('ok');
        setLastFeedback({
          tone: 'success',
          title: `Buku Ditambahkan: ${resolution.copy.book_title}`,
          detail: `${resolution.copy.inventory_code} · ${resolution.copy.barcode}`,
        });
        setScanLog((prev) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            time: timeStr,
            code: resolution.code,
            label: resolution.copy.book_title,
            ok: true,
          },
          ...prev.slice(0, 4),
        ]);
        return;
      }

      if (!resolution.ok) {
        if (soundEnabled) playScanBeep('error');
        setLastFeedback({
          tone: resolution.status === 'duplicate' ? 'warning' : 'error',
          title:
            resolution.status === 'duplicate'
              ? 'Eksemplar Sudah di Keranjang'
              : 'Pemindaian Tidak Dapat Diproses',
          detail: resolution.reason,
        });
        setScanLog((prev) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            time: timeStr,
            code: resolution.code || trimmed.slice(0, 24),
            label: resolution.reason,
            ok: false,
          },
          ...prev.slice(0, 4),
        ]);
      }
    },
    [allCopies, basket, members, onAddCopy, onSelectMember, scanMode, selectedMember, soundEnabled]
  );

  // Keep latest processor ref for the animation loop without tearing down the camera
  const processRef = useRef(processDecodedValue);
  useEffect(() => {
    processRef.current = processDecodedValue;
  }, [processDecodedValue]);

  const startCamera = useCallback(
    async (preferredDeviceId?: string) => {
      stopCamera();
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setCameraStatus('unavailable');
        setCameraError(
          'Peramban atau perangkat ini tidak menyediakan akses kamera. Gunakan unggah gambar QR atau scanner USB di bawah.'
        );
        return;
      }

      setCameraStatus('starting');
      setCameraError('');

      try {
        const videoConstraints: MediaTrackConstraints = preferredDeviceId
          ? { deviceId: { exact: preferredDeviceId } }
          : { facingMode: { ideal: 'environment' } };

        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });

        streamRef.current = stream;

        if (navigator.mediaDevices.enumerateDevices) {
          const allDevs = await navigator.mediaDevices.enumerateDevices();
          const videoDevs = allDevs.filter((d) => d.kind === 'videoinput');
          setDevices(videoDevs);
          if (!preferredDeviceId && videoDevs[0]?.deviceId) {
            setSelectedDeviceId(videoDevs[0].deviceId);
          }
        }

        const videoEl = videoRef.current;
        if (!videoEl) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        videoEl.srcObject = stream;
        await videoEl.play();
        setCameraStatus('active');

        let lastTick = 0;
        const scanFrame = (ts: number) => {
          if (!streamRef.current) return;
          if (ts - lastTick >= 180) {
            lastTick = ts;
            const v = videoRef.current;
            const c = canvasRef.current;
            if (v && c && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
              const decoded = decodeImageElementToQr(v, v.videoWidth, v.videoHeight, c);
              if (decoded) {
                processRef.current(decoded, 'camera');
              }
            }
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        };
        rafRef.current = requestAnimationFrame(scanFrame);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setCameraStatus('denied');
          setCameraError(
            'Izin kamera ditolak. Berikan izin kamera di peramban, atau gunakan unggah gambar QR / input scanner USB.'
          );
        } else {
          setCameraStatus('unavailable');
          setCameraError(
            msg.includes('Requested device not found') || name === 'NotFoundError'
              ? 'Kamera tidak ditemukan pada perangkat ini. Gunakan unggah gambar QR atau input scanner USB.'
              : 'Kamera tidak dapat diaktifkan. Gunakan unggah gambar QR atau input scanner USB.'
          );
        }
      }
    },
    [stopCamera]
  );

  const handleClose = useCallback(() => {
    stopCamera();
    setCameraStatus('idle');
    onClose();
  }, [onClose, stopCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    const timer = window.setTimeout(() => {
      void startCamera(selectedDeviceId || undefined);
      manualInputRef.current?.focus();
    }, 60);

    return () => {
      window.clearTimeout(timer);
      stopCamera();
    };
    // Only run camera lifecycle when modal opens/closes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stopCamera]);

  async function handleImageUpload(file: File | null) {
    if (!file) return;
    try {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = canvasRef.current || document.createElement('canvas');
          const decoded = decodeImageElementToQr(img, img.naturalWidth, img.naturalHeight, canvas);
          if (!decoded) {
            if (soundEnabled) playScanBeep('error');
            setLastFeedback({
              tone: 'error',
              title: 'QR Tidak Terdeteksi pada Gambar',
              detail: `Gambar "${file.name}" tidak memuat kode QR yang jelas terbaca.`,
            });
          } else {
            processDecodedValue(decoded, 'image');
          }
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setLastFeedback({
          tone: 'error',
          title: 'Berkas Gambar Tidak Valid',
          detail: 'Pastikan berkas berupa gambar PNG, JPG, atau WebP.',
        });
      };
      img.src = objectUrl;
    } catch {
      setLastFeedback({
        tone: 'error',
        title: 'Gagal Membaca Gambar QR',
        detail: 'Terjadi kendala saat memproses gambar.',
      });
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualCode.trim()) return;
    processDecodedValue(manualCode, 'manual');
    setManualCode('');
    manualInputRef.current?.focus();
  }

  async function handleModalConfirmCheckout() {
    const ok = await onConfirmCheckout();
    if (ok) {
      setLastFeedback({
        tone: 'success',
        title: 'Transaksi Peminjaman Selesai',
        detail: 'Peminjaman berhasil dicatat. Pindai QR anggota berikutnya untuk transaksi baru.',
      });
    }
  }

  const feedbackStyles = {
    neutral: 'border-[#E7E4DC] bg-[#F4F3EE] text-[#1E2433]',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-[#F2C6C3] bg-[#FDF2F1] text-[#9E352F]',
  }[lastFeedback.tone];

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Pemindaian QR Checkout Cepat"
      description="Pindai QR kartu anggota dan label buku secara berurutan untuk memproses peminjaman."
      maxWidth="max-w-5xl"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left column: Camera & Scanner Inputs */}
        <div className="space-y-4 lg:col-span-6">
          {/* Scan Mode Segmented Control */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-label="Mode pemindaian QR"
              className="inline-flex rounded-lg border border-[#E7E4DC] bg-[#F4F3EE] p-0.5"
            >
              {(
                [
                  { id: 'auto', label: 'Otomatis' },
                  { id: 'member', label: 'Anggota' },
                  { id: 'copy', label: 'Buku' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setScanMode(m.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    scanMode === m.id
                      ? 'bg-[#FAF9F5] text-[#1E2433] shadow-sm'
                      : 'text-[#5C5E64] hover:text-[#1E2433]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSoundEnabled((v) => !v)}
                aria-label={soundEnabled ? 'Bisukan suara scan' : 'Aktifkan suara scan'}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E7E4DC] bg-[#FAF9F5] text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433] cursor-pointer"
                title={soundEnabled ? 'Suara aktif' : 'Suara dibisukan'}
              >
                {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              {cameraStatus === 'active' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    stopCamera();
                    setCameraStatus('idle');
                  }}
                >
                  <CameraOff className="h-3.5 w-3.5" />
                  Jeda Kamera
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void startCamera(selectedDeviceId || undefined)}
                >
                  <Camera className="h-3.5 w-3.5" />
                  Aktifkan Kamera
                </Button>
              )}
            </div>
          </div>

          {/* Camera selector when multiple cameras exist */}
          {devices.length > 1 && (
            <div className="flex items-center gap-2">
              <label htmlFor="qr-camera-select" className="text-xs font-medium text-[#5C5E64] whitespace-nowrap">
                Perangkat Kamera:
              </label>
              <select
                id="qr-camera-select"
                value={selectedDeviceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedDeviceId(id);
                  void startCamera(id);
                }}
                className="h-8 flex-1 rounded-lg border border-[#E7E4DC] bg-white px-2.5 text-xs text-[#1E2433]"
              >
                {devices.map((d, idx) => (
                  <option key={d.deviceId || idx} value={d.deviceId}>
                    {d.label || `Kamera ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Live Camera Preview Frame */}
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-[#DFDCD4] bg-[#1E2433]">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`h-full w-full object-cover ${cameraStatus === 'active' ? 'opacity-100' : 'opacity-0'}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraStatus === 'active' ? (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-6">
                <div className="relative h-48 w-48 rounded-xl border border-white/35">
                  <span className="absolute -top-0.5 -left-0.5 h-6 w-6 rounded-tl-lg border-t-2 border-l-2 border-[#E56B63]" />
                  <span className="absolute -top-0.5 -right-0.5 h-6 w-6 rounded-tr-lg border-t-2 border-r-2 border-[#E56B63]" />
                  <span className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-lg border-b-2 border-l-2 border-[#E56B63]" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-lg border-b-2 border-r-2 border-[#E56B63]" />
                </div>
                <p className="mt-3 rounded-md bg-[#1E2433]/80 px-3 py-1 text-[11px] font-medium text-[#FAF9F5]">
                  Posisikan kode QR di dalam bingkai
                </p>
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-[#FAF9F5]">
                <QrCode className="h-10 w-10 text-[#E56B63]" />
                <p className="mt-3 text-sm font-medium">
                  {cameraStatus === 'starting'
                    ? 'Menghubungkan ke kamera...'
                    : cameraStatus === 'idle'
                      ? 'Kamera Dijeda'
                      : 'Kamera Tidak Tersedia'}
                </p>
                <p className="mt-1 max-w-xs text-xs text-[#DFDCD4]">
                  {cameraError ||
                    'Anda tetap dapat memindai dengan mengunggah gambar QR atau mengetikkan/scan kode di bawah.'}
                </p>
                {cameraStatus !== 'starting' && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-4"
                    onClick={() => void startCamera(selectedDeviceId || undefined)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Coba Kamera Lagi
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Upload QR Image & Hardware Scanner / Paste Input */}
          <div className="space-y-3 rounded-xl border border-[#E7E4DC] bg-[#F4F3EE] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-[#1E2433]">
                  Unggah Gambar QR atau Gunakan Scanner USB
                </p>
                <p className="text-[11px] text-[#5C5E64]">
                  Mendukung format kode anggota (AGT-...), barcode (BC...), kode inventaris (LP-...), atau JSON/URL QR.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                aria-label="Unggah gambar QR code"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  void handleImageUpload(file);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageUp className="h-3.5 w-3.5" />
                Unggah Gambar QR
              </Button>
            </div>

            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                ref={manualInputRef}
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Scan scanner USB atau ketik kode QR..."
                aria-label="Input hasil pindai QR"
                className="h-10 flex-1 rounded-xl border border-[#E2DFD7] bg-white px-3.5 font-mono text-xs text-[#1E2433] placeholder:font-sans placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:outline-none"
              />
              <Button type="submit" size="sm">
                Proses QR
              </Button>
            </form>
          </div>
        </div>

        {/* Right column: Checkout State, Basket & Confirm */}
        <div className="flex flex-col justify-between space-y-4 lg:col-span-6">
          <div className="space-y-4">
            {/* Live Feedback Banner */}
            <div
              role="status"
              aria-live="polite"
              className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs ${feedbackStyles}`}
            >
              {lastFeedback.tone === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              ) : lastFeedback.tone === 'warning' || lastFeedback.tone === 'error' ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-[#5C5E64]" />
              )}
              <div className="min-w-0">
                <p className="font-semibold">{lastFeedback.title}</p>
                <p className="mt-0.5 opacity-90">{lastFeedback.detail}</p>
              </div>
            </div>

            {/* Selected Member Summary */}
            <div className="rounded-xl border border-[#E7E4DC] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-[#E56B63]" />
                  <h3 className="font-serif text-sm font-semibold text-[#1E2433]">
                    1. Peminjam Terpilih
                  </h3>
                </div>
                {selectedMember && (
                  <button
                    type="button"
                    onClick={() => onSelectMember(null)}
                    className="text-xs font-medium text-[#5C5E64] hover:text-[#1E2433] cursor-pointer"
                  >
                    Ganti Anggota
                  </button>
                )}
              </div>

              {selectedMember ? (
                <div className="mt-3 space-y-1.5 border-t border-[#EAE7DF] pt-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#1E2433]">{selectedMember.full_name}</span>
                    <StatusIndicator status={selectedMember.status} />
                  </div>
                  <p className="font-mono text-[#5C5E64]">
                    {selectedMember.member_code} · {selectedMember.membership_type_name}
                  </p>
                  <p className="text-[#5C5E64] tabular-nums">
                    Pinjaman aktif: <strong>{selectedMember.active_loans_count}</strong> /{' '}
                    {selectedMember.max_loans} buku · Durasi: {selectedMember.loan_duration_days} hari · Denda:{' '}
                    <strong>{formatCurrencyIDR(selectedMember.unpaid_fines_total)}</strong>
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-[#7B7D82]">
                  Belum ada anggota dipilih. Pindai QR pada Kartu Anggota (AGT-...).
                </p>
              )}
            </div>

            {/* Scanned Basket */}
            <div className="rounded-xl border border-[#E7E4DC] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-[#222B3A]" />
                  <h3 className="font-serif text-sm font-semibold text-[#1E2433]">
                    2. Buku di Keranjang ({basket.length})
                  </h3>
                </div>
                {basket.length > 0 && selectedMember && (
                  <span className="font-mono text-xs text-[#5C5E64] tabular-nums">
                    Kuota: {selectedMember.active_loans_count + basket.length}/{selectedMember.max_loans}
                  </span>
                )}
              </div>

              {basket.length === 0 ? (
                <p className="mt-3 border-t border-[#EAE7DF] pt-4 pb-2 text-center text-xs text-[#7B7D82]">
                  Pindai QR pada label buku untuk menambahkan eksemplar ke keranjang.
                </p>
              ) : (
                <ul className="mt-3 max-h-44 divide-y divide-[#EAE7DF] overflow-y-auto border-t border-[#EAE7DF]">
                  {basket.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[#1E2433]">{item.book_title}</p>
                        <p className="font-mono text-[11px] text-[#5C5E64]">
                          {item.inventory_code} · {item.barcode}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveCopy(item.id)}
                        aria-label={`Hapus ${item.inventory_code} dari keranjang`}
                        className="rounded p-1 text-[#7B7D82] hover:bg-red-50 hover:text-[#C94A43] cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Session Scan History */}
            {scanLog.length > 0 && (
              <div className="space-y-1.5 px-1">
                <p className="text-[11px] font-medium text-[#5C5E64]">Riwayat Scan Terakhir</p>
                <ul className="divide-y divide-[#EAE7DF] text-[11px]">
                  {scanLog.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-2 py-1">
                      <div className="min-w-0 truncate">
                        <span className="font-mono text-[#5C5E64] tabular-nums">{entry.time}</span>
                        <span className="mx-1.5 text-[#8A8B90]" aria-hidden="true">·</span>
                        <span className="font-mono font-medium text-[#1E2433]">{entry.code}</span>
                        <span className="mx-1.5 text-[#8A8B90]" aria-hidden="true">·</span>
                        <span className={entry.ok ? 'text-[#4A4945]' : 'text-[#C94A43]'}>
                          {entry.label}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Notes + Confirm Action */}
          <div className="space-y-3 border-t border-[#E7E4DC] pt-4">
            <input
              type="text"
              value={notes}
              onChange={(e) => onChangeNotes(e.target.value)}
              placeholder="Catatan transaksi (opsional)"
              aria-label="Catatan transaksi QR checkout"
              className="h-10 w-full rounded-xl border border-[#E2DFD7] bg-white px-3.5 text-xs text-[#1E2433] placeholder:text-[#8A8B90]"
            />
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={handleClose}>
                Tutup Scanner
              </Button>
              <Button
                type="button"
                loading={submitting}
                disabled={!selectedMember || basket.length === 0}
                onClick={() => void handleModalConfirmCheckout()}
              >
                Konfirmasi Peminjaman ({basket.length})
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
