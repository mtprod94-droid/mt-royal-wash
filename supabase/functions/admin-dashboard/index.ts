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
    return jsonResponse({
      success: false,
      message: "Method not allowed",
    }, 405);
  }

  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({
      success: false,
      message: "Unauthorized",
    }, 401);
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

  // ADMIN AUTHENTICATION

  const token = authorization.replace("Bearer ", "");

  const { data: authData, error: authError } =
    await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    return jsonResponse({
      success: false,
      message: "Invalid session",
    }, 401);
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
    return jsonResponse({
      success: false,
      message: "Access denied",
    }, 403);
  }

  // DATE CALCULATIONS - UTC / TOGO

  const now = new Date();

  const startOfDay = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  );

  const startOfNextDay = new Date(
    startOfDay.getTime() + 86400000
  );

  // WEEK STARTS MONDAY

  const startOfWeek = new Date(startOfDay);

  const dayOfWeek = startOfWeek.getUTCDay();

  const daysSinceMonday = (dayOfWeek + 6) % 7;

  startOfWeek.setUTCDate(
    startOfWeek.getUTCDate() - daysSinceMonday
  );

  const startOfNextWeek = new Date(
    startOfWeek.getTime() + 7 * 86400000
  );

  // MONTH

  const startOfMonth = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      1
    )
  );

  const startOfNextMonth = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      1
    )
  );

  // LOAD TRANSACTIONS

  const { data: transactions, error: transactionError } =
    await supabase
      .from("transactions")
      .select("amount, payment_method, created_at")
      .eq("status", "completed")
      .gte("created_at", startOfMonth.toISOString())
      .lt("created_at", startOfNextDay.toISOString());

  if (transactionError) {
    return jsonResponse({
      success: false,
      message: "Could not load transactions",
      details: transactionError.message,
    }, 500);
  }

  // LOAD EXPENSES

  const { data: expenses, error: expenseError } =
    await supabase
      .from("expenses")
      .select("amount, created_at")
      .gte("created_at", startOfMonth.toISOString())
      .lt("created_at", startOfNextDay.toISOString());

  if (expenseError) {
    return jsonResponse({
      success: false,
      message: "Could not load expenses",
      details: expenseError.message,
    }, 500);
  }

  // STATISTICS CALCULATION

  const calculateStats = (
    start: Date,
    end: Date
  ) => {

    const periodTransactions = (transactions ?? []).filter(
      (item) => {
        const date = new Date(item.created_at);

        return date >= start && date < end;
      }
    );

    const periodExpenses = (expenses ?? []).filter(
      (item) => {
        const date = new Date(item.created_at);

        return date >= start && date < end;
      }
    );

    const revenue = periodTransactions.reduce(
      (sum, item) =>
        sum + Number(item.amount || 0),
      0
    );

    const totalExpenses = periodExpenses.reduce(
      (sum, item) =>
        sum + Number(item.amount || 0),
      0
    );

    const paymentTotals = {
      cash: 0,
      tmoney: 0,
      flooz: 0,
    };

    periodTransactions.forEach((item) => {

      const method = String(
        item.payment_method || ""
      ).toLowerCase();

      if (
        method === "cash" ||
        method === "tmoney" ||
        method === "flooz"
      ) {
        paymentTotals[
          method as keyof typeof paymentTotals
        ] += Number(item.amount || 0);
      }

    });

    return {
      revenue,
      expenses: totalExpenses,
      profit: revenue - totalExpenses,
      washes: periodTransactions.length,
      paymentTotals,
    };

  };

  // ALL THREE PERIODS

  const today = calculateStats(
    startOfDay,
    startOfNextDay
  );

  const week = calculateStats(
    startOfWeek,
    startOfNextWeek
  );

  const month = calculateStats(
    startOfMonth,
    startOfNextMonth
  );

  // LAST VEHICLES

  const { data: vehicles, error: vehicleError } =
    await supabase
      .from("vehicles")
      .select(
        "id, vehicle_type, price, created_at, employee_id"
      )
      .order("created_at", { ascending: false })
      .limit(100);

  if (vehicleError) {
    return jsonResponse({
      success: false,
      message: "Could not load vehicles",
      details: vehicleError.message,
    }, 500);
  }

  // RESPONSE

  return jsonResponse({

    success: true,

    stats: {

      // BACKWARD COMPATIBILITY

      dailyRevenue: today.revenue,
      dailyWashes: today.washes,
      dailyExpenses: today.expenses,
      dailyProfit: today.profit,

      paymentTotals: today.paymentTotals,

      // NEW STATISTICS

      today,
      week,
      month,

    },

    vehicles: vehicles ?? [],

  });

});