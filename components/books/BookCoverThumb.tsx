'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export type CoverLoadStatus = 'empty' | 'loading' | 'loaded' | 'error';

export function BookCoverThumb({
  src,
  title,
  className,
  imgClassName,
  size = 'md',
  showFallbackTitle = true,
  onStatusChange,
}: {
  src?: string | null;
  title: string;
  className?: string;
  imgClassName?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showFallbackTitle?: boolean;
  onStatusChange?: (status: CoverLoadStatus) => void;
}) {
  const normalizedSrc = String(src || '').trim();
  const imgRef = useRef<HTMLImageElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  const hasError = Boolean(normalizedSrc) && failedSrc === normalizedSrc;
  const isLoaded = Boolean(normalizedSrc) && loadedSrc === normalizedSrc;

  useEffect(() => {
    if (!onStatusChange) return;
    if (!normalizedSrc) {
      onStatusChange('empty');
      return;
    }
    if (hasError) {
      onStatusChange('error');
      return;
    }
    if (isLoaded) {
      onStatusChange('loaded');
      return;
    }
    const el = imgRef.current;
    if (el && el.complete) {
      if (el.naturalWidth > 0) {
        onStatusChange('loaded');
      } else {
        onStatusChange('error');
      }
      return;
    }
    onStatusChange('loading');
  }, [normalizedSrc, hasError, isLoaded, onStatusChange]);

  const iconSize = {
    xs: 'h-3.5 w-3.5',
    sm: 'h-5 w-5',
    md: 'h-7 w-7',
    lg: 'h-9 w-9',
  }[size];

  const showImage = Boolean(normalizedSrc) && !hasError;

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-[#ECE8DF] text-[#7B7D82]',
        className
      )}
    >
      {showImage ? (
        <img
          ref={imgRef}
          key={normalizedSrc}
          src={normalizedSrc}
          alt={`Sampul ${title || 'buku'}`}
          referrerPolicy="no-referrer"
          onLoad={() => {
            setFailedSrc(null);
            setLoadedSrc(normalizedSrc);
          }}
          onError={() => {
            setLoadedSrc(null);
            setFailedSrc(normalizedSrc);
          }}
          className={cn('h-full w-full object-cover', imgClassName)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
          {hasError ? (
            <ImageOff className={cn(iconSize, 'text-[#C94A43]/80')} />
          ) : (
            <BookOpen className={cn(iconSize, 'text-[#8A8B90]')} />
          )}
          {showFallbackTitle && size !== 'xs' && (
            <span className="mt-1.5 line-clamp-2 text-[10px] font-medium leading-tight text-[#5C5E64]">
              {hasError ? 'Link cover gagal dimuat' : title || 'Tanpa sampul'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
