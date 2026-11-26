import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://mtprod94-droid.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Méthode non autorisée." }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Configuration serveur manquante.");
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const { data, error } = await supabase
      .from("profiles")
      .select("username, full_name")
      .eq("is_active", true)
      .neq("role", "admin");

    if (error) {
      throw error;
    }

    const users = (data || []).sort((a, b) => {
      if (a.username === "BOSS") return -1;
      if (b.username === "BOSS") return 1;

      return (a.full_name || a.username).localeCompare(
        b.full_name || b.username,
      );
    });

    return new Response(
      JSON.stringify({ users }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );

  } catch (error) {
    console.error("list-users error:", error);

    return new Response(
      JSON.stringify({ error: "Impossible de charger les utilisateurs." }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
