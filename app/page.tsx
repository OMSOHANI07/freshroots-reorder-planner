"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useRole } from "@/components/Providers";
import { ScrollStory } from "@/components/ScrollStory";
import { Container, CountUp, PillLink, Reveal, Tile } from "@/components/ui";
import { api } from "@/lib/api";
import { runHref } from "@/lib/format";
import type { RunBrief } from "@/lib/types";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const, delay: 0.1 + i * 0.12 } }),
};

interface NextStep { eyebrow: string; title: string; body: string; href: string; cta: string }

function nextStep(role: string, runs: RunBrief[]): NextStep {
  const waiting = runs.find((r) => r.status === "draft");
  const approved = runs.find((r) => r.status === "final");
  if (role === "analyst") {
    return waiting
      ? { eyebrow: "Plan ready", title: `Plan #${waiting.id} is with Raghav.`, body: "You can run a fresh plan any time; Raghav decides which one goes out.", href: "/runs/new", cta: "Run a new plan" }
      : { eyebrow: "Your next step", title: "Run this week's plan.", body: "Use the latest SAP data, or upload new files. It takes a few seconds.", href: "/runs/new", cta: "Run the plan" };
  }
  if (role === "raghav") {
    return waiting
      ? { eyebrow: "Waiting for you", title: `Plan #${waiting.id} needs your decision.`, body: `${waiting.summary?.reorder_now ?? 0} SKUs to reorder, ${(waiting.summary?.total_units_now ?? 0).toLocaleString("en-IN")} units. Approve or reject.`, href: `/runs/${waiting.id}`, cta: "Review the plan" }
      : { eyebrow: "All clear", title: "Nothing to approve.", body: "You'll see the next plan here as soon as the Analyst runs it.", href: "/runs", cta: "See past plans" };
  }
  return approved
    ? { eyebrow: "Latest orders", title: `Plan #${approved.id} is approved.`, body: "Check each supplier's purchase order and download copies.", href: runHref(approved), cta: "Open purchase orders" }
    : { eyebrow: "No orders yet", title: "Nothing approved yet.", body: "Purchase orders appear here once Raghav approves a plan.", href: "/runs", cta: "See plans" };
}

export default function Home() {
  const { role, ready } = useRole();
  const [runs, setRuns] = useState<RunBrief[] | null>(null);
  useEffect(() => {
    if (!role) return;
    api<RunBrief[]>("/runs").then(setRuns).catch(() => setRuns([]));
  }, [role]);
  const latest = runs?.find((r) => r.status !== "failed");
  const s = latest?.summary;
  const step = role && runs ? nextStep(role, runs) : null;

  return (
    <>
      <section className="overflow-hidden bg-paper pb-16 pt-16 text-center sm:pt-24">
        <Container>
          <motion.p variants={fadeUp} initial="hidden" animate="show" custom={0} className="eyebrow text-green">Freshroots Reorder Planner</motion.p>
          <motion.h1 variants={fadeUp} initial="hidden" animate="show" custom={1} className="headline mx-auto mt-3 max-w-4xl">
            Reorder, <span className="bg-gradient-to-r from-green via-accent to-green bg-[length:200%_auto] bg-clip-text text-transparent motion-safe:animate-[shine_6s_linear_infinite]">rethought.</span>
          </motion.h1>
          <motion.p variants={fadeUp} initial="hidden" animate="show" custom={2} className="mx-auto mt-5 max-w-2xl text-xl text-muted sm:text-2xl">
            SAP numbers in. One approval. Purchase orders out.
          </motion.p>
          {ready && !role && (
            <motion.div variants={fadeUp} initial="hidden" animate="show" custom={3} className="mt-8 flex justify-center gap-3">
              <PillLink href="/signin">Sign in</PillLink>
              <PillLink href="/guide" variant="secondary">How it works</PillLink>
            </motion.div>
          )}
        </Container>

        {step && (
          <Container className="mt-12">
            <motion.div variants={fadeUp} initial="hidden" animate="show" custom={3}
              className="mx-auto max-w-3xl rounded-[28px] bg-ink p-8 text-left text-white sm:p-10">
              <p className="eyebrow text-white/60">{step.eyebrow}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">{step.title}</h2>
              <p className="mt-3 max-w-xl text-lg text-white/70">{step.body}</p>
              <PillLink href={step.href} className="mt-7 px-7 py-3 text-[17px]">{step.cta}</PillLink>
            </motion.div>
          </Container>
        )}

        {s && latest && (
          <Container className="mt-6">
            <motion.div variants={fadeUp} initial="hidden" animate="show" custom={4} className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-3">
              <Stat label="SKUs to reorder" value={s.reorder_now} />
              <Stat label="Units to order" value={s.total_units_now} />
              <Stat label="Flagged for a closer look" value={s.needs_review} />
            </motion.div>
            <p className="mt-3 text-sm text-muted">Latest plan #{latest.id} · {latest.status === "final" ? "approved" : latest.status === "rejected" ? "rejected" : "waiting for Raghav"}</p>
          </Container>
        )}
      </section>

      <section className="bg-ink pt-20 text-white" aria-labelledby="flow-title">
        <Container>
          <Reveal>
            <p className="eyebrow text-white/60">How it works</p>
            <h2 id="flow-title" className="section-title mt-2 max-w-3xl">Six steps. One approval.</h2>
          </Reveal>
        </Container>
        <ScrollStory />
      </section>

      <section className="bg-paper py-24">
        <Container className="grid gap-4 md:grid-cols-3">
          <Reveal>
            <Tile className="flex h-full flex-col bg-tile-alt p-8">
              <p className="eyebrow text-muted">Analyst</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight">Runs the plan.</h3>
              <p className="mt-3 text-muted">On the latest SAP data, or a fresh upload. Twice a week.</p>
            </Tile>
          </Reveal>
          <Reveal delay={0.08}>
            <Tile dark className="flex h-full flex-col p-8">
              <p className="eyebrow text-white/60">Raghav</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight">Approves or rejects.</h3>
              <p className="mt-3 text-white/70">One decision. Nothing is ordered without it.</p>
            </Tile>
          </Reveal>
          <Reveal delay={0.16}>
            <Tile className="flex h-full flex-col bg-tile-alt p-8">
              <p className="eyebrow text-muted">Procurement</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight">Gets the orders.</h3>
              <p className="mt-3 text-muted">One purchase order per supplier, straight into ERPNext.</p>
            </Tile>
          </Reveal>
        </Container>
        <Container className="mt-10 text-center">
          <Reveal><PillLink href="/guide" variant="secondary">Read the guide</PillLink></Reveal>
        </Container>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[22px] border border-hairline/70 bg-tile p-6">
      <CountUp value={value} className="block text-5xl font-semibold tracking-tight" />
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}
