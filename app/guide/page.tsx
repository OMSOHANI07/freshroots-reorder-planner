"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { Container, Reveal, StatusChip } from "@/components/ui";
import type { Status } from "@/lib/types";

type Lane = "analyst" | "planner" | "raghav" | "procurement";
const LANE: Record<Lane, { label: string; dot: string; chip: string }> = {
  analyst: { label: "Analyst", dot: "bg-accent", chip: "bg-accent/10 text-[#0058b0]" },
  planner: { label: "Planner (automatic)", dot: "bg-grey", chip: "bg-grey-soft text-grey" },
  raghav: { label: "Raghav", dot: "bg-ink", chip: "bg-ink text-white" },
  procurement: { label: "Procurement · ERPNext", dot: "bg-green", chip: "bg-green-soft text-green" },
};

interface Step { lane: Lane; title: string; body: string; decision?: { question: string; no: string } }
const FLOW: Step[] = [
  { lane: "analyst", title: "Choose the data", body: "Latest SAP data already in the system, or upload the five SAP files." },
  { lane: "planner", title: "Check the data", body: "12 checks: files complete, SKUs match, quantities valid, stock data recent.",
    decision: { question: "All checks pass?", no: "No plan is made. The screen says what's wrong; fix the files and run again." } },
  { lane: "planner", title: "Work out the plan", body: "For each SKU: weeks of stock cover, sales trend and festival uplift, then reorder, pause or hold steady." },
  { lane: "planner", title: "Explain it", body: "Gemini writes a plain-language reason for each SKU. It never changes a number." },
  { lane: "raghav", title: "Review the plan", body: "Headline numbers, the flagged SKUs called out, every SKU one tap away.",
    decision: { question: "Approve?", no: "Rejected with a note. Nothing is ordered. The Analyst runs a new plan." } },
  { lane: "planner", title: "Raise purchase orders", body: "One PO per supplier, with the approved quantities. Paused and healthy SKUs are left out." },
  { lane: "procurement", title: "Orders go out", body: "POs are created in ERPNext as Drafts. Procurement adds rates and submits each one from the planner, with no ERPNext sign-in." },
];

const ROLES: { key: Lane; name: string; steps: string[] }[] = [
  { key: "analyst", name: "Analyst", steps: [
    "Sign in and choose Analyst.",
    "Open New run. Pick Latest SAP data, or Upload new files and drop the five CSVs exported from SAP.",
    "Press Run the plan. Watch the 12 checks tick through.",
    "If a check fails, read the message, fix the file and run again. If the stock data is older than 7 days, set the run date under More options.",
    "When the plan opens, you're done: it shows up on Raghav's Home screen as waiting for a decision.",
    "Optional: under More options, send a SKU to Raghav for a reason the data can't show (for example, a competitor promotion).",
  ] },
  { key: "raghav", name: "Raghav", steps: [
    "Sign in and choose Raghav. Home shows the plan waiting for you.",
    "Press Review the plan. Read the three headline numbers and the flagged SKUs.",
    "Tap any SKU for its 16-week sales, stock cover before and after, and the reason.",
    "Press Approve plan, add an optional note and confirm. Purchase orders are raised straight away.",
    "Or press Reject plan, say why, and confirm. Nothing is ordered.",
  ] },
  { key: "procurement", name: "Procurement", steps: [
    "Sign in and choose Procurement. Home opens the latest approved plan.",
    "Each supplier has one purchase order tile. It's already a Draft in ERPNext; you never need to sign in to ERPNext.",
    "Press Complete order, type the rate for each SKU and pick the Required By date. The order value adds up as you type.",
    "Press Review, then Submit to ERPNext. The tile turns green: submitted.",
    "If a tile says the ERPNext sync failed, press Retry ERPNext after fixing the reason shown.",
    "Use Download for a PDF, Excel or CSV of one PO (rates included once entered), or All as ZIP for everything.",
  ] },
];

