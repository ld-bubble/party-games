"use client";

import { useEffect } from "react";
import { initPostHog } from "@/lib/analytics";

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPostHog();
  }, []);
  return <>{children}</>;
}
