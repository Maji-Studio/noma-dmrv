import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Maji dMRV",
  description: "Biochar carbon credit MRV system",
};

// Mobile shell depends on the layout viewport matching the device width.
// Without this, mobile browsers assume a ~980px viewport and render the
// desktop layout zoomed out. `maximumScale` is intentionally left at the
// default (user-scalable) so operators can pinch-zoom dense data tables.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