const STATUSES: { s: Status; text: string }[] = [
  { s: "STOCKOUT_RISK", text: "Stock lasts less than the minimum weeks. Reorder now: the standard quantity, or 1.5× if sales are rising fast." },
  { s: "OVERSTOCK_RISK", text: "Stock lasts more than the maximum weeks. Pause the next order." },
  { s: "HEALTHY", text: "Stock cover is inside the window. No order now; if sales are rising, the next order is 1.5×." },
  { s: "JUDGMENT_ZONE", text: "The rules can't decide (new product, no sales, or an override). Nothing is ordered automatically." },
];

const FLAGS: [string, string][] = [
  ["R1", "Even after the order, stock stays below the minimum."],
  ["R2", "Within half a week of a limit: a close call."],
  ["R3", "Sales spiked in a festival month; the uplift may count twice."],
  ["R4", "The order pushes stock above the maximum."],
  ["J1", "New product, or less than 12 weeks of sales."],
  ["J2", "Sent to Raghav by hand, with a reason."],
  ["J3", "No sales in 12 weeks, so cover can't be worked out."],
];

const FAQ: [string, string][] = [
  ["Who decides how much to order?", "The rules engine, using Raghav's thresholds in config.yaml. Raghav approves or rejects the whole plan. AI only explains."],
  ["Why are there no prices on the POs?", "The SAP files have no unit costs, and the planner never guesses. Procurement types the rates on each PO before submitting."],
  ["What are the cover windows?", "Long-life SKUs: 6 to 14 weeks of stock. Perishable SKUs: 3 to 4 weeks."],
  ["When is a month a festival month?", "Only when festival_calendar marks it. Today: March, October and November. Expected demand goes up 25%."],
  ["Can anyone change a rule or threshold?", "Only Raghav, with sign-off from Deepa Nair (Head of Operations). Procurement can't."],
  ["What happens if ERPNext is down?", "The plan is still approved and the POs are kept. Each PO shows why it didn't reach ERPNext and can be retried."],
];

