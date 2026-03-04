/**
 * Samples Page
 * Lab sample tracking linked to production runs
 * Route: /samples
 */

import { SampleList } from "@/components/samples";

export const metadata = {
  title: "Lab Samples | NOMA dMRV",
  description: "Lab sample tracking for biochar quality analysis linked to production runs",
};

export default function SamplesPage() {
  return <SampleList />;
}
