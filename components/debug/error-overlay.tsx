"use client";

import { useEffect, useState } from "react";

export function GlobalErrorOverlay() {
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    function onError(e: ErrorEvent) {
      setErrors((prev) => [...prev, `JS: ${e.message} (${e.filename}:${e.lineno})`]);
    }
    function onUnhandled(e: PromiseRejectionEvent) {
      setErrors((prev) => [...prev, `Promise: ${String(e.reason)}`]);
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  if (errors.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "#1e1b4b",
        color: "#fbbf24",
        padding: "12px",
        fontSize: "12px",
        zIndex: 99999,
        maxHeight: "40vh",
        overflowY: "auto",
      }}
    >
      <strong>Errors caught:</strong>
      {errors.map((e, i) => (
        <div key={i} style={{ marginTop: "4px", wordBreak: "break-all" }}>
          {e}
        </div>
      ))}
    </div>
  );
}
