"use client";

import { useEffect, useRef } from "react";

/**
 * The sky the whole site sits under.
 *
 * A canvas rather than CSS, for one reason: a field reads as a sky at a few
 * hundred stars and as decoration at a dozen, and a few hundred radial
 * gradients is a few hundred paint layers the compositor has to carry on every
 * scroll. One canvas is one layer, drawn at whatever rate the browser is
 * willing to give it.
 *
 * Three things keep it from becoming the noisy starfield every dark landing
 * page has:
 *
 *   - Depth. Stars are drawn in three layers that differ in size, brightness
 *     and drift speed, so the field has somewhere to be rather than being a
 *     flat sprinkle of dots.
 *   - Restraint. Most of the field sits under 0.4 alpha. Only the near layer
 *     is allowed to be bright, and only its largest get the little cross of
 *     light a lens puts on a real star. Text wins every contest with the
 *     background, which is the one rule a background has.
 *   - Rarity. A meteor crosses every twenty seconds or so, never on a timer the
 *     eye can learn. It is the one moment of motion big enough to notice, which
 *     is what makes noticing it feel like luck rather than like an animation.
 */

type Star = {
  x: number;
  y: number;
  /** Radius in CSS pixels. Sub-pixel on the far layer, which is the point. */
  r: number;
  /** Resting alpha, before the twinkle is applied. */
  alpha: number;
  /** Where in its twinkle cycle this star starts, so they never pulse together. */
  phase: number;
  /** Radians per second of twinkle. */
  rate: number;
  /** CSS pixels per second of drift, set by the layer. */
  drift: number;
  /** A minority are moonlight rather than white, which warms the field's edges. */
  tinted: boolean;
};

type Meteor = { x: number; y: number; vx: number; vy: number; life: number; span: number };

/**
 * One star per this many square pixels, then clamped so a 4K monitor stays
 * sane. A laptop viewport lands around 450 stars, which is the number where the
 * field stops reading as scattered dust and starts reading as a sky.
 */
const AREA_PER_STAR = 3100;
const MAX_STARS = 700;

/** Depth layers: [radius range, alpha range, drift px/s, share of the field]. */
const LAYERS = [
  { r: [0.4, 0.8], alpha: [0.18, 0.4], drift: 1.4, share: 0.56 },
  { r: [0.75, 1.25], alpha: [0.36, 0.64], drift: 2.6, share: 0.33 },
  { r: [1.15, 1.9], alpha: [0.6, 0.95], drift: 4.2, share: 0.11 },
] as const;

const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export const Starfield = () => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Someone who has asked for less motion still gets a sky — it just holds
    // still. Dropping the field entirely would take the page's whole mood away
    // to fix a problem they did not report.
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let stars: Star[] = [];
    let meteor: Meteor | null = null;
    let nextMeteor = 6 + Math.random() * 14;
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = performance.now();

    /**
     * Size the backing store to the device's pixels and re-seed.
     *
     * The field is regenerated on resize rather than rescaled, because stars
     * stretched across a rotated phone stop looking like points of light.
     */
    const seed = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const total = Math.min(MAX_STARS, Math.round((width * height) / AREA_PER_STAR));
      stars = [];
      for (const layer of LAYERS) {
        for (let i = 0; i < Math.round(total * layer.share); i++) {
          stars.push({
            x: Math.random() * width,
            y: Math.random() * height,
            r: between(layer.r[0], layer.r[1]),
            alpha: between(layer.alpha[0], layer.alpha[1]),
            phase: Math.random() * Math.PI * 2,
            rate: between(0.25, 0.9),
            drift: layer.drift,
            tinted: Math.random() < 0.18,
          });
        }
      }
    };

    const draw = (now: number) => {
      // Clamp the delta: a backgrounded tab returns with a delta of minutes,
      // which would teleport the whole field on the frame you come back to.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      ctx.clearRect(0, 0, width, height);

      for (const star of stars) {
        if (!calm) {
          // The sky turns. Down and very slightly to the left, so the motion is
          // felt at the edges of vision rather than read.
          star.y += star.drift * dt;
          star.x -= star.drift * 0.25 * dt;
          if (star.y - star.r > height) {
            star.y = -star.r;
            star.x = Math.random() * width;
          }
          if (star.x + star.r < 0) star.x = width + star.r;
          star.phase += star.rate * dt;
        }

        // Twinkle is multiplicative, so a dim star stays dim. Atmospheric
        // scintillation is what this is imitating and it never brightens a
        // star past itself.
        const twinkle = calm ? 1 : 0.72 + 0.28 * Math.sin(star.phase);
        const alpha = star.alpha * twinkle;

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = star.tinted ? `rgba(150, 165, 255, ${alpha})` : `rgba(226, 232, 248, ${alpha})`;
        ctx.fill();

        // Only the near layer's brightest get the little cross of light a lens
        // puts on a real one. Give it to everything and the field turns to lace.
        if (star.r > 1.5) {
          ctx.strokeStyle = `rgba(200, 212, 255, ${alpha * 0.32})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(star.x - star.r * 3, star.y);
          ctx.lineTo(star.x + star.r * 3, star.y);
          ctx.moveTo(star.x, star.y - star.r * 3);
          ctx.lineTo(star.x, star.y + star.r * 3);
          ctx.stroke();
        }
      }

      if (!calm) {
        nextMeteor -= dt;
        if (!meteor && nextMeteor <= 0) {
          const speed = between(380, 620);
          meteor = {
            x: between(width * 0.25, width * 1.05),
            y: between(-40, height * 0.35),
            vx: -speed * 0.82,
            vy: speed * 0.5,
            life: 1,
            span: between(90, 190),
          };
          nextMeteor = 14 + Math.random() * 18;
        }

        if (meteor) {
          meteor.x += meteor.vx * dt;
          meteor.y += meteor.vy * dt;
          meteor.life -= dt * 0.85;

          // The tail is the path just travelled, faded along its length.
          const hyp = Math.hypot(meteor.vx, meteor.vy);
          const tailX = meteor.x + (meteor.vx / hyp) * -meteor.span;
          const tailY = meteor.y + (meteor.vy / hyp) * -meteor.span;
          const head = Math.max(0, meteor.life);
          const trail = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
          trail.addColorStop(0, `rgba(233, 236, 246, ${0.85 * head})`);
          trail.addColorStop(0.4, `rgba(124, 140, 255, ${0.35 * head})`);
          trail.addColorStop(1, "rgba(124, 140, 255, 0)");
          ctx.strokeStyle = trail;
          ctx.lineWidth = 1.4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(meteor.x, meteor.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();

          if (meteor.life <= 0 || meteor.y > height + 80 || meteor.x < -200) meteor = null;
        }
      }

      frame = requestAnimationFrame(draw);
    };

    seed();
    frame = requestAnimationFrame(draw);

    // Debounced, because a desktop resize fires this on every pixel and
    // re-seeding 460 stars per pixel is not free.
    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(seed, 180);
    };
    window.addEventListener("resize", onResize);

    // A hidden tab should cost nothing. rAF already throttles, but a laptop
    // that wakes with this page in a background tab should not spin at all.
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) {
        last = performance.now();
        frame = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      // Fixed and behind everything: `main` is positioned, so page content
      // paints above a negative z-index without needing a stacking context of
      // its own. The body's own ink still paints beneath the canvas.
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
};
