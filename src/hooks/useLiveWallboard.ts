"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

export interface LiveAgent {
  user_vicidial: string;
  full_name: string;
  campaign_id: string;
  campaign_name: string;
  session_id: string;
  status: "INCALL" | "READY" | "PAUSED" | "DISPO" | string;
  lead_id: string | null;
  callerid: string | null;
  calls_today: number;
  phone_number: string | null;
  lead_first_name: string | null;
  lead_last_name: string | null;
  lead_status: string | null;
  called_count: number | null;
  updated_at: string;
}

export interface GroupStats {
  calls_waiting: number;
  agents_logged_in: number;
  agents_in_calls: number;
  agents_waiting: number;
  agents_paused: number;
  agents_in_dispo: number;
  agents_in_dead_calls: number;
  updated_at: string;
}

export interface LiveCampaign {
  campaign_id: string;
  campaign_name: string;
  dial_method: string;
  dial_level: string;
  total_agents: number;
  incall_agents: number;
  ready_agents: number;
  paused_agents: number;
  updated_at: string;
}

export function useLiveWallboard() {
  const [agents, setAgents] = useState<LiveAgent[]>([]);
  const [groupStats, setGroupStats] = useState<GroupStats | null>(null);
  const [campaigns, setCampaigns] = useState<LiveCampaign[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    const [{ data: ag }, { data: gs }, { data: ca }] = await Promise.all([
      supabase
        .from("live_agents")
        .select("*")
        .order("status")
        .order("calls_today", { ascending: false }),
      supabase.from("live_group_stats").select("*").limit(1).single(),
      supabase
        .from("live_campaigns")
        .select("*")
        .eq("active", true)
        .order("total_agents", { ascending: false }),
    ]);
    if (ag) setAgents(ag);
    if (gs) setGroupStats(gs);
    if (ca) setCampaigns(ca);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    fetchAll();

    const agentsSub = supabase
      .channel("live_agents_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_agents" },
        fetchAll
      )
      .subscribe();

    const statsSub = supabase
      .channel("live_group_stats_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_group_stats" },
        fetchAll
      )
      .subscribe();

    return () => {
      supabase.removeChannel(agentsSub);
      supabase.removeChannel(statsSub);
    };
  }, [fetchAll]);

  const byStatus = (status: string) => agents.filter((a) => a.status === status);
  const byCampaign = (cid: string) => agents.filter((a) => a.campaign_id === cid);

  return { agents, groupStats, campaigns, lastUpdated, byStatus, byCampaign, refetch: fetchAll };
}
