import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://mtprod94-droid.github.io",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const respond = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  if (req.method !== "GET") {
    return respond({ error: "Méthode non autorisée." }, 405);
  }

  const authHeader = req.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return respond({ error: "Authentification requise." }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      console.error("SUPABASE_SERVICE_ROLE_KEY is missing.");
      return respond({ error: "Configuration serveur incomplète." }, 500);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return respond({ error: "Session invalide." }, 401);
    }

    const { data: adminProfile, error: adminError } = await authClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single();

    if (
      adminError ||
      !adminProfile ||
      adminProfile.role !== "admin" ||
      !adminProfile.is_active
    ) {
      return respond(
        { error: "Accès réservé à l'administrateur actif." },
        403,
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: employees, error: employeesError } = await adminClient
      .from("profiles")
      .select("id, username, full_name, phone, is_active, created_at")
      .eq("role", "employee")
      .order("created_at", { ascending: false });

    if (employeesError) {
      console.error("Employee list error:", employeesError);
      return respond(
        { error: "Impossible de charger les employés." },
        500,
      );
    }

    return respond({
      success: true,
      users: employees || [],
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return respond({ error: "Erreur interne du serveur." }, 500);
  }
});
