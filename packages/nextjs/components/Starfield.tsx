"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import * as THREE from "three";

/**
 * The sky, in three dimensions.
 *
 * The first version of this was a 2D canvas: a few hundred dots drifting down a
 * flat plane. It reads as a texture rather than as space, and the reason is
 * parallax. Depth is not something you paint, it is something the viewer *does*
 * — near things move further than far things when the point of view shifts, and
 * in a flat field nothing shifts at all.
 *
 * So the field is a real volume now. Six thousand stars are scattered through a
 * 900-unit-deep box, a perspective camera flies slowly through it, and both the
 * pointer and the scroll position move that camera. The far stars barely
 * translate; the near ones sweep past. That difference is the whole effect and
 * it cannot be faked in two dimensions.
 *
 * Three decisions keep it from being the noisy starfield every dark landing
 * page has:
 *
 *   - Restraint. Brightness falls off with distance and most of the field sits
 *     deep, so text wins every contest with the background, which is the one
 *     rule a background has.
 *   - Colour discipline. Cool white, with a minority in the site's own signal
 *     colour, so the sky belongs to the palette rather than sitting behind it.
 *   - Rarity. A meteor crosses every twenty seconds or so, never on a rhythm
 *     the eye can learn.
 *
 * The whole sky is one buffer geometry and one shader, so it is a single draw
 * call no matter how many stars are in it.
 */

/*
  Density is what makes a field read as a sky rather than as a handful of
  specks. Nine thousand points is one buffer and one draw call, so the cost of
  the difference is a few hundred kilobytes of vertex data and nothing per
  frame.
*/
const STARS = 9000;

/** The volume the field occupies, in world units. */
const SPREAD_X = 900;
const SPREAD_Y = 620;
const DEPTH = 900;

/** How fast the camera flies. Slow enough to be felt rather than watched. */
const DRIFT = 5.5;

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uDepth;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    float dist = -viewPosition.z;

    // Perspective attenuation: a star twice as far is half the size. Without
    // this every star is the same dot and the volume collapses back to a plane.
    //
    // The clamp is what keeps it a sky. Unbounded, a star near the camera
    // resolves to a seventy-pixel disc and the field turns into lens bokeh —
    // depth is still there, but it has stopped looking like space and started
    // competing with the headline. A star is a point of light; past four
    // pixels it stops reading as one.
    gl_PointSize = min(aSize * uPixelRatio * (360.0 / max(dist, 1.0)), 4.2 * uPixelRatio);

    // Scintillation, multiplicative so a dim star stays dim.
    float twinkle = 0.72 + 0.28 * sin(uTime * 0.9 + aPhase);

    // Fade in at the far plane and out well before a star reaches the camera,
    // so nothing ever pops into existence at the wrap and nothing ever sweeps
    // past the lens as a smear.
    float far = smoothstep(uDepth, uDepth * 0.72, dist);
    float near = smoothstep(70.0, 280.0, dist);

    vAlpha = twinkle * far * near;
    vColor = aColor;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    // A round, soft point. The steep falloff gives a core with a halo rather
    // than a disc with a hard edge, which is what a real point of light does to
    // a lens.
    vec2 offset = gl_PointCoord - 0.5;
    float d = length(offset);
    if (d > 0.5) discard;

    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, pow(core, 1.8) * vAlpha);
  }
