// Proxy all /api/* requests to the worker
export async function onRequest(context: any) {
  const url = new URL(context.request.url);
  const pathArray = context.params.path || [];
  const workerUrl = `https://strava-club-workers.pedroqueiroz.workers.dev/api/${pathArray.join('/')}${url.search}`;

  return fetch(workerUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  });
}
