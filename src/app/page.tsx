"use client";

import { Button } from "@/components/ui";
import { ArrowRight, BookOpen } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[var(--color-background-light)] text-[var(--color-text-primary)]">
      <main className="container-max flex flex-col items-center justify-center min-h-screen gap-xl py-xl text-center">
        <div className="flex flex-col items-center gap-m max-w-4xl">
           <span className="title-chapter-title text-[var(--clr-purple)]">Maji Noema</span>
           <h1 className="title-heading-1">
             Build with purpose.
           </h1>
           <p className="body-lead max-w-2xl text-[var(--color-text-secondary)]">
             Production-ready template with authentication, database, and a brutalist design system.
           </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-s">
          <Button
            variant="primary"
            size="default"
            onClick={() => router.push("/login")}
          >
             Get Started
             <ArrowRight size={20} weight="bold" />
          </Button>
          <Button
            variant="weak"
            size="default"
            onClick={() => window.open("https://github.com/anthropics/claude-code", "_blank")}
          >
             Documentation
             <BookOpen size={20} weight="bold" />
          </Button>
        </div>
      </main>
    </div>
  );
}
