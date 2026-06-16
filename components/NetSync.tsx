"use client";

// Owns the multiplayer socket lifecycle. Renders nothing. Mounted at page level (outside the
// Canvas) so the connection survives R3F remounts. Sends the stored display name on connect.

import { useEffect } from "react";
import { connect, disconnect, setName } from "@/lib/net";

export function NetSync() {
  useEffect(() => {
    connect();
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("hoe-name") : null;
    if (stored) setName(stored);
    return () => disconnect();
  }, []);
  return null;
}
