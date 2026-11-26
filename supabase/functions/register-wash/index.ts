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

  const respond = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });

  if (req.method !== "POST") {
    return respond({ error: "Méthode non autorisée." }, 405);
  }

  const authHeader = req.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return respond({ error: "Authentification requise." }, 401);
  }

  try {
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

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return respond({ error: "Session invalide." }, 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single();

    if (profileError || !profile || !profile.is_active) {
      return respond({ error: "Compte inactif ou introuvable." }, 403);
    }

    if (!["employee", "admin"].includes(profile.role)) {
      return respond({ error: "Accès réservé aux employés et administrateurs." }, 403);
    }

    const body = await req.json();

    const vehicleType = body.vehicle_type;
    const paymentMethod = body.payment_method;

    if (!["moto", "small_car", "suv"].includes(vehicleType)) {
      return respond({ error: "Type de véhicule invalide." }, 400);
    }

    if (!["cash", "tmoney", "flooz"].includes(paymentMethod)) {
      return respond({ error: "Mode de paiement invalide." }, 400);
    }

    const { data, error } = await supabase.rpc("register_wash", {
      p_vehicle_type: vehicleType,
      p_payment_method: paymentMethod,
    });

    if (error) {
      console.error("Register wash error:", error);
      return respond({
        error: "Impossible d'enregistrer le lavage.",
      }, 400);
    }

    return respond({
      success: true,
      transaction: data?.[0],
    }, 201);

  } catch (error) {
    console.error("Unexpected error:", error);
    return respond({ error: "Erreur interne du serveur." }, 500);
  }
});
