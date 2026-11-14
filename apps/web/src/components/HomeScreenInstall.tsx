import { DeviceMobileIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";

/** Shared by the public guide and the in-place install help on league screens. */
export function HomeScreenInstructions() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h4 className="text-2xl">iPhone or iPad · Safari</h4>
          <ol className="m-0 grid list-decimal gap-3 pl-5 text-muted-foreground">
            <li>Open www.pow-pickem.com in Safari.</li>
            <li>
              Tap Share (the square with an arrow pointing up), then Add to Home Screen. You may need to
              scroll down to find it.
            </li>
            <li>Keep Open as Web App on if shown, then tap Add.</li>
          </ol>
        </Card>
        <Card>
          <h4 className="text-2xl">Android · Chrome</h4>
          <ol className="m-0 grid list-decimal gap-3 pl-5 text-muted-foreground">
            <li>Open www.pow-pickem.com in Chrome.</li>
            <li>Tap the three-dot menu (⋮), then Add to Home screen or Install app.</li>
            <li>Follow the prompts to install the app or add the shortcut.</li>
          </ol>
        </Card>
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        Open the new POW Pick'em icon to get back to your leagues. You may need to sign in again the first
        time. An internet connection is required.
      </p>
      <p className="m-0 text-sm text-muted-foreground">
        Can't find the option? If you opened a link inside another app, open this site in Safari or Chrome
        first. On a computer, bookmark the site or use your browser's install option if available.
      </p>
    </div>
  );
}

/** iOS uses navigator.standalone; other browsers expose the app's display mode. */
function useStandalone() {
  const [standalone, setStandalone] = useState(
    () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
  );
  useEffect(() => {
    const mode = window.matchMedia("(display-mode: standalone)");
    const update = () =>
      setStandalone(
        mode.matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
    mode.addEventListener("change", update);
    return () => mode.removeEventListener("change", update);
  }, []);
  return standalone;
}

/** Help opens over the current screen, preserving any unsaved picks underneath. */
export function HomeScreenInstall() {
  const standalone = useStandalone();
  if (standalone) return null;
  return (
    <aside
      aria-label="Home screen app"
      className="flex flex-wrap items-center gap-3 rounded-md border border-primary/40 bg-primary/10 p-4"
    >
      <DeviceMobileIcon aria-hidden className="size-7 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 basis-40">
        <p className="m-0 font-display text-xl font-bold uppercase">POW Pick'em, one tap away</p>
        <p className="m-0 text-sm text-muted-foreground">Put your leagues on your home screen.</p>
      </div>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline">Add to home screen</Button>
        </SheetTrigger>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Add it to your home screen</SheetTitle>
            <SheetDescription>Keep POW Pick'em a tap away, with its own icon on your phone.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <HomeScreenInstructions />
          </div>
        </SheetContent>
      </Sheet>
    </aside>
  );
}