export default function Guide() {
  const [role, setRole] = useState<Lane>("analyst");
  const current = ROLES.find((r) => r.key === role)!;
  return (
    <>
      <section className="bg-paper pb-10 pt-16 text-center sm:pt-24">
        <Container>
          <Reveal>
            <p className="eyebrow text-green">Guide</p>
            <h1 className="headline mx-auto mt-3 max-w-3xl">How it works.</h1>
            <p className="mx-auto mt-5 max-w-2xl text-xl text-muted">Three people, seven steps, one approval.</p>
          </Reveal>
          <Reveal delay={0.1}>
            <ul className="mt-8 flex flex-wrap justify-center gap-2 text-sm" aria-label="Legend">
              {(Object.keys(LANE) as Lane[]).map((l) => (
                <li key={l} className={`rounded-full px-3 py-1 font-medium ${LANE[l].chip}`}>{LANE[l].label}</li>
              ))}
            </ul>
          </Reveal>
        </Container>
      </section>

      <section aria-labelledby="flow-title" className="bg-paper pb-24">
        <Container className="max-w-3xl">
          <h2 id="flow-title" className="sr-only">Flow chart</h2>
          <ol className="relative">
            {FLOW.map((st, i) => (
              <motion.li key={st.title} className="relative pb-6 pl-14 last:pb-0" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0 }}>
                {i < FLOW.length - 1 && (
                  <motion.span aria-hidden className="absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-0.5 origin-top bg-hairline"
                    variants={{ hidden: { scaleY: 0 }, show: { scaleY: 1, transition: { duration: 0.6, delay: 0.2 } } }} />
                )}
                <motion.span aria-hidden variants={{ hidden: { scale: 0 }, show: { scale: 1, transition: { type: "spring", stiffness: 400, damping: 20 } } }}
                  className={`absolute left-0 top-0 grid h-10 w-10 place-items-center rounded-full text-sm font-semibold text-white ${LANE[st.lane].dot}`}>{i + 1}</motion.span>
                <Reveal>
                  <div className="rounded-[22px] border border-hairline/70 bg-tile p-5 sm:p-6">
                    <p className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${LANE[st.lane].chip}`}>{LANE[st.lane].label}</p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{st.title}</h3>
                    <p className="mt-1 text-muted">{st.body}</p>
                  </div>
                  {st.decision && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="flex items-center gap-3 rounded-[18px] bg-green-soft px-4 py-3 text-sm text-green">
                        <span aria-hidden className="grid h-7 w-7 shrink-0 rotate-45 place-items-center rounded-md bg-green"><span className="-rotate-45 text-xs font-bold text-white">?</span></span>
                        <span><b>{st.decision.question}</b> Yes → next step</span>
                      </div>
                      <div className="rounded-[18px] bg-amber-soft px-4 py-3 text-sm text-amber"><b>No →</b> {st.decision.no}</div>
                    </div>
                  )}
                </Reveal>
              </motion.li>
            ))}
          </ol>
        </Container>
      </section>

      <section aria-labelledby="manual-title" className="bg-ink py-24 text-white">
        <Container className="max-w-3xl">
          <Reveal>
            <p className="eyebrow text-white/60">User manual</p>
            <h2 id="manual-title" className="section-title mt-2">What you do.</h2>
          </Reveal>
          <div role="tablist" aria-label="Role" className="mt-8 inline-flex rounded-full bg-white/10 p-1">
            {ROLES.map((r) => (
              <button key={r.key} role="tab" aria-selected={role === r.key} onClick={() => setRole(r.key)}
                className={`relative rounded-full px-4 py-2 text-sm font-medium sm:px-5 ${role === r.key ? "text-ink" : "text-white/70 hover:text-white"}`}>
                {role === r.key && <motion.span layoutId="role-tab" className="absolute inset-0 rounded-full bg-white" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
                <span className="relative">{r.name}</span>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={role} role="tabpanel" aria-label={`${current.name} steps`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}>
            <ol className="mt-8 space-y-3">
              {current.steps.map((t, i) => (
                <li key={i} className="flex gap-4 rounded-[20px] bg-white/5 p-5">
                  <span className="tabular text-2xl font-semibold text-white/60">{i + 1}</span>
                  <span className="text-[17px] leading-relaxed text-white/90">{t}</span>
                </li>
              ))}
            </ol>
            </motion.div>
          </AnimatePresence>
        </Container>
      </section>

      <section aria-labelledby="meaning-title" className="bg-paper py-24">
        <Container className="max-w-3xl space-y-14">
          <Reveal>
            <h2 id="meaning-title" className="section-title">What the colours mean.</h2>
            <ul className="mt-8 space-y-3">
              {STATUSES.map((x) => (
                <li key={x.s} className="grid gap-2 rounded-[20px] border border-hairline/70 bg-tile p-5 sm:grid-cols-[160px_1fr] sm:items-center">
                  <StatusChip status={x.s} /><span className="text-muted">{x.text}</span>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal>
            <h2 className="section-title">What the flags mean.</h2>
            <p className="mt-3 text-lg text-muted">A flag never changes a quantity. It asks for a closer look.</p>
            <dl className="mt-8 grid gap-3 sm:grid-cols-2">
              {FLAGS.map(([c, t]) => (
                <div key={c} className="flex gap-4 rounded-[20px] border border-hairline/70 bg-tile p-5">
                  <dt className="font-mono text-lg font-semibold">{c}</dt><dd className="text-muted">{t}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal>
            <h2 className="section-title">Questions.</h2>
            <div className="mt-8 divide-y divide-hairline/70 rounded-[20px] border border-hairline/70 bg-tile">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-medium">
                    {q}<span aria-hidden className="text-2xl font-light text-muted transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-2 text-muted">{a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
