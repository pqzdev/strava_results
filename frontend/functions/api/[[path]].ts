// Cloudflare Pages Function to proxy API requests to worker
export async function onRequest(context: any) {
  const url = new URL(context.request.url);
  const workerUrl = `https://strava-club-workers.pedroqueiroz.workers.dev${url.pathname}${url.search}`;

  return fetch(workerUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  });
}
