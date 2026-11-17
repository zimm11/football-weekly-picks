/** Whether Your leagues should suggest turning on notifications (see `NotificationsPrompt.web.tsx`). */
export function shouldOfferNotifications(input: {
  support: "supported" | "home-screen" | "unsupported";
  permission: NotificationPermission | undefined;
  dismissed: boolean;
}): boolean {
  if (input.dismissed) return false;
  // An iPhone browser tab qualifies too, since the way there is the home-screen app.
  if (input.support === "home-screen") return true;
  // Once the browser has asked (granted or denied), Settings is the place for it.
  return input.support === "supported" && input.permission === "default";
}
