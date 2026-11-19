'use client';

import React from 'react';
import { motion } from 'motion/react';
import { EASE_EDITORIAL, MOTION_DURATION, getStaggerDelay } from '@/lib/motion/presets';

export function CirculationBarChart({
  data,
}: {
  data: Array<{ date: string; loans: number; returns: number }>;
}) {
  if (!data.length) {
    return (
      <p className="py-10 text-center text-xs text-slate-500">
        Belum ada data sirkulasi pada periode ini.
      </p>
    );
  }

  const maxVal = Math.max(1, ...data.flatMap((d) => [d.loans, d.returns]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-4 text-xs text-[#5C5E64]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#222B3A]" />
          Peminjaman
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#E56B63]" />
          Pengembalian
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {data.map((d, idx) => {
          const loanHeight = Math.max(6, Math.round((d.loans / maxVal) * 112));
          const retHeight = Math.max(6, Math.round((d.returns / maxVal) * 112));
          const delay = getStaggerDelay(idx, 0.03, 0.2);
          return (
            <div key={d.date} className="flex flex-col items-center">
              <div className="flex h-32 items-end gap-1.5">
                <div className="flex flex-col items-center gap-1">
                  <span className="font-mono text-[10px] text-[#7B7D82] tabular-nums">{d.loans}</span>
                  <motion.div
                    initial={{ scaleY: 0, opacity: 0.4 }}
                    animate={{ scaleY: 1, opacity: 1 }}
                    transition={{ duration: MOTION_DURATION.spread, delay, ease: EASE_EDITORIAL }}
                    className="w-3.5 origin-bottom rounded-t bg-[#222B3A]"
                    style={{ height: `${loanHeight}px` }}
                    title={`Peminjaman ${d.date}: ${d.loans}`}
                  />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="font-mono text-[10px] text-[#7B7D82] tabular-nums">{d.returns}</span>
                  <motion.div
                    initial={{ scaleY: 0, opacity: 0.4 }}
                    animate={{ scaleY: 1, opacity: 1 }}
                    transition={{
                      duration: MOTION_DURATION.spread,
                      delay: delay + 0.04,
                      ease: EASE_EDITORIAL,
                    }}
                    className="w-3.5 origin-bottom rounded-t bg-[#E56B63]"
                    style={{ height: `${retHeight}px` }}
                    title={`Pengembalian ${d.date}: ${d.returns}`}
                  />
                </div>
              </div>
              <span className="mt-2 font-mono text-[11px] text-[#7B7D82] tabular-nums">
                {d.date.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CategoryHorizontalChart({
  data,
}: {
  data: Array<{ category: string; titles_count: number; loans_count: number }>;
}) {
  if (!data.length) {
    return (
      <p className="py-10 text-center text-xs text-[#7B7D82]">Belum ada kategori tercatat.</p>
    );
  }

  const maxLoans = Math.max(1, ...data.map((d) => d.loans_count));

  return (
    <div className="space-y-3">
      {data.map((item, idx) => {
        const pct = Math.max(4, Math.round((item.loans_count / maxLoans) * 100));
        return (
          <div key={item.category} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium text-[#1E2433]">{item.category}</span>
              <span className="shrink-0 font-mono text-[#7B7D82] tabular-nums">
                {item.loans_count} pinjam · {item.titles_count} judul
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#EFECE3]">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{
                  duration: MOTION_DURATION.spread,
                  delay: getStaggerDelay(idx, 0.03, 0.2),
                  ease: EASE_EDITORIAL,
                }}
                className="h-full origin-left rounded-full bg-[#E56B63]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
