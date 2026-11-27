import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://mtprod94-droid.github.io",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
    return jsonResponse(
      { success: false, message: "Method not allowed" },
      405
    );
  }

  // Authentication
  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse(
      { success: false, message: "Unauthorized" },
      401
    );
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
    return jsonResponse(
      { success: false, message: "Invalid session" },
      401
    );
  }

  // Admin authorization
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
    return jsonResponse(
      { success: false, message: "Access denied" },
      403
    );
  }

  // Date calculations (UTC)
  const now = new Date();

  const startOfDay = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    )
  );

  const startOfNextDay = new Date(
    startOfDay.getTime() + 24 * 60 * 60 * 1000
  );

  // Week starts on Monday
  const dayOfWeek = startOfDay.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;

  const startOfWeek = new Date(
    startOfDay.getTime() -
      daysSinceMonday * 24 * 60 * 60 * 1000
  );

  const startOfNextWeek = new Date(
    startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000
  );

  // Month starts on the first day
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

  // Fetch from the earliest required period.
  // This also covers weeks crossing a month boundary.
  const queryStart =
    startOfWeek.getTime() < startOfMonth.getTime()
      ? startOfWeek
      : startOfMonth;

  const queryStartISO = queryStart.toISOString();
  const queryEndISO = startOfNextDay.toISOString();

  // Load completed transactions
  const { data: transactions, error: transactionError } =
    await supabase
      .from("transactions")
      .select("amount, payment_method, created_at")
      .eq("status", "completed")
      .gte("created_at", queryStartISO)
      .lt("created_at", queryEndISO);

  if (transactionError) {
    return jsonResponse(
      {
        success: false,
        message: "Could not load transactions",
        details: transactionError.message,
      },
      500
    );
  }

  // Load expenses
  const { data: expenses, error: expenseError } =
    await supabase
      .from("expenses")
      .select("amount, created_at")
      .gte("created_at", queryStartISO)
      .lt("created_at", queryEndISO);

  if (expenseError) {
    return jsonResponse(
      {
        success: false,
        message: "Could not load expenses",
        details: expenseError.message,
      },
      500
    );
  }

  const transactionList = transactions ?? [];
  const expenseList = expenses ?? [];

  // Calculate statistics for a specific period
  const calculateStats = (
    periodStart: Date,
    periodEnd: Date
  ) => {
    const periodTransactions = transactionList.filter((item) => {
      const createdAt = new Date(item.created_at).getTime();

      return (
        createdAt >= periodStart.getTime() &&
        createdAt < periodEnd.getTime()
      );
    });

    const periodExpenses = expenseList.filter((item) => {
      const createdAt = new Date(item.created_at).getTime();

      return (
        createdAt >= periodStart.getTime() &&
        createdAt < periodEnd.getTime()
      );
    });

    const revenue = periodTransactions.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    const totalExpenses = periodExpenses.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    return {
      revenue,
      washes: periodTransactions.length,
      expenses: totalExpenses,
      profit: revenue - totalExpenses,
    };
  };

  // Calculate today, week and month
  const todayStats = calculateStats(
    startOfDay,
    startOfNextDay
  );

  const weekStats = calculateStats(
    startOfWeek,
    startOfNextWeek
  );

  const monthStats = calculateStats(
    startOfMonth,
    startOfNextDay
  );

  // Payment methods for today
  const todayTransactions = transactionList.filter((item) => {
    const createdAt = new Date(item.created_at).getTime();

    return (
      createdAt >= startOfDay.getTime() &&
      createdAt < startOfNextDay.getTime()
    );
  });

  const paymentTotals = {
    cash: 0,
    tmoney: 0,
    flooz: 0,
  };

  for (const transaction of todayTransactions) {
    const method = String(
      transaction.payment_method || ""
    ).toLowerCase();

    const amount = Number(transaction.amount || 0);

    if (method === "cash") {
      paymentTotals.cash += amount;
    } else if (method === "tmoney") {
      paymentTotals.tmoney += amount;
    } else if (method === "flooz") {
      paymentTotals.flooz += amount;
    }
  }

  // Load latest vehicles
  const { data: vehicles, error: vehicleError } =
    await supabase
      .from("vehicles")
      .select(
        "id, vehicle_type, price, created_at, employee_id"
      )
      .order("created_at", { ascending: false })
      .limit(100);

  if (vehicleError) {
    return jsonResponse(
      {
        success: false,
        message: "Could not load vehicles",
        details: vehicleError.message,
      },
      500
    );
  }

  // Response
  return jsonResponse({
    success: true,

    stats: {
      // New statistics
      today: todayStats,
      week: weekStats,
      month: monthStats,

      // Payment methods for today
      paymentTotals,

      // Legacy fields for compatibility
      dailyRevenue: todayStats.revenue,
      dailyWashes: todayStats.washes,
      dailyExpenses: todayStats.expenses,
      dailyProfit: todayStats.profit,
    },

    vehicles: vehicles ?? [],
  });
});