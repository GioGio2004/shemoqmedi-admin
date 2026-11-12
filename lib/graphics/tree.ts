import { Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

// The graphics components are pure functions of their props (no hooks, no
// state), so a graphic can be resolved to plain host elements (div, img,
// svg…) before anyone draws it. Two callers need that:
//
//   the server   Glass panels register their rectangles while resolving, so
//                the frost can be laid down once, under all of them (render.ts)
//   the browser  satori's defaults differ from CSS (every div is flex and
//                positioned, lineClamp is a plain property), so the preview
//                rewrites each host element's style (preview.tsx)

type Props = { children?: ReactNode; style?: Record<string, unknown> };

/** Rewrites one host element's props (its children are already resolved). */
export type HostVisitor = (type: string, props: Props) => Props;

function flatten(node: ReactNode, out: ReactNode[], visit?: HostVisitor) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out, visit);
    return;
  }
  const resolved = resolve(node, visit);
  if (Array.isArray(resolved)) for (const child of resolved) flatten(child, out, visit);
  else if (resolved !== null && resolved !== undefined && typeof resolved !== "boolean") out.push(resolved);
}

/**
 * `node` with every function component called and every fragment flattened:
 * a tree of host elements only. Children are passed positionally, so React
 * asks for no keys.
 */
export function resolve(node: ReactNode, visit?: HostVisitor): ReactNode {
  if (Array.isArray(node)) {
    const out: ReactNode[] = [];
    flatten(node, out, visit);
    return out;
  }
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<Props>;
  if (typeof el.type === "function") return resolve((el.type as (p: Props) => ReactNode)(el.props), visit);
  if ((el.type as unknown) === Fragment) return resolve(el.props.children, visit);
  if (typeof el.type !== "string") return el;
  const children: ReactNode[] = [];
  flatten(el.props.children, children, visit);
  const props = visit ? visit(el.type, el.props) : el.props;
  // cloneElement keeps the key; children go in positionally (no key warnings).
  const { children: _dropped, ...rest } = props;
  void _dropped;
  return cloneElement(el, { ...rest, children: undefined }, ...children);
}
