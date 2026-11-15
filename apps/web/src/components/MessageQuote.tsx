import type { MessageQuote as Quote } from "@picks/shared";

export function MessageQuote({ quote }: { quote: Quote }) {
  return (
    <blockquote
      aria-label={`Quoted message from ${quote.authorName}`}
      className="m-0 grid min-w-0 gap-2 rounded-r-lg border-l-2 border-primary bg-raised/60 p-3"
    >
      <p className="m-0 text-sm font-semibold break-words">{quote.authorName} wrote:</p>
      <p className="m-0 line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground">{quote.body}</p>
      <a
        className="flex min-h-11 w-fit items-center text-sm"
        href={`#message-${quote.id}`}
        onClick={(e) => {
          e.preventDefault();
          const original = document.getElementById(`message-${quote.id}`);
          original?.scrollIntoView({ block: "center" });
          original?.focus({ preventScroll: true });
        }}
      >
        View original
      </a>
    </blockquote>
  );
}
