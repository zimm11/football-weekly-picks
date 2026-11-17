import * as SecureStore from "expo-secure-store";
/** Native sessions stay in the operating system's protected credential storage. */
export const sessionStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
