import type { ReactNode } from "react";

export type FormProps = {
  children: ReactNode;
  /** The form's accessible name on the web ("Sign in"). */
  label?: string;
};

/**
 * Groups a sign-in or sign-up form's fields. On the web (Form.web.tsx) it is a real `<form>`, so password
 * managers recognize the email and password and offer to fill and save them; the iPhone app needs nothing
 * around its fields. Enter still submits through each field's own `onSubmit`, never by submitting the form.
 */
export function Form({ children }: FormProps) {
  return <>{children}</>;
}
