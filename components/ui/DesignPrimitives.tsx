'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import {
  EASE_EDITORIAL,
  MODAL_OVERLAY_VARIANTS,
  MODAL_PANEL_VARIANTS,
  MOTION_DURATION,
} from '@/lib/motion/presets';
import { cn } from '@/lib/utils';

export interface ButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
  > {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const variants = {
    primary: 'bg-[#222B3A] text-white hover:bg-[#161D28] border border-[#222B3A]',
    secondary: 'bg-[#FAF9F5] text-[#1E2433] hover:bg-[#EFECE3] border border-[#E2DFD7]',
    danger: 'bg-[#C94A43] text-white hover:bg-[#B03D37] border border-[#C94A43]',
    ghost: 'bg-transparent text-[#5C5E64] hover:bg-[#EFECE3] hover:text-[#1E2433] border border-transparent',
  };
  const sizes = {
    sm: 'px-3.5 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  };
  const isDisabled = Boolean(disabled || loading);

  return (
    <motion.button
      {...props}
      disabled={isDisabled}
      whileHover={isDisabled ? undefined : { y: -1 }}
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      transition={{ duration: MOTION_DURATION.fast, ease: EASE_EDITORIAL }}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E56B63] focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </motion.button>
  );
}

export function TextField({
  label,
  error,
  id,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const inputId = id || `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-xs font-medium text-[#4A4945]">
        {label}
      </label>
      <input
        id={inputId}
        {...props}
        className={cn(
          'h-10 rounded-xl border bg-white px-3.5 text-sm text-[#1E2433] placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:outline-none focus:ring-2 focus:ring-[#222B3A]/10',
          error ? 'border-[#C94A43]' : 'border-[#E2DFD7]'
        )}
      />
      {error && <p className="text-xs text-[#C94A43]">{error}</p>}
    </div>
  );
}

export function SelectField({
  label,
  error,
  id,
  children,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  const selectId = id || `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={selectId} className="text-xs font-medium text-[#4A4945]">
        {label}
      </label>
      <select
        id={selectId}
        {...props}
        className={cn(
          'h-10 rounded-xl border bg-white px-3 text-sm text-[#1E2433] focus:border-[#222B3A] focus:outline-none focus:ring-2 focus:ring-[#222B3A]/10',
          error ? 'border-[#C94A43]' : 'border-[#E2DFD7]'
        )}
      >
        {children}
      </select>
      {error && <p className="text-xs text-[#C94A43]">{error}</p>}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = 'Cari...',
  ariaLabel = 'Pencarian',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#8A8B90]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-10 w-full rounded-full border border-[#E2DFD7] bg-[#FAF9F5] pl-10 pr-4 text-sm text-[#1E2433] placeholder:text-[#8A8B90] focus:border-[#222B3A] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#222B3A]/10"
      />
    </div>
  );
}

export function StatusIndicator({ status }: { status: string }) {
  const s = status.toLowerCase();
  let tone = 'bg-[#EFECE3] text-[#4A4945]';
  if (
    [
      'tersedia',
      'aktif',
      'selesai',
      'lunas',
      'tepat waktu',
      'dikembalikan',
      'disetujui',
      'diterima',
      'baik',
      'ditemukan',
      'backup terpenuhi',
    ].includes(s)
  ) {
    tone = 'bg-emerald-50 text-emerald-800';
  } else if (
    [
      'dipinjam',
      'dipesan',
      'diajukan',
      'menunggu',
      'menunggu persetujuan',
      'sebagian',
      'sebagian kembali',
      'diterima sebagian',
      'rusak ringan',
      'direservasi',
      'dikembalikan (terlambat)',
    ].includes(s)
  ) {
    tone = 'bg-amber-50 text-amber-800';
  } else if (
    [
      'terlambat',
      'diblokir',
      'belum lunas',
      'hilang',
      'rusak',
      'rusak berat',
      'ditolak',
      'kedaluwarsa',
      'tidak ditemukan',
      'wajib backup dahulu',
    ].includes(s)
  ) {
    tone = 'bg-[#FDF0EF] text-[#C94A43]';
  } else if (['dibebaskan', 'diambil', 'nonaktif', 'dibatalkan', 'perbaikan'].includes(s)) {
    tone = 'bg-[#EFECE3] text-[#6E6E73]';
  }

  return (
    <span className={cn('inline-block rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap', tone)}>
      {status}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'neutral' | 'accent' | 'warning' | 'danger' | 'success';
}) {
  const valueTone = {
    neutral: 'text-[#1E2433]',
    accent: 'text-[#E56B63]',
    warning: 'text-amber-700',
    danger: 'text-[#C94A43]',
    success: 'text-emerald-700',
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
      className="rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-4"
    >
      <p className="text-xs font-medium text-[#5C5E64]">{label}</p>
      <p className={cn('mt-2 font-serif text-2xl font-semibold tabular-nums tracking-tight', valueTone)}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-[#7B7D82]">{hint}</p>}
    </motion.div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          variants={MODAL_OVERLAY_VARIANTS}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.18, ease: EASE_EDITORIAL }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E2433]/45 p-4 backdrop-blur-[2px]"
        >
          <motion.div
            variants={MODAL_PANEL_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
            className={cn(
              'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-[#E2DFD7] bg-[#FAF9F5] shadow-2xl print:max-h-none print:overflow-visible',
              maxWidth
            )}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#E7E4DC] bg-[#FAF9F5] px-6 py-4">
              <div className="min-w-0">
                <h2 id="modal-title" className="font-serif text-lg font-semibold text-[#1E2433]">
                  {title}
                </h2>
                {description && <p className="mt-0.5 text-xs text-[#5C5E64]">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup dialog"
                className="shrink-0 rounded-full p-1.5 text-[#7B7D82] hover:bg-[#EFECE3] hover:text-[#1E2433] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 print:overflow-visible">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Konfirmasi',
  variant = 'danger',
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'primary' | 'danger';
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <p className="text-sm text-slate-600">{message}</p>
      <div className="mt-6 flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Batal
        </Button>
        <Button variant={variant} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#DFDCD4] bg-[#FAF9F5] px-6 py-12 text-center"
    >
      <Inbox className="h-8 w-8 text-[#8A8B90]" />
      <h3 className="mt-3 font-serif text-sm font-semibold text-[#1E2433]">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-[#5C5E64]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}

export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-xl border border-[#E7E4DC] bg-[#FAF9F5] p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-[#EFECE3]" />
      ))}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION_DURATION.normal, ease: EASE_EDITORIAL }}
      className="flex items-center justify-between gap-4 rounded-xl border border-[#F2C6C3] bg-[#FDF2F1] px-4 py-3 text-sm text-[#9E352F]"
    >
      <div className="flex items-center gap-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[#C94A43]" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Muat Ulang
        </Button>
      )}
    </motion.div>
  );
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-[#E7E4DC] bg-[#FAF9F5] px-4 py-3 text-xs text-[#5C5E64]">
      <span className="tabular-nums">
        Halaman {page} dari {totalPages} · Total {totalItems} data
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Halaman sebelumnya"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Sebelumnya
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Halaman berikutnya"
        >
          Berikutnya
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function QrCodeImage({ value, size = 96 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string>('');

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value || 'EMPTY', { width: size * 2, margin: 1 })
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!src) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded border border-[#E7E4DC] bg-[#F4F3EE] font-mono text-[10px] text-[#8A8B90]"
      >
        QR
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`QR ${value}`}
      width={size}
      height={size}
      className="rounded border border-[#E7E4DC] bg-white p-1"
    />
  );
}
