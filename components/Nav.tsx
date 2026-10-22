"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRole } from "./Providers";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/runs/new", label: "New run", analystOnly: true },
  { href: "/runs", label: "Plans" },
  { href: "/history", label: "History" },
];

export function Nav() {
  const { role, setRole } = useRole();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const links = LINKS.filter((l) => !l.analystOnly || role === "analyst");
  const who = role === "raghav" ? "Raghav · Approver" : role === "analyst" ? "Analyst" : role === "procurement" ? "Procurement" : null;
  return (
    <header className="sticky top-0 z-50 border-b border-black/10 bg-[rgba(251,251,253,0.72)] backdrop-blur-[20px] backdrop-saturate-150">
      <nav aria-label="Main" className="mx-auto flex h-11 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span aria-hidden className="inline-block h-4 w-4 rounded-full bg-gradient-to-br from-green to-accent" />
          Freshroots
        </Link>
        <ul className="hidden items-center gap-7 text-[13px] sm:flex">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href) && !(l.href === "/runs" && path === "/runs/new");
            return (
              <li key={l.href}>
                <Link href={l.href} aria-current={active ? "page" : undefined}
                  className={active ? "text-ink" : "text-ink/70 transition-colors hover:text-ink"}>
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="hidden items-center gap-3 text-[13px] sm:flex">
          {who ? (
            <>
              <span className="text-muted">{who}</span>
              <button onClick={() => setRole(null)} className="text-accent hover:underline">Switch</button>
            </>
          ) : (
            <Link href="/signin" className="text-accent hover:underline">Sign in</Link>
          )}
        </div>
        <button className="sm:hidden -mr-2 p-2 text-sm" aria-expanded={open} aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}>
          <span className="sr-only">Menu</span>
          <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden><path d="M0 1h18M0 6h18M0 11h18" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.ul id="mobile-nav" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="border-t border-black/10 px-4 pb-4 sm:hidden">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="block border-b border-black/5 py-3 text-lg font-medium">
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="pt-3 text-sm">
              {who ? (
                <button onClick={() => { setRole(null); setOpen(false); }} className="text-accent">{who} · Switch</button>
              ) : (
                <Link href="/signin" onClick={() => setOpen(false)} className="text-accent">Sign in</Link>
              )}
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
    </header>
  );
}
