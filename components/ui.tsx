"use client";

import { AnimatePresence, animate, motion, useInView, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Status } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/format";

type BtnProps = HTMLMotionProps<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" };

const VARIANTS = {
  primary: "bg-accent text-white hover:bg-accent-hover disabled:bg-hairline disabled:text-muted",
  secondary: "bg-tile-alt text-ink hover:bg-[#e8e8ed] disabled:text-muted",
  ghost: "text-accent hover:underline",
  danger: "bg-red-soft text-red hover:bg-[#fadbd8]",
};
const SIZES = { sm: "px-3.5 py-1.5 text-[13px]", md: "px-5 py-2.5 text-[15px]", lg: "px-7 py-3.5 text-[17px]" };

/** Pill button with spring press feedback. */
export function Button({ variant = "primary", size = "md", className = "", ...rest }: BtnProps) {
  return (
    <motion.button
      whileTap={rest.disabled ? undefined : { scale: 0.95 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  );
}

export function PillLink({ href, children, variant = "primary", className = "" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center justify-center rounded-full px-5 py-2.5 text-[15px] font-medium transition-colors ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/** Fade + 24px rise when scrolled into view, once. */
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  return (
    <motion.div ref={ref} className={className} initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay }}>
      {children}
    </motion.div>
  );
}

/** Rounded tile that lifts slightly on hover. */
export function Tile({ children, className = "", dark = false, hover = true }: { children: React.ReactNode; className?: string; dark?: boolean; hover?: boolean }) {
  return (
    <motion.div whileHover={hover ? { scale: 1.02 } : undefined} transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className={`rounded-[22px] border p-6 ${dark ? "border-white/10 bg-[#2a2a2c] text-white" : "border-hairline/70 bg-tile"} ${className}`}>
      {children}
    </motion.div>
  );
}

/** Counts up to a value on first view; static under reduced motion. */
export function CountUp({ value, className = "", format = (v: number) => Math.round(v).toLocaleString("en-IN") }: { value: number; className?: string; format?: (v: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setShown(value);
      return;
    }
    const c = animate(0, value, { duration: 1.4, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    return () => c.stop();
  }, [inView, value, reduce]);
  return <span ref={ref} className={`tabular ${className}`} aria-label={format(value)}>{format(shown)}</span>;
}

const CHIP: Record<Status, string> = {
  STOCKOUT_RISK: "bg-red-soft text-red",
  OVERSTOCK_RISK: "bg-amber-soft text-amber",
  HEALTHY: "bg-green-soft text-green",
  JUDGMENT_ZONE: "bg-grey-soft text-grey",
};

/** Status chip that cross-fades when its status changes. */
export function StatusChip({ status }: { status: Status }) {
  return (
    <span className="relative inline-grid">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${CHIP[status]}`}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {STATUS_LABEL[status]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function FlagChip({ code, title }: { code: string; title?: string }) {
  return (
    <span title={title} className="inline-flex rounded-md border border-hairline bg-tile px-1.5 py-0.5 text-[11px] font-semibold text-ink/80">
      {code}
    </span>
  );
}

export function Sparkline({ data, label, width = 240, height = 56 }: { data: number[]; label: string; width?: number; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const y = (v: number) => height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  const d = data.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = data.length - 1;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" preserveAspectRatio="none">
      <path d={`${d} L${width},${height} L0,${height} Z`} fill="var(--accent)" opacity="0.08" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last * step} cy={y(data[last])} r="3" fill="var(--accent)" />
    </svg>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-sm text-muted">
      <motion.span className="h-4 w-4 rounded-full border-2 border-hairline border-t-accent" animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }} aria-hidden />
      {label}
    </div>
  );
}

export function ErrorBox({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div role="alert" className="rounded-2xl border border-red/20 bg-red-soft p-4 text-sm text-red">
      <ul className="space-y-1">{messages.map((m, i) => <li key={i} className="font-mono text-[13px]">{m}</li>)}</ul>
    </div>
  );
}

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}
