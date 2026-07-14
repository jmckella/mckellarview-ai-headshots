import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const supabaseUrl = Netlify.env.get("SUPABASE_URL");
    // Use SERVICE ROLE key server-side — never exposed to the browser
    const supabaseServiceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: "Storage not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const orderId = (formData.get("orderId") as string) || `order_${Date.now()}`;
    const files = formData.getAll("photos") as File[];

    if (!files || files.length === 0) {
      return new Response(JSON.stringify({ error: "No files provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const uploadedPaths: string[] = [];
    const errors: string[] = [];

    for (const file of files) {
      // Validate file type
      if (!file.type.startsWith("image/")) continue;
      // Limit file size to 10MB
      if (file.size > 10 * 1024 * 1024) continue;

      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      // Private path — orderId scoped so only you can find them
      const storagePath = `orders/${orderId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;

      const fileBuffer = await file.arrayBuffer();

      const uploadRes = await fetch(
        `${supabaseUrl}/storage/v1/object/headshot-uploads/${storagePath}`,
        {
          method: "POST",
          headers: {
            // Service role key — full access, server-side only
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": file.type || "image/jpeg",
            "x-upsert": "false",
          },
          body: fileBuffer,
        }
      );

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        console.error("Upload error:", uploadRes.status, err);
        errors.push(`storage ${uploadRes.status}: ${err.slice(0, 200)}`);
        continue;
      }

      uploadedPaths.push(storagePath);
    }

    // Return storage paths, NOT public URLs — you retrieve via signed URLs later
    return new Response(
      JSON.stringify({
        success: uploadedPaths.length > 0,
        paths: uploadedPaths,
        orderId,
        count: uploadedPaths.length,
        errors: errors.length ? errors : undefined,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Upload function error:", err);
    return new Response(JSON.stringify({ error: "Upload failed. Please try again." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/upload-photos",
};
