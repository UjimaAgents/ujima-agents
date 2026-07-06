"use client";

import React from "react";
import { LandingReveal } from "./landing-reveal";

export function DemoVideo() {
  return (
    <LandingReveal revealType="3d" className="mx-auto w-full max-w-4xl px-4 mt-8 md:mt-12">
      {/* Browser Window Wrapper */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        
        {/* Video Area */}
        <div className="relative aspect-video w-full bg-zinc-950">
          <video
            src="/demo.mp4"
            className="h-full w-full object-cover"
            controls
            autoPlay
            muted
            loop
            playsInline
          />
        </div>

      </div>
    </LandingReveal>
  );
}
