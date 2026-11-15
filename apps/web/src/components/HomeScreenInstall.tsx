import { useEffect, useState } from "react";
import {
  claimHomeScreenOffer,
  detectPlatform,
  type HomeScreenPlatform,
  isStandalone,
  onHomeScreenOffer,
} from "../lib/homeScreen";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";

/**
 * The install steps. The public guide shows every platform; the in-app sheet passes the player's own
 * platform so a phone sees only its steps.
 */
export function HomeScreenInstructions({ platform = "other" }: { platform?: HomeScreenPlatform }) {
  const ios = (
    <Card>
      <h4 className="text-lg text-foreground">iPhone or iPad · Safari</h4>
      <ol className="m-0 grid list-decimal gap-3 pl-5 text-muted-foreground">
        <li>Open www.pow-pickem.com in Safari.</li>
        <li>
          Tap Share (the square with an arrow pointing up), then Add to Home Screen. You may need to scroll
          down to find it.
        </li>
        <li>Keep Open as Web App on if shown, then tap Add.</li>
      </ol>
    </Card>
  );
  const android = (
    <Card>
      <h4 className="text-lg text-foreground">Android · Chrome</h4>
      <ol className="m-0 grid list-decimal gap-3 pl-5 text-muted-foreground">
        <li>Open www.pow-pickem.com in Chrome.</li>
        <li>Tap the three-dot menu (⋮), then Add to Home screen or Install app.</li>
        <li>Follow the prompts to install the app or add the shortcut.</li>
      </ol>
    </Card>
  );
  return (
    <div className="grid gap-4">
      {platform === "ios" ? (
        ios
      ) : platform === "android" ? (
        android
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {ios}
          {android}
        </div>
      )}
      <p className="m-0 text-sm text-muted-foreground">
        Open the new POW Pick'em icon to get back to your leagues. You may need to sign in again the first
        time. An internet connection is required.
      </p>
      <p className="m-0 text-sm text-muted-foreground">
        Can't find the option? If you opened a link inside another app, open this site in Safari or Chrome
        first.
        {platform === "other" && " On a computer, bookmark the site or use your browser's install option."}
      </p>
    </div>
  );
}

/** The install help as a bottom sheet over the current screen, so unsaved picks underneath stay put. */
export function HomeScreenSheet({
  open,
  onOpenChange,
  platform,
  offer = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: HomeScreenPlatform;
  /** Opened by the app (after saving picks) rather than asked for: says why and offers "Not now". */
  offer?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Add it to your home screen</SheetTitle>
          <SheetDescription>
            {offer
              ? "Picks saved. Put POW Pick'em on your home screen so next week is one tap away."
              : "Keep POW Pick'em a tap away, with its own icon on your phone."}
          </SheetDescription>
        </SheetHeader>
        <div className={offer ? "px-4" : "px-4 pb-6"}>
          <HomeScreenInstructions platform={platform} />
        </div>
        {offer && (
          <SheetFooter className="pb-6">
            <SheetClose asChild>
              <Button variant="outline">Not now</Button>
            </SheetClose>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function useStandalone() {
  const [standalone, setStandalone] = useState(isStandalone);
  useEffect(() => {
    const mode = window.matchMedia("(display-mode: standalone)");
    const update = () => setStandalone(isStandalone());
    mode.addEventListener("change", update);
    return () => mode.removeEventListener("change", update);
  }, []);
  return standalone;
}

/**
 * The signed-in app's home-screen help: `open` backs the account menu item (hidden once installed),
 * and on a phone the first save of picks in this browser opens the sheet once on its own.
 */
export function useHomeScreenHelp() {
  const standalone = useStandalone();
  const [platform] = useState(() => detectPlatform());
  const [shown, setShown] = useState<"closed" | "help" | "offer">("closed");

  useEffect(
    () =>
      onHomeScreenOffer(() => {
        if (standalone || platform === "other" || !claimHomeScreenOffer()) return;
        setShown("offer");
      }),
    [standalone, platform],
  );

  return {
    available: !standalone,
    open: () => setShown("help"),
    sheet: (
      <HomeScreenSheet
        open={shown !== "closed"}
        offer={shown === "offer"}
        platform={platform}
        onOpenChange={(open) => !open && setShown("closed")}
      />
    ),
  };
}
