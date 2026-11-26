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

  const jsonHeaders = {
    ...corsHeaders,
    "Content-Type": "application/json",
  };

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Méthode non autorisée." }),
        { status: 405, headers: jsonHeaders }
      );
    }

    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentification requise." }),
        { status: 401, headers: jsonHeaders }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return new Response(
        JSON.stringify({ error: "Session invalide." }),
        { status: 401, headers: jsonHeaders }
      );
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
      profile.role !== "employee" ||
      profile.is_active !== true
    ) {
      return new Response(
        JSON.stringify({ error: "Accès refusé." }),
        { status: 403, headers: jsonHeaders }
      );
    }

    const { data: transactions, error: transactionError } =
      await supabase
        .from("transactions")
        .select("id, transaction_number, vehicle_id, amount, payment_method, created_at")
        .eq("employee_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);

    if (transactionError) {
      throw transactionError;
    }

    const vehicleIds = [
      ...new Set(
        (transactions || [])
          .map((transaction) => transaction.vehicle_id)
          .filter(Boolean)
      ),
    ];

    let vehicles: any[] = [];

    if (vehicleIds.length > 0) {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, vehicle_type")
        .in("id", vehicleIds);

      if (error) {
        throw error;
      }

      vehicles = data || [];
    }

    const vehicleMap = new Map(
      vehicles.map((vehicle) => [vehicle.id, vehicle.vehicle_type])
    );
    const today = new Date();
const startOfDay = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate()
).toISOString();

const tomorrow = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate() + 1
).toISOString();

const { data: dailyTransactions, error: dailyError } = await supabase
  .from("transactions")
  .select("amount")
  .eq("employee_id", userId)
  .eq("status", "completed")
  .gte("created_at", startOfDay)
  .lt("created_at", tomorrow);

if (dailyError) {
  throw dailyError;
}

const dailyWashes = dailyTransactions?.length || 0;

const dailyRevenue = (dailyTransactions || []).reduce(
  (total, transaction) => total + Number(transaction.amount),
  0
);

    const history = (transactions || []).map((transaction) => ({
      ...transaction,
      vehicle_type: vehicleMap.get(transaction.vehicle_id) || "Inconnu",
    }));

    return new Response(
  JSON.stringify({
    success: true,
    history,
    stats: {
      dailyWashes,
      dailyRevenue
    }
  }),
  { status: 200, headers: jsonHeaders }
);

  } catch (error) {
    console.error("Employee history error:", error);

    return new Response(
      JSON.stringify({ error: "Impossible de charger l'historique." }),
      { status: 500, headers: jsonHeaders }
    );
  }
});
