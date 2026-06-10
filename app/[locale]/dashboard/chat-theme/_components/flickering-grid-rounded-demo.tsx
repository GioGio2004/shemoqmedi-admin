import { FlickeringGrid } from "@/components/ui/flickering-grid";
export function FlickeringGridRoundedDemo() {
  return (
    <FlickeringGrid
      className="relative inset-0 z-0 [mask-image:radial-gradient(450px_circle_at_center,white,transparent)]"
      squareSize={4}
      gridGap={6}
      color="#68208aff"
      maxOpacity={0.5}
      flickerChance={0.1}
      height={800}
      width={800}
    />
  );
}
