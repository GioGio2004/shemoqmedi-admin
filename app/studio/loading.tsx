import "@/app/studio/screens/status.css";

// Shown at once on a tab switch while the next Studio page arrives: the
// title and a few glass cards whose placeholders shimmer.
export default function StudioLoading() {
  return (
    <div className="st-stack-lg" role="status" aria-busy="true">
      <span className="st-status-sr">Loading</span>
      <div className="st-head" aria-hidden="true">
        <span className="st-skel st-skel-text" style={{ width: 120 }} />
        <span className="st-skel st-skel-title" />
      </div>
      <span className="st-skel" aria-hidden="true" style={{ height: 44, width: "min(100%, 360px)", borderRadius: 999 }} />
      <div className="st-status-grid" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="st-glass st-status-card">
            <span className="st-skel st-status-media" />
            <div className="st-status-body">
              <span className="st-skel st-skel-text" style={{ width: "64%", height: 16 }} />
              <span className="st-skel st-skel-text" style={{ width: "92%" }} />
              <span className="st-skel st-skel-text" style={{ width: "40%" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
