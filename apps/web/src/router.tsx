import { type AnchorHTMLAttributes, type MouseEvent, useEffect, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

/*
 * A minimal History API router: the app has a handful of screens, so a routing library isn't worth its weight.
 * The static host rewrites unknown paths to index.html, so deep links (e.g. invite links) work.
 */

/*
 * Scroll positions, per history entry. A new screen starts at the top; going back (or forward) returns to
 * where the player was. Each entry carries a key in `history.state` so its position can be found again, and
 * its place in the order of entries (`idx`), so a back or forward step can be measured and undone.
 */
type EntryState = { key?: string; idx?: number; flash?: Flash } | null;
const positions = new Map<string, number>();
const newKey = () => Math.random().toString(36).slice(2);
const entryKey = () => (window.history.state as EntryState)?.key;
const entryIdx = () => (window.history.state as EntryState)?.idx;
if (!entryKey() || entryIdx() === undefined) {
  window.history.replaceState(
    { ...(window.history.state ?? {}), key: entryKey() ?? newKey(), idx: entryIdx() ?? 0 },
    "",
  );
}
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
let currentKey = entryKey();
let currentIdx = entryIdx() ?? 0;
/** The position the screen being shown should open at: where it was left, after back or forward; else the top. */
let pendingScroll = 0;

/** Asked before leaving a screen. It calls `leave` if and when the user agrees to go. */
type LeaveGuard = (leave: () => void) => void;
/** Every screen part with unsaved work right now, oldest first. Leaving asks the newest; one answer covers all. */
const leaveGuards = new Set<LeaveGuard>();
const newestGuard = () => [...leaveGuards].at(-1);
/** A back or forward step held for an answer is undone with a step the other way: that one changes nothing. */
let undoingStep = false;
/** The player agreed to leave, so the step being replayed goes through. */
let leaveAgreed = false;

// Registered when the module loads, so it runs before any screen's own popstate listener and can keep a held
// step from them: to the rest of the app, a step the player declined never happened.
window.addEventListener("popstate", (event) => {
  // `navigate` announces its own changes with an event of its own making; it has already recorded them.
  if (!event.isTrusted) return;
  if (undoingStep) {
    undoingStep = false;
    event.stopImmediatePropagation();
    return;
  }
  const idx = entryIdx();
  const guard = newestGuard();
  // The browser's back and forward (and the phone's back gesture) have already changed the URL when this
  // fires. With unsaved work on screen, step back to where the player was, then ask; agreeing replays the
  // step. An entry this router didn't write (a plain #anchor) has no place to measure, so it goes through.
  if (guard && !leaveAgreed && idx !== undefined && idx !== currentIdx) {
    const delta = idx - currentIdx;
    event.stopImmediatePropagation();
    undoingStep = true;
    window.history.go(-delta);
    guard(() => {
      leaveGuards.clear();
      leaveAgreed = true;
      window.history.go(delta);
    });
    return;
  }
  leaveAgreed = false;
  if (currentKey) positions.set(currentKey, window.scrollY);
  currentKey = entryKey();
  currentIdx = idx ?? currentIdx;
  pendingScroll = currentKey ? (positions.get(currentKey) ?? 0) : 0;
});

/** Where the screen just shown should scroll to. Read once per screen change. */
export function takeScrollPosition(): number {
  const top = pendingScroll;
  pendingScroll = 0;
  return top;
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

type Flash = { kind: "status" | "alert"; text: string };

/**
 * While `active`, leaving the screen is handed to `ask` instead of happening, so a screen with unsaved work can
 * check first: in-app navigation, the browser's back and forward buttons, and the phone's back gesture.
 * Several parts of a screen can each hold a guard (a draft message beside unsaved spreads); saving one leaves
 * the others in place. Reloads and tab closes are covered separately by `beforeunload`.
 */
export function useLeaveGuard(active: boolean, ask: LeaveGuard) {
  useEffect(() => {
    if (!active) return;
    leaveGuards.add(ask);
    return () => {
      leaveGuards.delete(ask);
    };
  }, [active, ask]);
}

/** Goes to another screen, optionally carrying a one-off message for it to show (e.g. an import warning). */
export function navigate(to: string, flash?: Flash) {
  const go = () => {
    leaveGuards.clear();
    // Recorded here rather than when the screen changes: a cross-fade announces the change a frame later, and
    // a back step arriving in between must still be measured from the new entry.
    if (currentKey) positions.set(currentKey, window.scrollY);
    currentKey = newKey();
    currentIdx += 1;
    pendingScroll = 0;
    window.history.pushState({ key: currentKey, idx: currentIdx, ...(flash ? { flash } : {}) }, "", to);
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
  const guard = newestGuard();
  if (guard) guard(go);
  else go();
}

/** The message `navigate` carried to this screen, if any. It is dropped from history so a reload doesn't repeat it. */
export function useFlash(): Flash | undefined {
  const [flash] = useState<Flash | undefined>(() => (window.history.state as EntryState)?.flash);
  useEffect(() => {
    if (flash) window.history.replaceState({ key: entryKey(), idx: entryIdx() }, "");
  }, [flash]);
  return flash;
}

/** An in-app link. An `onClick` of its own runs first, and can call `preventDefault` to stay put. */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented) return;
    // Leave modified clicks (new tab, etc.) to the browser.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  }
  return <a href={to} {...rest} onClick={handleClick} />;
}

export type Route =
  | { page: "leagues" }
  | { page: "login" }
  | { page: "reset-password" }
  | { page: "how-to-play" }
  | { page: "notifications" }
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
  if (first === "notifications" && !second) return { page: "notifications" };
  if (first === "how-to-play" && !second) return { page: "how-to-play" };
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
