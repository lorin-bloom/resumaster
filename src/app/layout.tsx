import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Resumaster",
  description: "AI resume and job application strategist",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publicDemo = process.env.RESUMASTER_PUBLIC_DEMO === "1";
  return (
    <html lang="en">
      <body className="antialiased">
        <Nav publicDemo={publicDemo} />
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