`;

/** Cool white for most of the field, the site's signal colour for a minority. */
const WHITE = new THREE.Color("#dfe6f5");
const SIGNAL = new THREE.Color("#27c3d4");

export const Starfield = () => {
  const host = useRef<HTMLDivElement>(null);

  // The sky is at full strength behind the landing page and steps back
  // everywhere else. The documents are the part of this site somebody reads a
  // paragraph at a time, and a moving field behind running text is a cost the
  // reader pays for atmosphere they were already sold on the way in.
  const atmospheric = usePathname() === "/";

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;

    // A machine with no WebGL gets an empty black ground rather than a crash.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
    } catch {
      return;
    }

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    renderer.setClearAlpha(0);
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, 1, 1, DEPTH * 1.4);

    // ── the field ────────────────────────────────────────────────────
    const positions = new Float32Array(STARS * 3);
    const sizes = new Float32Array(STARS);
    const phases = new Float32Array(STARS);
    const colors = new Float32Array(STARS * 3);
    const colour = new THREE.Color();

    for (let i = 0; i < STARS; i++) {
      positions[i * 3] = (Math.random() - 0.5) * SPREAD_X;
      positions[i * 3 + 1] = (Math.random() - 0.5) * SPREAD_Y;
      // Negative z is in front of a camera looking down -z. Biased away from
      // the lens: an even spread puts a sixth of the field in the nearest
      // sixth of the volume, where each star is largest and does the most
      // damage to whatever is being read on top of it.
      positions[i * 3 + 2] = -(160 + Math.random() ** 0.65 * (DEPTH - 160));

      // Cubed, so the field is mostly faint dust with a few real stars in it.
      // The floor matters as much as the ceiling: a point that resolves to
      // less than a pixel is antialiased into nothing and the field reads as
      // an empty black rectangle.
      const r = Math.random();
      sizes[i] = 2.0 + r * r * r * 6;
      phases[i] = Math.random() * Math.PI * 2;

      colour.copy(Math.random() < 0.16 ? SIGNAL : WHITE);
      // Vary luminance per star rather than hue, so the field gains depth
      // without turning into confetti.
      colour.multiplyScalar(0.62 + Math.random() * 0.38);
      colors[i * 3] = colour.r;
      colors[i * 3 + 1] = colour.g;
      colors[i * 3 + 2] = colour.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

    const uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uDepth: { value: DEPTH },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      // Additive, because light adds. Two stars overlapping should be brighter
      // than either, not one occluding the other.
      blending: THREE.AdditiveBlending,
    });

    const field = new THREE.Points(geometry, material);
    scene.add(field);

    // ── the meteor ───────────────────────────────────────────────────
    // One reused line rather than an object per event, so nothing is allocated
    // inside the animation loop.
    const meteorGeometry = new THREE.BufferGeometry();
    meteorGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const meteorMaterial = new THREE.LineBasicMaterial({
      color: 0xdfe6f5,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const meteor = new THREE.Line(meteorGeometry, meteorMaterial);
    scene.add(meteor);

    let meteorLife = 0;
    let nextMeteor = 5 + Math.random() * 12;
    const meteorFrom = new THREE.Vector3();
    const meteorTo = new THREE.Vector3();
    const head = new THREE.Vector3();
    const tail = new THREE.Vector3();

    const launchMeteor = () => {
      const z = -180 - Math.random() * 320;
      meteorFrom.set((0.15 + Math.random() * 0.5) * SPREAD_X * 0.5, (0.1 + Math.random() * 0.4) * SPREAD_Y * 0.5, z);
      meteorTo.set(meteorFrom.x - 150 - Math.random() * 120, meteorFrom.y - 90 - Math.random() * 70, z + 30);
      meteorLife = 1;
    };

    // ── motion ───────────────────────────────────────────────────────
    const pointer = new THREE.Vector2();
    const target = new THREE.Vector2();
    let scrollShift = 0;
    let travelled = 0;

    const onPointer = (e: PointerEvent) => {
      // Normalised to the window, so the parallax is identical on any screen.
      target.set((e.clientX / window.innerWidth - 0.5) * 2, (e.clientY / window.innerHeight - 0.5) * 2);
    };

    const onScroll = () => {
      // Scrolling dollies the camera through the field. It is the cheapest way
      // to make a page feel like it is moving *through* something rather than
      // sliding over it, and it costs one number.
      scrollShift = window.scrollY * 0.06;
    };

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Capped at 1.5 rather than 2. This canvas is the whole viewport, and a
      // retina laptop at 2x is 5.2 million fragments a frame of additive
      // blending for a background nobody is looking directly at. Points are
      // round and soft, so the half-step down is invisible and the saving is
      // nearly half the fill.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h);
      uniforms.uPixelRatio.value = dpr;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    resize();
    onScroll();

    const clock = new THREE.Clock();
    let frame = 0;

    const render = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();
      uniforms.uTime.value = t;

      if (!calm) {
        travelled += DRIFT * dt;

        // Fly forward through the volume, wrapping the whole field rather than
        // each star: the distribution is uniform, so shifting it by one depth
        // is indistinguishable from an infinite field and costs one number
        // instead of six thousand writes a frame.
        field.position.z = travelled % DEPTH;

        // The sky turns, very slightly. Enough that the field is not a fixed
        // photograph, not enough to read as rotation.
        field.rotation.z = t * 0.006;

        // Ease toward the pointer rather than snapping, so a fast mouse
        // produces a glide instead of a jerk.
        pointer.lerp(target, 1 - Math.pow(0.001, dt));
      }

      camera.position.set(pointer.x * 26, -pointer.y * 16 + scrollShift * 0.35, scrollShift * 0.9);
      camera.lookAt(0, 0, camera.position.z - 100);

      if (!calm) {
        nextMeteor -= dt;
        if (meteorLife <= 0 && nextMeteor <= 0) {
          launchMeteor();
          nextMeteor = 12 + Math.random() * 16;
        }

        if (meteorLife > 0) {
          meteorLife -= dt * 0.9;
          const progress = 1 - meteorLife;
          const p = meteorGeometry.getAttribute("position") as THREE.BufferAttribute;
          // The visible segment is a short tail chasing the head down the path.
          tail.lerpVectors(meteorFrom, meteorTo, Math.max(0, progress - 0.22));
          head.lerpVectors(meteorFrom, meteorTo, Math.min(1, progress));
          p.setXYZ(0, tail.x, tail.y, tail.z);
          p.setXYZ(1, head.x, head.y, head.z);
          p.needsUpdate = true;
          meteorMaterial.opacity = Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI) * 0.9;
        } else {
          meteorMaterial.opacity = 0;
        }
      }

      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });

    // A hidden tab should cost nothing at all. rAF throttles on its own, but a
    // laptop that wakes with this page in a background tab should not spin.
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) {
        clock.getDelta();
        frame = requestAnimationFrame(render);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      geometry.dispose();
      material.dispose();
      meteorGeometry.dispose();
      meteorMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden
      // Fixed and behind everything: `main` is positioned, so page content
      // paints above a negative z-index without needing a stacking context of
      // its own. The root's ink still paints beneath it.
      className={`pointer-events-none fixed inset-0 -z-10 transition-opacity duration-700 ${
        atmospheric ? "opacity-100" : "opacity-35"
      }`}
    />
  );
};
