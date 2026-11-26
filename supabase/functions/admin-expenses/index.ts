import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://mtprod94-droid.github.io",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(
      { success: false, message: "Method not allowed" },
      405,
    );
  }

  try {
    const authorization = req.headers.get("Authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return jsonResponse(
        { success: false, message: "Unauthorized" },
        401,
      );
    }

    const token = authorization.replace("Bearer ", "");

    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
      },
    );

    const { data: authData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !authData.user) {
      return jsonResponse(
        { success: false, message: "Invalid session" },
        401,
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", authData.user.id)
      .single();

    if (
      profileError ||
      profile?.role !== "admin" ||
      profile?.is_active !== true
    ) {
      return jsonResponse(
        { success: false, message: "Admin access required" },
        403,
      );
    }

    if (req.method === "GET") {
      const { data: expenses, error } = await supabase
        .from("expenses")
        .select("id, category, description, amount, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        return jsonResponse(
          {
            success: false,
            message: "Could not load expenses",
            details: error.message,
          },
          500,
        );
      }

      return jsonResponse({
        success: true,
        expenses: expenses ?? [],
      });
    }

    const body = await req.json();

    const category =
      typeof body.category === "string" ? body.category.trim() : "";

    const description =
      typeof body.description === "string"
        ? body.description.trim()
        : "";

    const amount = Number(body.amount);

    if (!category || category.length > 100) {
      return jsonResponse(
        { success: false, message: "Invalid category" },
        400,
      );
    }

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return jsonResponse(
        { success: false, message: "Invalid amount" },
        400,
      );
    }

    if (description.length > 500) {
      return jsonResponse(
        { success: false, message: "Description is too long" },
        400,
      );
    }

    const { data: expense, error } = await supabase
      .from("expenses")
      .insert({
        category,
        description: description || null,
        amount,
      })
      .select("id, category, description, amount, created_at")
      .single();

    if (error) {
      return jsonResponse(
        {
          success: false,
          message: "Could not save expense",
          details: error.message,
        },
        500,
      );
    }

    return jsonResponse({
      success: true,
      expense,
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        message: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});
