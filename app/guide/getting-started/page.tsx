import type { Metadata } from "next";
import { GettingStartedGuide } from "@/features/guide/components/getting-started-guide";

export const metadata: Metadata = {
  title: "Getting started — Asas POS",
  description: "Choose the right first-day setup path for your shop in Asas POS.",
};

export default function GettingStartedPage() {
  return <GettingStartedGuide />;
}
