import type { FormProps } from "./Form";

/**
 * See Form.tsx. `display: contents` keeps the fields in the card's own layout (its gaps), as if the form weren't
 * there. A submit never reaches the browser: react-native-web stops Enter in a field that has `onSubmit`, and
 * anything else (an implicit submit from a lone field) is cancelled, so the page never reloads.
 */
export function Form({ children, label }: FormProps) {
  return (
    <form
      aria-label={label}
      noValidate
      onSubmit={(event) => event.preventDefault()}
      style={{ display: "contents" }}
    >
      {children}
    </form>
  );
}
