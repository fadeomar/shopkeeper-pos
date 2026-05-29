import { PublicGuide } from "@/features/guide/components/public-guide";

// The public, logged-out guide. AuthenticatedShell's public allowlist renders
// this inside PublicShell (no auth, no DB, no sync) for /guide.
export default function GuidePage() {
  return <PublicGuide />;
}
