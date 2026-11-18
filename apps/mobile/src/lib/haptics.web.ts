/** The website has no haptics (see `haptics.ts`): the same calls, doing nothing, so the bundle leaves out `expo-haptics`. */
const none = () => {};

export const haptics = { select: none, toggle: none, success: none, warn: none, error: none };
