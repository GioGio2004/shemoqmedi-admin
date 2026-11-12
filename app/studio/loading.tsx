// Shown at once on a tab switch while the next Studio page arrives.
export default function StudioLoading() {
  return (
    <div className="st-stack-lg" aria-busy="true" aria-label="Loading">
      <div className="st-head">
        <span className="st-skel st-skel-text" style={{ width: 120 }} />
        <span className="st-skel" style={{ height: 72, width: "58%" }} />
      </div>
      <span className="st-skel" style={{ height: 44, width: "100%", borderRadius: 12 }} />
      <span className="st-skel" style={{ height: 280, width: "100%", borderRadius: 14 }} />
    </div>
  );
}
