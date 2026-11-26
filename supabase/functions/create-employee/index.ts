import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://mtprod94-droid.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") {
    return respond({ error: "Méthode non autorisée." }, 405);
  }

  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return respond({ error: "Authentification requise." }, 401);
  }

  const token = authorization.slice(7);

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const userClient = createClient(SUPABASE_URL, ANON_KEY);

  const { data: authData, error: authError } =
    await userClient.auth.getUser(token);

  if (authError || !authData.user) {
    return respond({ error: "Session invalide." }, 401);
  }

  const { data: adminProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .single();

  if (
    profileError ||
    adminProfile?.role !== "admin" ||
    adminProfile?.is_active !== true
  ) {
    return respond({ error: "Accès réservé à l'administrateur." }, 403);
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return respond({ error: "Données invalides." }, 400);
  }

  const username = String(body.username || "").trim();
  const fullName = String(body.full_name || "").trim();
  const phone = String(body.phone || "").trim();
  const password = String(body.password || "");

  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
    return respond({ error: "Nom d'utilisateur invalide." }, 400);
  }

  if (username.toUpperCase() === "BOSS") {
    return respond({ error: "BOSS est réservé à l'administrateur." }, 400);
  }

  if (fullName.length < 2 || fullName.length > 100) {
    return respond({ error: "Nom complet invalide." }, 400);
  }

  if (!phone || !/^\+?[0-9\s().-]{7,20}$/.test(phone)) {
    return respond({ error: "Numéro de téléphone invalide." }, 400);
  }

  const phoneDigits = phone.replace(/\D/g, "");

  if (phoneDigits.length < 8 || phoneDigits.length > 15) {
    return respond({ error: "Le numéro doit contenir entre 8 et 15 chiffres." }, 400);
  }

  if (password.length < 8 || password.length > 72) {
    return respond({ error: "Le mot de passe doit contenir au moins 8 caractères." }, 400);
  }

  const { data: existing } = await adminClient
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .limit(1);

  if (existing && existing.length > 0) {
    return respond({ error: "Ce nom d'utilisateur existe déjà." }, 409);
  }

  const internalEmail =
    `employee-${crypto.randomUUID()}@example.com`;

  const { data: newUser, error: createError } =
    await adminClient.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
    });

  if (createError || !newUser.user) {
    return respond({ error: "Le compte n'a pas pu être créé." }, 400);
  }

  const { error: insertError } = await adminClient
    .from("profiles")
    .insert({
      id: newUser.user.id,
      username,
      full_name: fullName,
      phone,
      role: "employee",
      is_active: true,
    });

  if (insertError) {
    await adminClient.auth.admin.deleteUser(newUser.user.id);
    return respond({ error: "Le profil n'a pas pu être créé." }, 500);
  }

  return respond({
    success: true,
    message: "Employé créé avec succès.",
    employee: {
      username,
      full_name: fullName,
      role: "employee",
    },
  });
});
