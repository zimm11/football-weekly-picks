import { QuotesIcon } from "@phosphor-icons/react";
import type { MessageQuote as Quote } from "@picks/shared";

export function MessageQuote({ quote }: { quote: Quote }) {
  return (
    <blockquote
      aria-label={`Quoted message from ${quote.authorName}`}
      className="m-0 grid min-w-0 gap-2 rounded-lg bg-primary/10 p-3"
    >
      <p className="m-0 flex items-center gap-1.5 text-sm font-semibold break-words">
        <QuotesIcon aria-hidden weight="fill" className="size-4 shrink-0 text-primary" />
        {quote.authorName} wrote:
      </p>
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
