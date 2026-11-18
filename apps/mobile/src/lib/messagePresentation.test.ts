import { describe, expect, it } from "vitest";
import { counted, inAppPath, linkParts, messageTime, threadArrival } from "./messagePresentation";

describe("message timestamps match the web's day-sensitive wording", () => {
  const now = new Date(2026, 10, 16, 15, 42);
  it("uses Just now for future timestamps and less than one minute ago", () => {
    expect(messageTime(new Date(now.getTime() + 60_000).toISOString(), now)).toBe("Just now");
    expect(messageTime(new Date(now.getTime() - 59_000).toISOString(), now)).toBe("Just now");
  });
  it("switches from elapsed minutes to local clock time after an hour", () => {
    expect(messageTime(new Date(2026, 10, 16, 15, 30).toISOString(), now)).toBe("12 min ago");
    expect(messageTime(new Date(2026, 10, 16, 14, 42).toISOString(), now)).toBe("2:42 PM");
  });
  it("uses calendar days rather than a rolling 24-hour period", () => {
    expect(messageTime(new Date(2026, 10, 15, 23, 59).toISOString(), now)).toBe("Yesterday, 11:59 PM");
    expect(messageTime(new Date(2026, 10, 14, 9, 15).toISOString(), now)).toBe("Sat, 9:15 AM");
  });
  it("shows a date after a week and includes year only for another year", () => {
    expect(messageTime(new Date(2026, 10, 2, 9).toISOString(), now)).toBe("Nov 2");
    expect(messageTime(new Date(2025, 10, 2, 9).toISOString(), now)).toBe("Nov 2, 2025");
  });
});

describe("counts read as words", () => {
  it("uses the singular for exactly one", () => {
    expect(counted(1, "reaction")).toBe("1 reaction");
    expect(counted(0, "reaction")).toBe("0 reactions");
    expect(counted(2, "reply", "replies")).toBe("2 replies");
    expect(counted(1, "reply", "replies")).toBe("1 reply");
  });
});

describe("links in a message", () => {
  const link = (url: string) => ({ type: "link", text: url, url });
  const text = (value: string) => ({ type: "text", text: value });
  it("leaves a message without an address as one run of text", () => {
    expect(linkParts("Who is your POW?")).toEqual([text("Who is your POW?")]);
    expect(linkParts("")).toEqual([]);
  });
  it("links http and https addresses and keeps the text around them", () => {
    expect(linkParts("Lines: https://example.com/a?b=1#c and http://example.org now")).toEqual([
      text("Lines: "),
      link("https://example.com/a?b=1#c"),
      text(" and "),
      link("http://example.org"),
      text(" now"),
    ]);
    expect(linkParts("https://example.com")).toEqual([link("https://example.com")]);
    expect(linkParts("first\nhttps://example.com/x\nlast")).toEqual([
      text("first\n"),
      link("https://example.com/x"),
      text("\nlast"),
    ]);
  });
  it("keeps the punctuation after an address out of the link", () => {
    expect(linkParts("See https://example.com/a.")).toEqual([
      text("See "),
      link("https://example.com/a"),
      text("."),
    ]);
    expect(linkParts("(more at https://example.com/a), ok?")).toEqual([
      text("(more at "),
      link("https://example.com/a"),
      text("), ok?"),
    ]);
    expect(linkParts("Really https://example.com/a?!")).toEqual([
      text("Really "),
      link("https://example.com/a"),
      text("?!"),
    ]);
    expect(linkParts("“https://example.com/a”")).toEqual([
      text("“"),
      link("https://example.com/a"),
      text("”"),
    ]);
  });
  it("keeps a closing bracket that belongs to the address", () => {
    expect(linkParts("https://example.com/wiki/Line_(betting) is good")).toEqual([
      link("https://example.com/wiki/Line_(betting)"),
      text(" is good"),
    ]);
    expect(linkParts("(https://example.com/wiki/Line_(betting))")).toEqual([
      text("("),
      link("https://example.com/wiki/Line_(betting)"),
      text(")"),
    ]);
  });
  it("never links another scheme, or an address without a host", () => {
    for (const value of [
      "javascript:alert(1)",
      "JAVASCRIPT://example.com/%0aalert(1)",
      "data:text/html,<b>x</b>",
      "mailto:pat@example.com",
      "ftp://example.com/file",
      "www.example.com",
      "https://",
      "https:// example.com",
      "xhttps://example.com",
    ])
      expect(linkParts(value)).toEqual([text(value)]);
    // A real address after another scheme's text is still the only link, and stays http(s).
    expect(linkParts("javascript:https://example.com/a")).toEqual([
      text("javascript:"),
      link("https://example.com/a"),
    ]);
  });
  it("stops an address at a space, an angle bracket or a quote", () => {
    expect(linkParts('<a href="https://example.com/a">x</a>')).toEqual([
      text('<a href="'),
      link("https://example.com/a"),
      text('">x</a>'),
    ]);
  });
});

describe("links back into the app", () => {
  const origins = ["http://localhost:8081", "https://www.pow-pickem.com", undefined];
  it("gives the path of a link to this app", () => {
    expect(inAppPath("https://www.pow-pickem.com/leagues/abc/messages/def", origins)).toBe(
      "/leagues/abc/messages/def",
    );
    expect(inAppPath("http://localhost:8081/how-to-play?section=squares", origins)).toBe(
      "/how-to-play?section=squares",
    );
    expect(inAppPath("https://WWW.pow-pickem.com", origins)).toBe("/");
    expect(inAppPath("https://www.pow-pickem.com?x=1", origins)).toBe("/?x=1");
  });
  it("leaves every other address to the browser", () => {
    expect(inAppPath("https://example.com/leagues/abc", origins)).toBeNull();
    expect(inAppPath("https://www.pow-pickem.com.example.com/x", origins)).toBeNull();
    expect(inAppPath("https://www.pow-pickem.com@example.com/x", origins)).toBeNull();
    expect(inAppPath("https://user@www.pow-pickem.com/x", origins)).toBeNull();
    expect(inAppPath("http://www.pow-pickem.com/x", origins)).toBeNull();
    expect(inAppPath("not a url", origins)).toBeNull();
  });
});

describe("where a thread opens", () => {
  const posts = [1, 2, 3, 4].map((position) => ({ id: `p${position}`, position }));
  it("starts at the top when the reader never opened it, or the server doesn't say", () => {
    expect(threadArrival({ version: 4, readVersion: 0, posts })).toEqual({ at: "top" });
    expect(threadArrival({ version: 4, posts })).toEqual({ at: "top" });
  });
  it("lands on the first reply the reader hasn't seen", () => {
    expect(threadArrival({ version: 4, readVersion: 2, posts })).toEqual({
      at: "post",
      postId: "p3",
      reason: "unread",
    });
  });
  it("opens a fully read thread on its latest message, and a one-message thread at the top", () => {
    expect(threadArrival({ version: 4, readVersion: 4, posts })).toEqual({ at: "end" });
    expect(threadArrival({ version: 1, readVersion: 1, posts: posts.slice(0, 1) })).toEqual({ at: "top" });
  });
  it("lands on a linked message when it is in the thread", () => {
    expect(threadArrival({ version: 4, readVersion: 4, posts }, "p2")).toEqual({
      at: "post",
      postId: "p2",
      reason: "linked",
    });
    expect(threadArrival({ version: 4, readVersion: 4, posts }, "gone")).toEqual({ at: "end" });
  });
});
