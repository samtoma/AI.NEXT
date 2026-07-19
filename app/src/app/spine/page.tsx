import { getSpineData } from "@/lib/queries";
import { SpineExplorer } from "@/components/spine/SpineExplorer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The Evidence Walk — AI.Next Tutor PoC",
};

export default async function SpinePage() {
  const data = await getSpineData();
  return <SpineExplorer data={data} />;
}
