let offsetMs = 0;
export const setClockOffset = (value = 0) => {
  offsetMs = value;
};
export const clockOffset = () => offsetMs;
export const now = () => new Date(Date.now() + offsetMs);
