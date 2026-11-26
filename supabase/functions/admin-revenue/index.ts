import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://mtprod94-droid.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  const jsonResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, message: "Method not allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ success: false, message: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    }
  );

  const token = authorization.replace("Bearer ", "");

  const { data: authData, error: authError } =
    await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    return jsonResponse({ success: false, message: "Invalid session" }, 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .single();

  if (
    profileError ||
    !profile ||
    profile.role !== "admin" ||
    profile.is_active !== true
  ) {
    return jsonResponse({ success: false, message: "Access denied" }, 403);
  }

  const now = new Date();

  const today = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));

  const weekStart = new Date(today);
  const day = weekStart.getUTCDay();
  weekStart.setUTCDate(weekStart.getUTCDate() - (day === 0 ? 6 : day - 1));

  const monthStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1
  ));

  const transactions = [];
const pageSize = 1000;
let from = 0;

while (true) {
  const { data: page, error: transactionError } = await supabase
    .from("transactions")
    .select("id, transaction_number, vehicle_id, employee_id, amount, payment_method, status, created_at")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (transactionError) {
    return jsonResponse({
      success: false,
      message: "Could not load transactions",
      details: transactionError.message,
    }, 500);
  }

  transactions.push(...(page ?? []));

  if (!page || page.length < pageSize) {
    break;
  }

  from += pageSize;
}

const records = transactions;


const sum = (items: typeof records) =>
    items.reduce((total, item) => total + Number(item.amount || 0), 0);

  const todayRecords = records.filter(
    item => new Date(item.created_at) >= today
  );

  const weekRecords = records.filter(
    item => new Date(item.created_at) >= weekStart
  );

  const monthRecords = records.filter(
    item => new Date(item.created_at) >= monthStart
  );

  const paymentSummary = {
    cash: 0,
    tmoney: 0,
    flooz: 0,
  };

  records.forEach(item => {
    const method = item.payment_method as keyof typeof paymentSummary;

    if (method in paymentSummary) {
      paymentSummary[method] += Number(item.amount || 0);
    }
  });

  const vehicleIds = [...new Set(records.map(item => item.vehicle_id).filter(Boolean))];
  const employeeIds = [...new Set(records.map(item => item.employee_id).filter(Boolean))];

  const { data: vehicles, error: vehicleError } = vehicleIds.length
    ? await supabase
        .from("vehicles")
        .select("id, vehicle_type")
        .in("id", vehicleIds)
    : { data: [], error: null };

  if (vehicleError) {
    return jsonResponse({
      success: false,
      message: "Could not load vehicle details",
    }, 500);
  }

  const { data: employees, error: employeeError } = employeeIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, username")
        .in("id", employeeIds)
    : { data: [], error: null };

  if (employeeError) {
    return jsonResponse({
      success: false,
      message: "Could not load employee details",
    }, 500);
  }

  const vehicleMap = new Map(
    (vehicles ?? []).map(item => [item.id, item.vehicle_type])
  );

  const employeeMap = new Map(
    (employees ?? []).map(item => [item.id, item.full_name || item.username])
  );

  const history = records.slice(0, 100).map(item => ({
    transaction_number: item.transaction_number,
    vehicle_type: (item.vehicle_id ? vehicleMap.get(item.vehicle_id) : undefined) || "Inconnu",
    amount: item.amount,
    payment_method: item.payment_method,
    created_at: item.created_at,
    employee: (item.employee_id ? employeeMap.get(item.employee_id) : undefined) || "Inconnu",
  }));

  return jsonResponse({
    success: true,
    totals: {
      allTime: sum(records),
      today: sum(todayRecords),
      week: sum(weekRecords),
      month: sum(monthRecords),
    },
    paymentSummary,
    history,
    totalTransactions: records.length,
  });
});
