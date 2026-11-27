import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://mtprod94-droid.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const jsonResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

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

  const userId = authData.user.id;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", userId)
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
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const startOfNextDay = new Date(
    startOfDay.getTime() + 24 * 60 * 60 * 1000
  );

  const start = startOfDay.toISOString();
  const end = startOfNextDay.toISOString();

  const { data: transactions, error: transactionError } = await supabase
    .from("transactions")
    .select("amount, created_at, payment_method")
    .eq("status", "completed")
    .gte("created_at", start)
    .lt("created_at", end);

  if (transactionError) {
    return jsonResponse({
      success: false,
      message: "Could not load transactions",
      details: transactionError.message,
    }, 500);
  }

  const { data: expenses, error: expenseError } = await supabase
    .from("expenses")
    .select("amount, created_at")
    .gte("created_at", start)
    .lt("created_at", end);

  if (expenseError) {
    return jsonResponse({
      success: false,
      message: "Could not load expenses",
      details: expenseError.message,
    }, 500);
  }

  const dailyRevenue = (transactions ?? []).reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );

const paymentTotals = (transactions ?? []).reduce(
  (totals, item) => {
    const method = item.payment_method;

    if (method === "cash") totals.cash += Number(item.amount || 0);
    if (method === "tmoney") totals.tmoney += Number(item.amount || 0);
    if (method === "flooz") totals.flooz += Number(item.amount || 0);

    return totals;
  },
  { cash: 0, tmoney: 0, flooz: 0 }
);

  const dailyWashes = (transactions ?? []).length;

  const dailyExpenses = (expenses ?? []).reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );

  const dailyProfit = dailyRevenue - dailyExpenses;

    const { data: vehicles, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id, vehicle_type, price, created_at, employee_id")
    .order("created_at", { ascending: false })
    .limit(100);

  if (vehicleError) {
    return jsonResponse({
      success: false,
      message: "Could not load vehicles",
      details: vehicleError.message,
    }, 500);
  }

  return jsonResponse({
    success: true,
    stats: {
      dailyRevenue,
      paymentTotals,
      dailyWashes,
      dailyExpenses,
      dailyProfit,
    },
    vehicles: vehicles ?? [],
  });
});
