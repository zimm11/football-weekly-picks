import { useState } from "react";

/** Length of one pass of the light along the bar; matches `--animate-splash-sweep` in styles.css. */
const SWEEP_MS = 1600;

/**
 * The screen the app opens on: the POW mark (the home-screen icon, drawn in the page's fonts) over the whole
 * viewport while the session, profile and leagues load. It covers the header, so it looks the same whichever
 * stage is rendering it, and the sweep along the bar is offset by page time, so a remount mid-load doesn't
 * restart it. Pass `name` once the profile has arrived to greet the player.
 */
export function Splash({ name }: { name?: string }) {
  const [sweepDelay] = useState(() => `-${Math.round(performance.now() % SWEEP_MS)}ms`);
  const firstName = name?.trim().split(/\s+/)[0];
  return (
    <div
      role="status"
      aria-label="Opening POW Pick'em"
      aria-busy
      className="fixed inset-0 z-50 grid place-items-center bg-chrome bg-[radial-gradient(ellipse_at_center,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_65%)] px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid justify-items-center gap-8">
        <div aria-hidden className="grid justify-items-stretch">
          <span className="font-display text-[clamp(7rem,32vw,11rem)] leading-[0.8] font-extrabold tracking-[0.01em] text-foreground">
            POW
          </span>
          <span className="relative mt-[0.4em] h-[clamp(0.6rem,2.6vw,0.9rem)] overflow-hidden bg-pow">
            <span
              className="absolute inset-y-0 left-0 w-2/5 animate-splash-sweep bg-linear-to-r from-transparent via-white/70 to-transparent motion-reduce:hidden"
              style={{ animationDelay: sweepDelay }}
            />
          </span>
          <span className="mt-4 text-center font-display text-2xl font-bold tracking-[0.5em] text-muted-foreground uppercase">
            Pick'em
          </span>
        </div>
        <p className="m-0 min-h-14 text-center">
          {firstName ? (
            <span className="block animate-in fade-in font-display text-2xl font-bold tracking-wide uppercase duration-500">
              Welcome back, {firstName}
            </span>
          ) : (
            <span className="block font-display text-2xl tracking-wide uppercase">&nbsp;</span>
          )}
          <span className="block text-sm text-muted-foreground">Getting your leagues ready…</span>
        </p>
      </div>
    </div>
  );
}
