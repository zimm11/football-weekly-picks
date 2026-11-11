import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLeaveGuard } from "../router";

type Request = { title: string; detail: string; action: string; resolve: (ok: boolean) => void };

/**
 * A themed stand-in for `window.confirm`. Render `dialog` once, then `await confirm(...)`:
 * it resolves true when the user goes ahead and false when they back out.
 */
export function useConfirm(): [
  confirm: (ask: { title: string; detail: string; action: string }) => Promise<boolean>,
  dialog: ReactNode,
] {
  const [request, setRequest] = useState<Request>();
  const confirm = useCallback(
    (ask: { title: string; detail: string; action: string }) =>
      new Promise<boolean>((resolve) => setRequest({ ...ask, resolve })),
    [],
  );
  const answer = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(undefined);
  };

  const dialog = (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.detail}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => answer(true)}>{request?.action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return [confirm, dialog];
}

/**
 * Stops unsaved work being thrown away by accident. While `dirty`, moving to another screen asks first, and
 * a reload or tab close gets the browser's own warning. Render the returned dialog.
 */
export function useUnsavedGuard(dirty: boolean, what: string): ReactNode {
  const [confirm, dialog] = useConfirm();
  const ask = useCallback(
    (leave: () => void) => {
      confirm({
        title: "Leave without saving?",
        detail: `Your ${what} haven't been saved yet.`,
        action: "Leave",
      }).then((ok) => ok && leave());
    },
    [confirm, what],
  );
  useLeaveGuard(dirty, ask);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return dialog;
}
