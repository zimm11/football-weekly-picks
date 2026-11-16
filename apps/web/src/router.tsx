import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

/*
 * A minimal History API router: the app has a handful of screens, so a routing library isn't worth its weight.
 * The static host rewrites unknown paths to index.html, so deep links (e.g. invite links) work.
 */

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

type Flash = { kind: "status" | "alert"; text: string };

/** Asked before leaving a screen. It calls `leave` if and when the user agrees to go. */
type LeaveGuard = (leave: () => void) => void;
let leaveGuard: LeaveGuard | undefined;

/**
 * While `active`, in-app navigation is handed to `ask` instead of happening, so a screen with unsaved work
 * can check first. Reloads and tab closes are covered separately by `beforeunload`; the browser's back
 * button is not intercepted.
 */
export function useLeaveGuard(active: boolean, ask: LeaveGuard) {
  useEffect(() => {
    if (!active) return;
    leaveGuard = ask;
    return () => {
      if (leaveGuard === ask) leaveGuard = undefined;
    };
  }, [active, ask]);
}

/** Goes to another screen, optionally carrying a one-off message for it to show (e.g. an import warning). */
export function navigate(to: string, flash?: Flash) {
  const go = () => {
    leaveGuard = undefined;
    window.history.pushState(flash ? { flash } : null, "", to);
    withTransition(() => window.dispatchEvent(new PopStateEvent("popstate")));
  };
  requestLeave(go);
}

/**
 * A short cross-fade between screens where the browser supports view transitions and the player hasn't
 * asked for reduced motion. `flushSync` renders the new screen inside the transition so the browser
 * captures it; anywhere else the screen simply changes.
 */
function withTransition(update: () => void) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduce) return update();
  const transition = document.startViewTransition(() => flushSync(update));
  // A navigation that starts before the last fade ends skips that fade (its screen still changes), which
  // rejects these promises. Nothing waits on them, so the rejection is expected and dropped.
  transition.ready.catch(() => {});
  transition.finished.catch(() => {});
}

/** Also guards view changes (such as switching seasons) that do not change the URL. */
export function requestLeave(go: () => void) {
  if (leaveGuard) leaveGuard(go);
  else go();
}

/** The message `navigate` carried to this screen, if any. It is dropped from history so a reload doesn't repeat it. */
export function useFlash(): Flash | undefined {
  const [flash] = useState<Flash | undefined>(
    () => (window.history.state as { flash?: Flash } | null)?.flash,
  );
  useEffect(() => {
    if (flash) window.history.replaceState(null, "");
  }, [flash]);
  return flash;
}

export function Link({ to, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    // Leave modified clicks (new tab, etc.) to the browser.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  }
  return <a href={to} onClick={onClick} {...rest} />;
}

export type Route =
  | { page: "leagues" }
  | { page: "login" }
  | { page: "reset-password" }
  | { page: "how-to-play" }
  | { page: "privacy" }
  | { page: "terms" }
  | { page: "feedback" }
  | { page: "operator" }
  | { page: "account" }
  | { page: "unsubscribe" }
  | { page: "join"; code: string }
  | {
      page: "league";
      leagueId: string;
      tab: "picks" | "results" | "standings" | "league" | "messages";
      threadId?: string;
    }
  | { page: "week"; weekId: string }
  | { page: "manage-week"; weekId: string }
  | { page: "not-found" };

export function matchRoute(path: string): Route {
  const [first, second, ...rest] = path.split("/").filter(Boolean);
  if (!first) return { page: "leagues" };
  if (first === "login" && !second) return { page: "login" };
  if (first === "reset-password" && !second) return { page: "reset-password" };
  if (first === "how-to-play" && !second) return { page: "how-to-play" };
  if (first === "privacy" && !second) return { page: "privacy" };
  if (first === "terms" && !second) return { page: "terms" };
  if (first === "feedback" && !second) return { page: "feedback" };
  if (first === "operator" && !second) return { page: "operator" };
  if (first === "account" && !second) return { page: "account" };
  if (first === "unsubscribe" && !second) return { page: "unsubscribe" };
  if (second && rest.length === 0) {
    if (first === "join") return { page: "join", code: decodeURIComponent(second) };
    if (first === "leagues") return { page: "league", leagueId: second, tab: "picks" };
    if (first === "weeks") return { page: "week", weekId: second };
  }
  const [third] = rest;
  if (first === "leagues" && second && rest.length === 1) {
    if (third === "results" || third === "standings" || third === "league" || third === "messages") {
      return { page: "league", leagueId: second, tab: third };
    }
  }
  if (first === "leagues" && second && third === "messages" && rest.length === 2) {
    return { page: "league", leagueId: second, tab: "messages", threadId: rest[1] };
  }
  if (first === "weeks" && second && rest.length === 1 && third === "manage") {
    return { page: "manage-week", weekId: second };
  }
  return { page: "not-found" };
}
