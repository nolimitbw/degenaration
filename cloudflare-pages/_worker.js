const RENDER_ORIGIN = "https://degenaration-web.onrender.com";

function rewriteLocation(headers, publicOrigin) {
  const location = headers.get("location");
  if (!location) return;

  headers.set("location", location.replace(RENDER_ORIGIN, publicOrigin));
}

export default {
  async fetch(request, env) {
    const publicUrl = new URL(request.url);

    if (request.method === "GET" || request.method === "HEAD") {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
    }

    const renderUrl = new URL(publicUrl.pathname + publicUrl.search, RENDER_ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("host", renderUrl.host);
    headers.set("x-forwarded-host", publicUrl.host);
    headers.set("x-forwarded-proto", "https");

    const response = await fetch(
      new Request(renderUrl, {
        method: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : request.body,
        redirect: "manual"
      })
    );

    const responseHeaders = new Headers(response.headers);
    rewriteLocation(responseHeaders, publicUrl.origin);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  }
};
