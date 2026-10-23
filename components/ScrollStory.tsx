"use client";

import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { useRef, useState } from "react";

const STEPS = [
  { title: "Data", tag: "SAP · Database", comps: "1 · 2", body: "Twice a week the Analyst runs the plan on the latest SAP data, or uploads new SAP files. Each run stores them with a file hash, so every number traces back to its source.", stat: "5 files · 12 checks" },
  { title: "Rules", tag: "AI rules · Raghav's rules", comps: "3 · 4", body: "The rule book, config.yaml and the festival calendar load with every run, version-stamped. Raghav's thresholds live in config, never in code.", stat: "RULEBOOK v1.1" },
  { title: "Predict", tag: "Rules engine", comps: "5", body: "A deterministic engine, not a model, works out cover, trend and festival uplift, then applies the decision table. Same inputs, same plan, byte for byte.", stat: "Deterministic" },
  { title: "Reasoning", tag: "Gemini", comps: "6", body: "Gemini explains each SKU in plain language. It never sets a number. Any figure it writes that the engine didn't compute is thrown out.", stat: "Explains only" },
  { title: "Raghav approves", tag: "Human in the loop", comps: "7 · 8 · 9", body: "Raghav sees the plan with every flagged SKU called out, then does one thing: approve or reject. Nothing is ordered without that approval.", stat: "Expert wins" },
  { title: "PO", tag: "ERPNext", comps: "10", body: "The moment Raghav approves, one purchase order per supplier is created in ERPNext. PDF and Excel copies stay available for procurement.", stat: "Straight to ERPNext" },
];

export function ScrollStory() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [i, setI] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setI(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length)))));

  if (reduce) {
    return (
      <ol className="mx-auto grid max-w-6xl gap-4 px-4 py-20 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {STEPS.map((s, k) => <StepCard key={s.title} step={s} index={k} />)}
      </ol>
    );
  }
  const s = STEPS[i];
  return (
    <div ref={ref} style={{ height: `${STEPS.length * 80}vh` }} className="relative">
      <div className="sticky top-11 flex h-[calc(100dvh-44px)] flex-col justify-center overflow-hidden">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mb-8 flex flex-wrap gap-2" aria-hidden>
            {STEPS.map((st, k) => (
              <span key={st.title} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors duration-300 ${k === i ? "bg-white text-ink" : k < i ? "bg-white/20 text-white" : "bg-white/5 text-white/50"}`}>
                {st.title}
              </span>
            ))}
          </div>
          <div className="relative min-h-[340px]">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={s.title} initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -40 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }} className="absolute inset-0">
                <p className="eyebrow text-white/60">Step {i + 1} of {STEPS.length} · Components {s.comps} · {s.tag}</p>
                <h3 className="headline mt-3 text-white">{s.title}.</h3>
                <div className="mt-6 grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-end">
                  <p className="max-w-xl text-xl leading-relaxed text-white/80 md:text-2xl">{s.body}</p>
                  <p className="text-2xl font-semibold text-white md:text-right md:text-3xl">{s.stat}</p>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-10 h-[3px] w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
            <motion.div className="h-full origin-left bg-white" style={{ scaleX: scrollYProgress }} />
          </div>
        </div>
      </div>
      <ol className="sr-only">{STEPS.map((st) => <li key={st.title}>{st.title}: {st.body}</li>)}</ol>
    </div>
  );
}

function StepCard({ step, index }: { step: (typeof STEPS)[number]; index: number }) {
  return (
    <li className="rounded-[22px] border border-white/10 bg-[#2a2a2c] p-6 text-white">
      <p className="eyebrow text-white/60">Step {index + 1} · {step.tag}</p>
      <h3 className="mt-2 text-3xl font-semibold">{step.title}</h3>
      <p className="mt-3 text-white/80">{step.body}</p>
    </li>
  );
}
