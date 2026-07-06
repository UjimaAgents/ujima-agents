"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

export function LandingReveal<T extends ElementType = "div">({
  children,
  className = "",
  delay = 0,
  as,
  revealType = "fade-up",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: T;
  revealType?: "fade-up" | "3d";
}) {
  const Tag = (as ?? "div") as ElementType;
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const revealClass = revealType === "3d"
    ? `landing-reveal-3d ${visible ? "landing-reveal-3d--visible" : ""}`
    : `landing-reveal ${visible ? "landing-reveal--visible" : ""}`;

  return (
    <Tag
      ref={ref}
      className={`${revealClass} ${className}`}
      style={{ "--landing-reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
