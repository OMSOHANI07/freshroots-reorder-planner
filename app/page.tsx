"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useRole } from "@/components/Providers";
import { ScrollStory } from "@/components/ScrollStory";
import { Container, CountUp, PillLink, Reveal, Tile } from "@/components/ui";
import { api } from "@/lib/api";
import type { RunBrief } from "@/lib/types";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] as const, delay: 0.1 + i * 0.12 } }),
};

export default function Home() {
  const { role, ready } = useRole();
  const [latest, setLatest] = useState<RunBrief | null | undefined>(undefined);
  useEffect(() => {
    if (!role) return;
    api<RunBrief | null>("/runs/latest").then(setLatest).catch(() => setLatest(null));
  }, [role]);
  const s = latest?.summary;
  const runHref = latest ? (latest.status === "final" ? `/runs/${latest.id}/final` : `/runs/${latest.id}`) : "/runs/new";

  return (
    <>
      <section className="overflow-hidden bg-paper pb-20 pt-20 text-center sm:pt-28">
        <Container>
          <motion.p variants={fadeUp} initial="hidden" animate="show" custom={0} className="eyebrow text-green">
            Freshroots Reorder Planner
          </motion.p>
          <motion.h1 variants={fadeUp} initial="hidden" animate="show" custom={1} className="headline mx-auto mt-3 max-w-4xl">
            Reorder, rethought.
          </motion.h1>
          <motion.p variants={fadeUp} initial="hidden" animate="show" custom={2} className="mx-auto mt-5 max-w-2xl text-xl text-muted sm:text-2xl">
            Weekly sales and stock in. A reorder plan Raghav trusts out. POs ready for Zoho.
          </motion.p>
          <motion.div variants={fadeUp} initial="hidden" animate="show" custom={3} className="mt-8 flex flex-wrap justify-center gap-3">
            {ready && !role && <PillLink href="/signin">Sign in</PillLink>}
            {role === "raghav" && <PillLink href="/runs/new">Start a run</PillLink>}
            {role && latest && <PillLink href={runHref} variant="secondary">Open latest plan</PillLink>}
          </motion.div>

          <motion.div variants={fadeUp} initial="hidden" animate="show" custom={4} className="mx-auto mt-16 grid max-w-4xl gap-4 sm:grid-cols-3">
            {s ? (
              <>
                <Stat label="SKUs to reorder now" value={s.reorder_now} />
                <Stat label="Units to order" value={s.total_units_now} />
                <Stat label="SKUs flagged for Raghav" value={s.needs_review} />
              </>
            ) : (
              <p className="col-span-full text-muted">
                {role ? (latest === null ? "No runs yet. Upload this week's files to see the headline numbers." : "Loading the latest run…") : "Sign in to see the latest run's numbers."}
              </p>
            )}
          </motion.div>
          {s && latest && (
            <p className="mt-4 text-sm text-muted">
              Run #{latest.id} · Order month {s.order_month}{s.is_festival ? " (festival)" : ""} · Inventory as of {s.as_of_date} ·{" "}
              {latest.status === "final" ? "Approved by Raghav" : "Awaiting Raghav's approval"}
            </p>
          )}
        </Container>
      </section>

      <section className="bg-ink pt-20 text-white" aria-labelledby="flow-title">
        <Container>
          <Reveal>
            <p className="eyebrow text-white/60">How it works</p>
            <h2 id="flow-title" className="section-title mt-2 max-w-3xl">Ten components. Six steps. One person decides.</h2>
          </Reveal>
        </Container>
        <ScrollStory />
      </section>

      <section className="bg-paper py-24">
        <Container className="grid gap-4 md:grid-cols-2">
          <Reveal>
            <Tile className="flex h-full flex-col justify-between bg-tile-alt p-8 sm:p-10">
              <div>
                <p className="eyebrow text-muted">The principle</p>
                <h2 className="section-title mt-2">AI vs Expert → Expert wins.</h2>
              </div>
              <p className="mt-6 text-lg text-muted">
                The engine recommends and Gemini explains. Raghav&apos;s decision is the final value on every screen and every PO, with the engine&apos;s number beside it for reference.
              </p>
            </Tile>
          </Reveal>
          <Reveal delay={0.1}>
            <Tile dark className="flex h-full flex-col justify-between p-8 sm:p-10">
              <div>
                <p className="eyebrow text-white/60">Guardrails</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">No invented numbers.</h2>
              </div>
              <ul className="mt-6 space-y-2 text-white/80">
                <li>Every threshold comes from config.yaml.</li>
                <li>No prices, lead times or stock on order are guessed.</li>
                <li>No PO exists until Raghav finalises.</li>
                <li>Nothing is sent to Zoho automatically.</li>
              </ul>
            </Tile>
          </Reveal>
        </Container>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[22px] border border-hairline/70 bg-tile p-6">
      <CountUp value={value} className="block text-5xl font-semibold tracking-tight sm:text-6xl" />
      <p className="mt-2 text-sm text-muted">{label}</p>
    </div>
  );
}
