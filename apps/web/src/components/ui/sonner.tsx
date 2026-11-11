import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Where the outcome of an action is announced: a banner pinned low on the screen, just above the save bar
 * and (on a phone) the tab bar, so it reads from wherever the button was. `--toast-bottom` is set in styles.css.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      offset={{ bottom: "var(--toast-bottom)" }}
      mobileOffset={{ bottom: "var(--toast-bottom)" }}
      visibleToasts={2}
      icons={{
        success: <CheckCircleIcon weight="fill" className="size-5 text-win" />,
        error: <WarningCircleIcon weight="fill" className="size-5 text-destructive" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--input)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans! text-base! font-medium! shadow-lg! shadow-black/50!",
          success: "border-l-4! border-l-win!",
          error: "border-l-4! border-l-destructive!",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
