"use client";
import { useState, useMemo } from "react";
import { Radio, Phone, Clock, Users, PhoneCall, AlertCircle, Search, Eye, EyeOff, Ear, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useLiveWallboard, type LiveAgent } from "@/hooks/useLiveWallboard";

const STATUS_CFG = {
  INCALL: {
    label: "Σε Κλήση",
    dot: "bg-red-500",
    badge: "bg-red-500/10 text-red-400 border border-red-500/20",
  },
  READY: {
    label: "Διαθέσιμος",
    dot: "bg-green-500",
    badge: "bg-green-500/10 text-green-400 border border-green-500/20",
  },
  PAUSED: {
    label: "Παύση",
    dot: "bg-yellow-500",
    badge: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
  },
  DISPO: {
    label: "Αποτέλεσμα",
    dot: "bg-blue-500",
    badge: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  },
} as const;

function getStatusCfg(s: string) {
  return (
    STATUS_CFG[s as keyof typeof STATUS_CFG] ?? {
      label: s,
      dot: "bg-zinc-500",
      badge: "bg-zinc-700/50 text-zinc-400 border border-zinc-600/20",
    }
  );
}

export default function LiveWallboardTab() {
  const { agents: rawAgents, groupStats, campaigns, lastUpdated } = useLiveWallboard();
  const [agents, setAgents] = useState(rawAgents);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [monitoringAgent, setMonitoringAgent] = useState<string | null>(null);

  async function handleListen(agent: LiveAgent) {
    try {
      const res = await fetch("/api/monitor-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id:  agent.session_id,
          phone_login: agent.session_id,
          server_ip:   "10.1.0.21",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMonitoringAgent(agent.full_name);
        setTimeout(() => setMonitoringAgent(null), 10000);
      } else {
        alert("Monitor error: " + data.response);
      }
    } catch (err) {
      console.error("Monitor error:", err);
    }
  }

  // Sync hook data into local state (preserves optimistic monitored toggles)
  useMemo(() => {
    setAgents(prev => rawAgents.map(a => ({
      ...a,
      monitored: prev.find(p => p.user_vicidial === a.user_vicidial)?.monitored ?? a.monitored,
    })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawAgents]);

  async function toggleMonitor(username: string, current: boolean) {
    setAgents(prev => prev.map(a =>
      a.user_vicidial === username ? { ...a, monitored: !current } : a
    ));
    const { error } = await supabase
      .from("live_agents")
      .update({ monitored: !current })
      .eq("user_vicidial", username);
    if (error) {
      setAgents(prev => prev.map(a =>
        a.user_vicidial === username ? { ...a, monitored: current } : a
      ));
      console.error("Toggle error:", error.message);
    }
  }
  const [campaignFilter, setCampaignFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return agents.filter((a) => {
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (campaignFilter !== "ALL" && a.campaign_id !== campaignFilter) return false;
      if (
        search &&
        !a.user_vicidial.toLowerCase().includes(search.toLowerCase()) &&
        !a.full_name.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [agents, statusFilter, campaignFilter, search]);

  const uniqueCampaigns = useMemo(
    () =>
      Array.from(new Set(agents.map((a) => a.campaign_id))).map((cid) => ({
        id: cid,
        name: agents.find((a) => a.campaign_id === cid)?.campaign_name ?? cid,
      })),
    [agents]
  );

  const activeCampaigns = campaigns.filter((c) => c.total_agents > 0);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Radio className="w-5 h-5 text-red-400 animate-pulse" />
          Live Wallboard
        </h2>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          {lastUpdated
            ? `Ανανεώθηκε: ${lastUpdated.toLocaleTimeString("el-GR")}`
            : "Σύνδεση..."}
        </div>
      </div>

      {/* Group Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          {
            label: "ΣΥΝΔΕΔΕΜΕΝΟΙ",
            value: groupStats?.agents_logged_in ?? agents.length,
            icon: Users,
            color: "white",
          },
          {
            label: "ΣΕ ΚΛΗΣΗ",
            value: groupStats?.agents_in_calls ?? 0,
            icon: Phone,
            color: "red",
          },
          {
            label: "ΔΙΑΘΕΣΙΜΟΙ",
            value: groupStats?.agents_waiting ?? 0,
            icon: PhoneCall,
            color: "green",
          },
          {
            label: "ΠΑΥΣΗ",
            value: groupStats?.agents_paused ?? 0,
            icon: Clock,
            color: "yellow",
          },
          {
            label: "ΟΥΡΑ ΚΛΗΣΕΩΝ",
            value: groupStats?.calls_waiting ?? 0,
            icon: AlertCircle,
            color: "orange",
          },
          {
            label: "ΥΠΟ ΠΑΡΑΚΟΛΟΥΘΗΣΗ",
            value: agents.filter(a => a.monitored).length,
            icon: Eye,
            color: "indigo",
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-2"
          >
            <p className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
              {label}
            </p>
            <p
              className={`text-3xl font-bold ${
                color === "red"
                  ? "text-red-400"
                  : color === "green"
                  ? "text-green-400"
                  : color === "yellow"
                  ? "text-yellow-400"
                  : color === "orange"
                  ? "text-orange-400"
                  : color === "indigo"
                  ? "text-indigo-400"
                  : "text-white"
              }`}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Campaign Cards */}
      {activeCampaigns.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {activeCampaigns.map((c) => (
            <div
              key={c.campaign_id}
              onClick={() =>
                setCampaignFilter(
                  campaignFilter === c.campaign_id ? "ALL" : c.campaign_id
                )
              }
              className={`bg-zinc-900 border rounded-xl p-4 cursor-pointer transition-all ${
                campaignFilter === c.campaign_id
                  ? "border-indigo-500/50 bg-indigo-500/5"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium text-zinc-500 uppercase">
                    {c.campaign_id}
                  </p>
                  <p className="text-sm font-semibold text-white truncate">
                    {c.campaign_name}
                  </p>
                </div>
                <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-lg shrink-0 ml-2">
                  {c.dial_method}
                </span>
              </div>
              <div className="flex gap-3 text-xs">
                <span className="text-red-400 font-bold">
                  {c.incall_agents} κλήση
                </span>
                <span className="text-green-400">{c.ready_agents} διαθ.</span>
                <span className="text-yellow-400">{c.paused_agents} παύση</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Status pills */}
        <div className="flex gap-1.5">
          {[
            { key: "ALL",    label: "Όλα" },
            { key: "INCALL", label: "🔴 Σε Κλήση" },
            { key: "READY",  label: "🟢 Διαθέσιμος" },
            { key: "PAUSED", label: "🟡 Παύση" },
            { key: "DISPO",  label: "🔵 Αποτέλεσμα" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === key
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-zinc-800" />

        {/* Campaign filter */}
        <select
          value={campaignFilter}
          onChange={(e) => setCampaignFilter(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="ALL">Όλα τα Campaigns</option>
          {uniqueCampaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} — {c.name}
            </option>
          ))}
        </select>

        <div className="h-5 w-px bg-zinc-800" />

        {/* Batch monitor buttons */}
        <button
          onClick={async () => {
            const usernames = filtered.map(a => a.user_vicidial);
            setAgents(prev => prev.map(a =>
              usernames.includes(a.user_vicidial) ? { ...a, monitored: true } : a
            ));
            await supabase.from("live_agents")
              .update({ monitored: true })
              .in("user_vicidial", usernames);
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-600/20 transition-all flex items-center gap-1.5"
        >
          <Eye className="w-3.5 h-3.5" /> Monitor All
        </button>

        <button
          onClick={async () => {
            const usernames = filtered.map(a => a.user_vicidial);
            setAgents(prev => prev.map(a =>
              usernames.includes(a.user_vicidial) ? { ...a, monitored: false } : a
            ));
            await supabase.from("live_agents")
              .update({ monitored: false })
              .in("user_vicidial", usernames);
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-400 hover:text-white transition-all flex items-center gap-1.5"
        >
          <EyeOff className="w-3.5 h-3.5" /> Καθαρισμός
        </button>

        <span className="text-xs text-indigo-400 font-medium">
          {agents.filter(a => a.monitored).length} monitored
        </span>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Αναζήτηση agent..."
            className="bg-zinc-800 border border-zinc-700 rounded-lg pl-9 pr-4 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-48"
          />
        </div>

        <span className="text-xs text-zinc-600">{filtered.length} agents</span>
      </div>

      {/* Agents Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              {[
                "Status",
                "Agent",
                "Campaign",
                "Κλήσεις Σήμερα",
                "Lead ID",
                "Τηλέφωνο",
                "Πελάτης",
              ].map((h) => (
                <th
                  key={h}
                  className="text-left py-3 px-4 text-[10px] font-medium uppercase tracking-widest text-zinc-500"
                >
                  {h}
                </th>
              ))}
              <th className="text-center py-3 px-4 text-[10px] font-medium uppercase tracking-widest text-zinc-500 w-28">
                QA Monitor
              </th>
              <th className="text-center py-3 px-4 text-[10px] font-medium uppercase tracking-widest text-zinc-500 w-24">
                Ακρόαση
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/40">
            {filtered.map((agent) => {
              const sc = getStatusCfg(agent.status);
              return (
                <tr
                  key={agent.user_vicidial}
                  className="hover:bg-zinc-800/20 transition-colors"
                >
                  {/* Status */}
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${sc.badge}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${
                          agent.status === "INCALL" ? "animate-pulse" : ""
                        }`}
                      />
                      {sc.label}
                    </span>
                  </td>
                  {/* Agent */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 bg-indigo-600/20 rounded-lg flex items-center justify-center text-xs font-bold text-indigo-400 shrink-0">
                        {(agent.full_name || agent.user_vicidial)
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                      <div>
                        <p className="text-zinc-200 font-medium text-xs">
                          {agent.full_name || agent.user_vicidial}
                          {agent.monitored && (
                            <span className="ml-1.5 text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded-full">
                              🎯
                            </span>
                          )}
                        </p>
                        <p className="text-zinc-600 text-[10px]">
                          @{agent.user_vicidial}
                        </p>
                      </div>
                    </div>
                  </td>
                  {/* Campaign */}
                  <td className="py-3 px-4">
                    <div>
                      <p className="text-zinc-300 text-xs font-medium">
                        {agent.campaign_name}
                      </p>
                      <p className="text-zinc-600 text-[10px]">
                        #{agent.campaign_id}
                      </p>
                    </div>
                  </td>
                  {/* Calls today */}
                  <td className="py-3 px-4">
                    <span className="text-zinc-300 font-semibold">
                      {agent.calls_today}
                    </span>
                  </td>
                  {/* Lead ID */}
                  <td className="py-3 px-4">
                    {agent.lead_id && agent.lead_id !== "0" ? (
                      <a
                        href={`http://10.1.0.21/vicidial/admin_modify_lead.php?lead_id=${encodeURIComponent(agent.lead_id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 text-xs font-mono underline underline-offset-2 transition-colors"
                      >
                        #{agent.lead_id}
                      </a>
                    ) : (
                      <span className="text-zinc-700 text-xs">—</span>
                    )}
                  </td>
                  {/* Phone */}
                  <td className="py-3 px-4">
                    <span className="text-zinc-300 text-xs font-mono">
                      {agent.phone_number ??
                        (agent.callerid ? agent.callerid.slice(-10) : "—")}
                    </span>
                  </td>
                  {/* Customer name */}
                  <td className="py-3 px-4">
                    {agent.lead_first_name || agent.lead_last_name ? (
                      <span className="text-zinc-300 text-xs">
                        {[agent.lead_first_name, agent.lead_last_name]
                          .filter(Boolean)
                          .join(" ")}
                      </span>
                    ) : (
                      <span className="text-zinc-700 text-xs">—</span>
                    )}
                  </td>
                  {/* QA Monitor toggle */}
                  <td className="py-3 px-4 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <button
                        onClick={() => toggleMonitor(agent.user_vicidial, agent.monitored ?? false)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                          agent.monitored ? "bg-indigo-600" : "bg-zinc-700 hover:bg-zinc-600"
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                          agent.monitored ? "translate-x-6" : "translate-x-1"
                        }`} />
                      </button>
                      {agent.monitored && (
                        <span className="text-[10px] text-indigo-400">🎯 Active</span>
                      )}
                    </div>
                  </td>
                  {/* Ακρόαση */}
                  <td className="py-3 px-4 text-center">
                    {agent.status === "INCALL" ? (
                      <button
                        onClick={() => handleListen(agent)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-600/20 transition-all"
                      >
                        <Ear className="w-3.5 h-3.5" />
                        Ακρόαση
                      </button>
                    ) : (
                      <span className="text-zinc-700 text-xs">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <Radio className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-600 text-sm">Δεν βρέθηκαν agents</p>
          </div>
        )}
      </div>

      {/* Monitoring toast */}
      {monitoringAgent && (
        <div className="fixed bottom-6 right-6 z-50 bg-indigo-950 border border-indigo-700 rounded-2xl px-5 py-4 shadow-2xl flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600/20 rounded-xl flex items-center justify-center">
            <Ear className="w-4 h-4 text-indigo-400 animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Ακρόαση ενεργή</p>
            <p className="text-xs text-indigo-400">{monitoringAgent}</p>
          </div>
          <button
            onClick={() => setMonitoringAgent(null)}
            className="ml-2 text-zinc-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
