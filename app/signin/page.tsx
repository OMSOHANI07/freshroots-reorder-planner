"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useRole } from "@/components/Providers";
import { Container } from "@/components/ui";
import type { Role } from "@/lib/api";

const ROLES: { role: Role; name: string; title: string; can: string[] }[] = [
  { role: "analyst", name: "Analyst", title: "Data and runs", can: ["Run the plan on the latest SAP data", "Or upload new SAP files", "Add judgment-zone overrides", "Retry a failed Zoho sync"] },
  { role: "raghav", name: "Raghav Kulkarni", title: "Demand Planner", can: ["Review the plan", "Approve or reject it", "Approval creates the POs in Zoho"] },
  { role: "procurement", name: "Procurement", title: "Purchasing team", can: ["View the approved plan", "Track POs in Zoho", "Download PO files", "Can't edit decisions or rules"] },
];

export default function SignIn() {
  const { setRole } = useRole();
  const router = useRouter();
  return (
    <Container className="py-20 sm:py-28">
      <h1 className="section-title text-center">Who&apos;s planning today?</h1>
      <p className="mt-4 text-center text-lg text-muted">Local demo sign-in. The API still checks your role on every action.</p>
      <div className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-3">
        {ROLES.map((r) => (
          <motion.button key={r.role} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => { setRole(r.role); router.push(r.role === "analyst" ? "/runs/new" : "/runs"); }}
            className="rounded-[24px] border border-hairline bg-tile p-8 text-left">
            <p className="eyebrow text-muted">{r.title}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{r.name}</p>
            <ul className="mt-5 space-y-1.5 text-sm text-muted">{r.can.map((c) => <li key={c}>{c}</li>)}</ul>
            <span className="mt-6 inline-block text-accent">Continue as {r.role === "raghav" ? "Raghav" : r.name} →</span>
          </motion.button>
        ))}
      </div>
    </Container>
  );
}
