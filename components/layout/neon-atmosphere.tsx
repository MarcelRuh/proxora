"use client";

export function NeonAtmosphere() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        className="proxora-orb"
        style={{
          top: "-8%",
          left: "-6%",
          width: 420,
          height: 420,
          background: "radial-gradient(circle, rgba(255,0,110,0.55), transparent 70%)",
        }}
      />
      <div
        className="proxora-orb"
        style={{
          bottom: "-12%",
          right: "-8%",
          width: 480,
          height: 480,
          background: "radial-gradient(circle, rgba(0,180,216,0.4), transparent 70%)",
          animationDelay: "-4s",
        }}
      />
      <div
        className="proxora-orb"
        style={{
          top: "38%",
          right: "18%",
          width: 280,
          height: 280,
          background: "radial-gradient(circle, rgba(131,56,236,0.35), transparent 70%)",
          animationDelay: "-7s",
        }}
      />
    </div>
  );
}
