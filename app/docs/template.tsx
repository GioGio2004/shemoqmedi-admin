// A fresh wrapper per page, so each page fades in when it opens (docs.css: .docs-enter).
export default function DocsTemplate({ children }: { children: React.ReactNode }) {
  return <div className="docs-enter">{children}</div>;
}
