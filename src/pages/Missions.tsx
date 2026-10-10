import type { MissionStatus, PriceObservation } from "@engine/types.ts";
import { Plane, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { MissionCard } from "@/components/MissionCard";
import { EmptyState, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useData, useTicker } from "@/hooks/backend";

const GROUPS: Record<string, MissionStatus[]> = {
  active: ["monitoring", "target_reached", "booking_in_progress", "action_required", "booking_failed"],
  drafts: ["draft", "paused"],
  booked: ["booked"],
  closed: ["expired", "cancelled"],
};

export default function Missions() {
  useTicker();
  const [tab, setTab] = useState("active");
  const { data, loading } = useData(async (b) => {
    const missions = await b.listMissions();
    const obs: Record<string, PriceObservation[]> = {};
    await Promise.all(missions.slice(0, 24).map(async (m) => (obs[m.id] = await b.listObservations(m.id))));
    return { missions, obs };
  });
  const list = (data?.missions ?? []).filter((m) => GROUPS[tab].includes(m.monitoringStatus));

  return (
    <div>
      <PageHeader
        title="Flight missions"
        description="Each mission is a standing purchase order FareBuddy executes for you."
        actions={
          <Button asChild variant="signal">
            <Link to="/app/missions/new">
              <Plus /> New mission
            </Link>
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-5 w-full justify-start overflow-x-auto sm:w-auto">
          {Object.keys(GROUPS).map((g) => (
            <TabsTrigger key={g} value={g} className="capitalize">
              {g}
              <span className="ml-1 text-xs text-muted-foreground">{(data?.missions ?? []).filter((m) => GROUPS[g].includes(m.monitoringStatus)).length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState icon={<Plane className="h-5 w-5" />} title="Nothing here" description="Missions in this state will appear here." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <MissionCard key={m.id} mission={m} observations={data?.obs[m.id]} />
          ))}
        </div>
      )}
    </div>
  );
}
