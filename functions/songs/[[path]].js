export async function onRequest(context) {
  const { env, params } = context;
  const fileName = decodeURIComponent(params.path.join('/'));
  const key = `songs/${fileName}`;

  const object = await env.MY_BUCKET.get(key);
  if (!object) {
    return new Response("Not Found: " + key, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=31536000");
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(object.body, { headers });
}