import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { session_id, phone_login, server_ip } = await req.json()

    if (!session_id || !phone_login) {
      return NextResponse.json({ success: false, response: "Missing params" }, { status: 400 });
    }

    const VICIDIAL_URL  = process.env.VICIDIAL_URL  || "http://10.1.0.21/vicidial";
    const VICIDIAL_USER = process.env.VICIDIAL_USER || "6000";
    const VICIDIAL_PASS = process.env.VICIDIAL_PASS || "6000";
    const SERVER_IP     = server_ip || process.env.VICIDIAL_SERVER_IP || "10.1.0.21";

    const url =
      `${VICIDIAL_URL}/non_agent_api.php` +
      `?function=blind_monitor` +
      `&user=${VICIDIAL_USER}` +
      `&pass=${VICIDIAL_PASS}` +
      `&source=agent_assist` +
      `&phone_login=${encodeURIComponent(phone_login)}` +
      `&session_id=${encodeURIComponent(session_id)}` +
      `&server=${SERVER_IP}` +
      `&stage=MONITOR`;

    const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = await res.text();

    const success =
      text.toLowerCase().includes("success") ||
      text.toLowerCase().includes("monitor");

    return NextResponse.json({ success, response: text.trim() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, response: message }, { status: 500 });
  }
}
