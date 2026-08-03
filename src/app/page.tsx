"use client";

import { Button } from "@/components/ui";
import { ArrowRightIcon, BookOpenIcon } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--color-text-primary)]">
      <main className="container-max flex flex-col items-center justify-center min-h-screen gap-48 py-48 text-center">
        <div className="flex flex-col items-center gap-24 max-w-4xl">
           <span className="title-chapter-title text-[var(--clr-purple)]">Maji Noema</span>
           <h1 className="title-heading-1">
             Build with purpose.
           </h1>
           <p className="body-lead max-w-2xl text-[var(--color-text-secondary)]">
             Track biochar production, custody, application, and certification
             in one place.
           </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-16">
          <Button
            variant="primary"
            size="default"
            onClick={() => router.push("/login")}
          >
             Get Started
             <ArrowRightIcon size={20} weight="bold" />
          </Button>
          <Button
            variant="weak"
            size="default"
            onClick={() => window.open("https://github.com/anthropics/claude-code", "_blank")}
          >
             Documentation
             <BookOpenIcon size={20} weight="bold" />
          </Button>
        </div>
      </main>
    </div>
  );
}
