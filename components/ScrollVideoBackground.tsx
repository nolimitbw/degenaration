"use client";
import { useEffect, useRef } from "react";

const LERP = 0.15; // current += (target - current) * LERP, each animation frame
const WRITE_EPSILON = 0.008; // skip redundant currentTime writes smaller than this
const IDLE_EPSILON = 0.001; // below this, stop scheduling rAF entirely until the next scroll/resize

/**
 * Fixed full-page video background whose playhead is scrubbed by scroll
 * position: target time = scrollProgress * duration, eased toward with a
 * simple lerp each rAF tick so seeking never jitters. Scrolling up rewinds
 * for free since target just decreases with scrollProgress.
 *
 * Cropped/zoomed via CSS (object-position + scale) to push the source clip's
 * top-right watermark out of the visible frame on every viewport size — see
 * the comment above .launch-video in globals.css for the measured margin.
 */
export default function ScrollVideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // never assign a src -> only the <video poster> paints, zero video bytes fetched

    let duration = 0;
    let maxScroll = 1;
    let current = 0;
    let target = 0;
    let raf = 0;
    let looping = false;
    let ready = false;

    const recomputeMaxScroll = () => {
      maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    };

    const wake = () => {
      if (!looping) { looping = true; raf = requestAnimationFrame(tick); }
    };

    const onScroll = () => {
      const progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      target = progress * duration;
      wake();
    };

    const onResize = () => {
      recomputeMaxScroll();
      onScroll();
    };

    const tick = () => {
      current += (target - current) * LERP;
      const delta = target - current;
      // video.seeking guard: never queue a new seek while the browser is still
      // resolving the last one — on a slow connection a fresh currentTime write
      // can abort/supersede an in-flight fetch, which is what actually causes a
      // scroll-scrubbed video to look "stuck" while the user keeps scrolling.
      if (ready && !video.seeking && Math.abs(video.currentTime - current) > WRITE_EPSILON) {
        video.currentTime = current;
      }
      if (Math.abs(delta) < IDLE_EPSILON) {
        looping = false; // settled — stop waking every frame until onScroll/onResize calls wake() again
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const armPlayback = () => {
      if (!isFinite(video.duration) || video.duration <= 0) return; // wait for 'durationchange' to retry
      duration = video.duration;
      recomputeMaxScroll();
      onScroll();
      // iOS/Safari won't paint a seeked frame until the video has actually played;
      // ready only flips once that warmup genuinely resolves (or definitively
      // fails), never optimistically before the play() promise settles.
      video.play().then(() => { video.pause(); ready = true; }).catch(() => { ready = true; });
    };

    video.addEventListener("loadedmetadata", armPlayback);
    video.addEventListener("durationchange", armPlayback);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    // page height can change after the video's own metadata is ready (async data
    // fetches further down the page, e.g. Groups' Supabase round-trip) — without
    // this, maxScroll goes stale and the scrub reaches the end before the user
    // reaches the true bottom of the page.
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(document.documentElement);

    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); looping = false; }
      else wake();
    };
    document.addEventListener("visibilitychange", onVisibility);

    video.src = "/video/launch-source.mp4";
    video.preload = "auto";
    video.load();

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("loadedmetadata", armPlayback);
      video.removeEventListener("durationchange", armPlayback);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="launch-video-wrap">
      <video
        ref={videoRef}
        className="launch-video"
        poster="/video/launch-poster.png"
        muted
        playsInline
        preload="none"
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className="launch-video-scrim" />
    </div>
  );
}
