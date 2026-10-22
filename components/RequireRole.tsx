"use client";

import { useRole } from "./Providers";
import { Container, PillLink } from "./ui";
import type { Role } from "@/lib/api";

export function RequireRole({ children, roles }: { children: React.ReactNode; roles?: Role[] }) {
  const { role, ready } = useRole();
  if (!ready) return null;
  if (!role) {
    return (
      <Container className="py-24 text-center">
        <h1 className="section-title">Sign in to continue.</h1>
        <p className="mt-4 text-lg text-muted">Choose Raghav or Procurement to see the plan.</p>
        <PillLink href="/signin" className="mt-8">Sign in</PillLink>
      </Container>
    );
  }
  if (roles && !roles.includes(role)) {
    return (
      <Container className="py-24 text-center">
        <h1 className="section-title">Not for this role.</h1>
        <p className="mt-4 text-lg text-muted">The Analyst runs plans, Raghav approves or rejects them, and Procurement tracks the POs.</p>
        <PillLink href="/runs" className="mt-8" variant="secondary">See plans</PillLink>
      </Container>
    );
  }
  return <>{children}</>;
}
