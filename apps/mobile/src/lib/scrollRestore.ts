import type { ComponentRef, Ref } from "react";
import type { ScrollView } from "react-native";

/** What a ScrollView's ref holds. */
type ScrollViewRef = ComponentRef<typeof ScrollView>;

/**
 * Web only (see `scrollRestore.web.ts`): returns a scroll view to where it was when the browser's Back or
 * Forward comes back to its page. On iPhone the stack keeps earlier screens alive, scroll position included,
 * so this only hands the ref back.
 *
 *   const scrollRef = useScrollRestore();            // or useScrollRestore(myRef) to keep using myRef
 *   <ScrollView ref={scrollRef}>…</ScrollView>
 */
export function useScrollRestore<T = ScrollViewRef>(ref?: Ref<T>, _name = "page"): Ref<T> | undefined {
  return ref;
}
