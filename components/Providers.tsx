"use client";

import { MotionConfig } from "framer-motion";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ROLE_KEY, getRole, type Role } from "@/lib/api";

interface RoleCtx {
  role: Role | null;
  ready: boolean;
  setRole: (r: Role | null) => void;
}

const Ctx = createContext<RoleCtx>({ role: null, ready: false, setRole: () => {} });
export const useRole = () => useContext(Ctx);

export function Providers({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setRoleState(getRole());
    setReady(true);
  }, []);
  const setRole = useCallback((r: Role | null) => {
    try {
      if (r) localStorage.setItem(ROLE_KEY, r);
      else localStorage.removeItem(ROLE_KEY);
    } catch {
      /* storage unavailable: role lives for this tab only */
    }
    setRoleState(r);
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <Ctx.Provider value={{ role, ready, setRole }}>{children}</Ctx.Provider>
    </MotionConfig>
  );
}
