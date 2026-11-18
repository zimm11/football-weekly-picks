import { NotFound } from "../src/components/NotFound";
import { usePageTitle } from "../src/lib/pageTitle";
export default function Page() {
  usePageTitle("Page not found");
  return <NotFound />;
}
