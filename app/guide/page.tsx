import type { Metadata } from "next";
import { PublicGuide } from "@/features/guide/components/public-guide";

export const metadata: Metadata = {
  title: "Guide — Shopkeeper POS",
  description:
    "Learn what Shopkeeper POS can do, how offline mode works, how to install it as an app, and how to request access.",
};

// The public, logged-out guide. AuthenticatedShell's public allowlist renders
// this inside PublicShell (no auth, no DB, no sync) for /guide.
export default function GuidePage() {
  return <PublicGuide />;
}
