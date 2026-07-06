"use client";

import React from "react";
import { LandingReveal } from "./landing-reveal";

export function DemoVideo() {
  const videoSrc = publicAssetPath("/demo.mp4");

  return (
    <LandingReveal revealType="3d" className="mx-auto w-full max-w-4xl px-4 mt-8 md:mt-12">
      {/* Browser Window Wrapper */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        
        {/* Video Area */}
        <div className="relative aspect-video w-full bg-zinc-950">
          <video
            src={videoSrc}
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

function publicAssetPath(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const basePath = (process.env.NEXT_PUBLIC_SITE_BASE_PATH ?? "").replace(/\/+$/, "");
  return `${basePath}${normalizedPath}`;
}
