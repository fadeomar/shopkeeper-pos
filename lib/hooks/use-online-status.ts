import { useEffect, useState } from "react";

/**
 * Reactive `navigator.onLine`. SSR-safe: assumes online until mounted, then
 * tracks the browser online/offline events. Use it to make online-only
 * affordances (e.g. navigating to a not-yet-cached dynamic route) degrade
 * gracefully while offline.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
