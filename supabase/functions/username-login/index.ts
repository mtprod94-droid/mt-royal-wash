import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (data: object, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const { username, password } = await req.json();

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !username.trim() ||
      !password
    ) {
      return json({ error: "Invalid username or password" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const adminClient = createClient(url, serviceKey);

    // IP-Adresse aus der Anfrage ermitteln
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";

    const normalizedUsername = username.trim();

    // Prüfen, ob die Anmeldung gesperrt ist
    const { data: allowed, error: checkError } =
      await adminClient.rpc("check_login_allowed", {
        p_username: normalizedUsername,
        p_ip: ip,
      });

    if (checkError) {
      return json({ error: "Login temporarily unavailable" }, 503);
    }

    if (allowed !== true) {
      return json({ error: "Too many attempts. Try again later." }, 429);
    }

    // Benutzer anhand seines Benutzernamens suchen
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id, username, role, is_active")
      .eq("username", normalizedUsername)
      .maybeSingle();

    if (profileError || !profile || profile.is_active !== true) {
      await adminClient.rpc("record_login_failure", {
        p_username: normalizedUsername,
        p_ip: ip,
      });

      return json({ error: "Invalid username or password" }, 401);
    }

    // Zugehöriges Auth-Konto abrufen
    const { data: userData, error: userError } =
      await adminClient.auth.admin.getUserById(profile.id);

    if (userError || !userData.user?.email) {
      await adminClient.rpc("record_login_failure", {
        p_username: normalizedUsername,
        p_ip: ip,
      });

      return json({ error: "Invalid username or password" }, 401);
    }

    // Passwort über Supabase Auth überprüfen
    const loginClient = createClient(url, anonKey);

    const { data, error } = await loginClient.auth.signInWithPassword({
      email: userData.user.email,
      password,
    });

    if (error || !data.session) {
      await adminClient.rpc("record_login_failure", {
        p_username: normalizedUsername,
        p_ip: ip,
      });

      return json({ error: "Invalid username or password" }, 401);
    }

    // Fehlversuche nach erfolgreicher Anmeldung zurücksetzen
    const { error: clearError } = await adminClient.rpc(
      "clear_login_attempts",
      {
        p_username: normalizedUsername,
        p_ip: ip,
      },
    );

    if (clearError) {
      return json({ error: "Login temporarily unavailable" }, 503);
    }

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      token_type: data.session.token_type,
      expires_in: data.session.expires_in,
      user: {
        id: data.user.id,
        username: profile.username,
        role: profile.role,
      },
    });
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
});
