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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      console.error("SUPABASE_SERVICE_ROLE_KEY is missing.");
      return respond({ error: "Configuration serveur incomplète." }, 500);
    }

    // Admin-Sitzung überprüfen
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

    // Admin-Profil überprüfen
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
      return respond({ error: "Accès réservé à l'administrateur actif." }, 403);
    }

    const body = await req.json();

    const employeeId = body.employee_id;
    const isActive = body.is_active;

    if (
      typeof employeeId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(employeeId)
    ) {
      return respond({ error: "Identifiant employé invalide." }, 400);
    }

    if (typeof isActive !== "boolean") {
      return respond({ error: "Statut invalide." }, 400);
    }

    // Eigenes Administratorkonto schützen
    if (employeeId === user.id) {
      return respond({ error: "Votre compte administrateur ne peut pas être modifié ici." }, 403);
    }

    // Geschützte serverseitige Datenbankverbindung
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

// Ausschließlich Mitarbeiterkonten ändern
const { data: employee, error: employeeError } = await adminClient
  .from("profiles")
  .select("id, username, full_name, phone, is_active")
  .eq("id", employeeId)
  .eq("role", "employee")
  .maybeSingle();

if (employeeError || !employee) {
  return respond({ error: "Employé introuvable." }, 404);
}

// Mitarbeiterkonto in Supabase Auth sperren oder entsperren
const { error: authUpdateError } =
  await adminClient.auth.admin.updateUserById(employeeId, {
    ban_duration: isActive ? "none" : "876000h",
  });

if (authUpdateError) {
  console.error("Auth status update error:", authUpdateError);
  return respond(
    { error: "Impossible de modifier l'accès au compte." },
    500,
  );
}

// Profilstatus aktualisieren
const { data: updatedEmployee, error: updateError } = await adminClient
  .from("profiles")
  .update({ is_active: isActive })
  .eq("id", employeeId)
  .eq("role", "employee")
  .select("id, username, full_name, phone, is_active")
  .maybeSingle();

if (updateError || !updatedEmployee) {
  console.error("Employee profile update error:", updateError);
  return respond(
    { error: "Impossible de modifier le statut du profil." },
    500,
  );
}

return respond({
  success: true,
  employee: updatedEmployee,
  message: isActive
    ? "Employé activé avec succès."
    : "Employé désactivé avec succès.",
});

  } catch (error) {
    console.error("Unexpected error:", error);
    return respond({ error: "Erreur interne du serveur." }, 500);
  }
});
