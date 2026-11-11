import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useState, useSyncExternalStore } from "react";

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
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
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
  | { page: "join"; code: string }
  | { page: "league"; leagueId: string; tab: "picks" | "results" | "standings" | "league" }
  | { page: "week"; weekId: string }
  | { page: "manage-week"; weekId: string }
  | { page: "not-found" };

export function matchRoute(path: string): Route {
  const [first, second, ...rest] = path.split("/").filter(Boolean);
  if (!first) return { page: "leagues" };
  if (second && rest.length === 0) {
    if (first === "join") return { page: "join", code: decodeURIComponent(second) };
    if (first === "leagues") return { page: "league", leagueId: second, tab: "picks" };
    if (first === "weeks") return { page: "week", weekId: second };
  }
  const [third] = rest;
  if (first === "leagues" && second && rest.length === 1) {
    if (third === "results" || third === "standings" || third === "league") {
      return { page: "league", leagueId: second, tab: third };
    }
  }
  if (first === "weeks" && second && rest.length === 1 && third === "manage") {
    return { page: "manage-week", weekId: second };
  }
  return { page: "not-found" };
}
