import type { MDXComponents } from "mdx/types";
import { docsMdxComponents } from "@/components/docs/mdx";

// Required by @next/mdx. MDX is only used by the team docs (content/docs).
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ...docsMdxComponents, ...components };
}
